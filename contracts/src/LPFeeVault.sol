// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ILPFeeVault} from "./interfaces/ILPFeeVault.sol";
import {ICurveFactory} from "./interfaces/ICurveFactory.sol";
import {ICreatorVault} from "./interfaces/ICreatorVault.sol";
import {INonfungiblePositionManager} from "./interfaces/external/INonfungiblePositionManager.sol";
import {ZeroAddress, NotPositionManager, NotMigrator, CreatorAlreadyRegistered} from "./errors/Errors.sol";

/// @title LPFeeVault — LP principal permanently locked; trading fees split between treasury and creator.
/// (contracts.md)
/// @notice Terminal custody for graduation LP NFTs. No owner, no withdraw, no upgrade path, no
///         privileged setter. The ONLY state-mutating functions are permissionless `collect(tokenId)`
///         and migrator-gated set-once `registerCreator(tokenId, creator)`. `collect` harvests the
///         held position's accrued V3 fees and SPLITS each leg 50/50: the treasury share is pushed to
/// the immutable treasury (treasury-first), the creator share is routed to the
///         pull-payment {CreatorVault}. There is deliberately no `decreaseLiquidity`, no
///         `transferFrom` initiation, and no `approve` beyond the exact-amount forward of the
///         creator's split share to the (trusted) CreatorVault — this contract can move NOTHING of the
///         position's PRINCIPAL liquidity, so it mathematically cannot leave (VitaliyShulik
/// `TokenLocker` reference property). Copy language everywhere (as amended
/// by) "LP principal permanently locked; trading fees split between treasury and
///         creator" — never "burned".
///
/// @dev THIS IS THE CREATOR-FEE FACTORY GENERATION (deployed fresh; no retrofit —
/// already-deployed treasury-only v1 vaults keep 100%-to-treasury `collect` forever). It
///      grows past the ~50-line treasury-only vault by exactly: the per-leg split routing, the
///      `tokenId → creator` mapping, and the migrator-gated set-once registration — the minimal
/// surface the 50/50 split requires (every added line justified below).
///
///      Design decisions recorded for the robbed-security gate:
///
///      1. **`collect` harvests to THIS vault, then splits — never `recipient = treasury` directly.**
///         The treasury-only v1 pointed `CollectParams.recipient` straight at the treasury. To split,
///         the vault must first take custody of both legs (`recipient = address(this)`), then transfer
///         each leg's shares. The mid-collect custody is fully atomic and leaves ZERO residue: per leg
///         `treasuryShare + creatorShare == amount` exactly (treasury gets `amount − creatorShare`, so
/// the odd wei biases to the treasury — treasury-first), so nothing accumulates in the
/// vault (exact-sum invariant, proven by test). Both legs are the launch token
/// (plain OZ ERC20, no hooks) and canonical WETH9 (balance-mapping `transfer`, no
///         recipient callback), so every outward transfer is callback-free: a hostile/mispointed
/// treasury can never revert `collect` (discipline preserved), and the creator
///         share is pushed to OUR non-reverting {CreatorVault} (never a hostile EOA on the fee path,
/// ). No `nonReentrant` guard: every callee (`positionManager`, the two ERC20s, the
///         {CreatorVault}) is trusted and callback-free, so there is no re-entrancy surface — keeping
/// the guard off preserves the minimalism.
///
/// 2. **Creator resolution: migrator-driven explicit `registerCreator`, NOT the
/// NFT-transfer `data` payload.** ratified passing `abi.encode(creator)` through
///         `safeTransferFrom` into `onERC721Received`. VERIFIED against the real v3-periphery
///         `NonfungiblePositionManager` (github.com/Uniswap/v3-periphery, `mint`): it mints with
///         `_mint(recipient, tokenId)` — NOT `_safeMint` — so `onERC721Received` is NEVER triggered on
///         mint, and the migrator mints with `recipient = vault` directly (no transfer at all). The
///         data-payload mechanism therefore cannot fire. Chosen the robust alternative the spec itself
///         offers: the migrator (which mints the position and knows the graduating curve's creator)
///         calls `registerCreator(tokenId, creator)` in the SAME graduation tx, gated to the factory's
///         registered migrator and set-once. O(1), captured at the authoritative moment, unspoofable
/// (properties intact; the mechanism swapped for one that actually works). See the
/// reconciliation note flagged to the architect in the change report.
///
///      3. **`creatorVault` + `migrator` read LIVE from the factory; `treasury` stays IMMUTABLE.**
///         The factory's `creatorVault`/`migrator` are one-time-set (immutable-by-convention —
///         `AlreadyInitialized` on re-set), so a live read is equivalent to an immutable but keeps the
///         constructor to a single new arg (`factory`) and mirrors how {BondingCurve} reads its
///         sinks. `treasury` remains a constructor immutable (NOT read from `factory.treasury()`)
///         deliberately: `factory.treasury` is owner-rotatable, and per finding G5-INFO-A the LP fee
///         stream must keep flowing to the ORIGINAL treasury after a Safe rotation (a new factory
///         version is the sanctioned way to change it). The creator-vault sink cannot rotate, so a
///         live read carries no redirection risk.
///
///      4. **`onERC721Received` accepts NFTs ONLY from the position manager.** Unchanged guard: the
///         graduation mint lands the NFT here directly (recipient = vault, no hook), but a third party
///         could still `safeTransferFrom` an arbitrary NPM position in. Restricting the accepted
///         sender to the NPM keeps stray ERC721s out. A donated (unregistered) position has
///         `creatorOf == address(0)`; `collect` then routes 100% to the treasury (share bps forced to
///         0) rather than reverting — it can never be bricked by an unregistered tokenId.
contract LPFeeVault is ILPFeeVault {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    /// @inheritdoc ILPFeeVault
    uint16 public constant override creatorLpShareBps = 5000; // 50% — immutable constant

    /// @inheritdoc ILPFeeVault
    INonfungiblePositionManager public immutable override positionManager;
    /// @inheritdoc ILPFeeVault
    address public immutable override treasury;
    /// @inheritdoc ILPFeeVault
    address public immutable override factory;

    /// @inheritdoc ILPFeeVault
    mapping(uint256 tokenId => address) public override creatorOf;

    /// @param positionManager_ Canonical NonfungiblePositionManager (address via deploy).
    /// @param treasury_ Gnosis Safe treasury, fixed forever.
    /// @param factory_         CurveFactory of this generation (source of the live creatorVault sink +
    ///                         migrator registration authority).
    constructor(address positionManager_, address treasury_, address factory_) {
        if (positionManager_ == address(0) || treasury_ == address(0) || factory_ == address(0)) revert ZeroAddress();
        positionManager = INonfungiblePositionManager(positionManager_);
        treasury = treasury_;
        factory = factory_;
    }

    /// @inheritdoc ILPFeeVault
    /// @dev Harvest both legs into this vault, then split each 50/50 (decision #1). Treasury-first
    ///; creator share → {CreatorVault} (pull-payment). Principal untouched
    ///      (`collect` never moves liquidity — docs-confirmed, v3-periphery `NonfungiblePositionManager`).
    function collect(uint256 tokenId) external override returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId, recipient: address(this), amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );
        (,, address token0, address token1,,,,,,,,) = positionManager.positions(tokenId);
        address creator = creatorOf[tokenId];
        // Unregistered (e.g. a donated position) → 100% to treasury (never route to a zero creator).
        uint16 shareBps = creator == address(0) ? 0 : creatorLpShareBps;
        address vault = ICurveFactory(factory).creatorVault();

        (uint256 t0, uint256 c0) = _route(token0, amount0, creator, shareBps, vault);
        (uint256 t1, uint256 c1) = _route(token1, amount1, creator, shareBps, vault);

        emit FeesCollected(tokenId, amount0, amount1);
        emit FeesSplit(tokenId, creator, t0, c0, t1, c1);
    }

    /// @dev Split one leg: `creatorShare = amount·shareBps/1e4`, `treasuryShare = amount − creatorShare`
    /// (exact sum, treasury-biased odd wei). Treasury share pushed via a callback-free
    ///      ERC20 `transfer`; creator share forwarded to the {CreatorVault} via an exact-amount approve
    ///      + `depositERC20` (the vault pulls, credits `creator`). Returns the two shares for the event.
    function _route(address token, uint256 amount, address creator, uint16 shareBps, address vault)
        private
        returns (uint256 treasuryShare, uint256 creatorShare)
    {
        if (amount == 0) return (0, 0);
        creatorShare = (amount * shareBps) / BPS;
        treasuryShare = amount - creatorShare; // treasury-first: keeps the odd wei
        IERC20(token).safeTransfer(treasury, treasuryShare);
        if (creatorShare != 0) {
            IERC20(token).forceApprove(vault, creatorShare);
            ICreatorVault(vault).depositERC20(creator, token, creatorShare);
        }
    }

    /// @inheritdoc ILPFeeVault
    /// @dev Migrator-gated (the factory's one-time-set migrator), set-once. Bound in the same
    ///      graduation tx as the mint (decision #2). `creator` is guaranteed non-zero by the curve
    ///      (snapshotted at birth), but guarded anyway so no position is ever bound to address(0).
    function registerCreator(uint256 tokenId, address creator) external override {
        if (msg.sender != ICurveFactory(factory).migrator()) revert NotMigrator();
        if (creator == address(0)) revert ZeroAddress();
        if (creatorOf[tokenId] != address(0)) revert CreatorAlreadyRegistered();
        creatorOf[tokenId] = creator;
        emit CreatorRegistered(tokenId, creator);
    }

    /// @inheritdoc IERC721Receiver
    /// @dev Accepts LP NFTs only from the position manager itself (decision #4).
    function onERC721Received(address, address, uint256, bytes calldata) external view override returns (bytes4) {
        if (msg.sender != address(positionManager)) revert NotPositionManager();
        return IERC721Receiver.onERC721Received.selector;
    }
}
