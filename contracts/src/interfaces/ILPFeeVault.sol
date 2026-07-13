// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {INonfungiblePositionManager} from "src/interfaces/external/INonfungiblePositionManager.sol";

/// @title ILPFeeVault — LP principal permanently locked; trading fees split between treasury and creator.
///        (spec §6.3.4, §6.6, §12.14, §12.69; contracts.md §2.6)
/// @notice Terminal custody for LP NFTs. No owner, no withdraw, no upgrade path, no privileged
///         functions. The state-mutating surface is `collect(tokenId)` (permissionless — harvests the
///         held position's accrued V3 fees and SPLITS them 50/50 treasury/creator on BOTH token legs;
///         spec §12.69) and `registerCreator(tokenId, creator)` (migrator-only, set-once — binds the
///         post-graduation fee beneficiary). There is no `decreaseLiquidity`, no `transferFrom`
///         initiation, no `approve` beyond the exact-amount forward of the creator's split share —
///         principal liquidity mathematically cannot leave (VitaliyShulik TokenLocker reference
///         property, spec §4.3). Implementation target ~50 lines (grows for the split + registration,
///         spec §6.6 — documented in the source).
/// @dev Copy language everywhere (§12.14 as amended by §12.69): "LP principal permanently locked;
///      trading fees split between treasury and creator." — never "burned".
interface ILPFeeVault is IERC721Receiver {
    /// @notice Emitted on every fee collection — TOTAL harvested from the position (pre-split),
    ///         per leg (contracts.md §2.6).
    event FeesCollected(uint256 indexed tokenId, uint256 amount0, uint256 amount1);

    /// @notice Emitted on every collect with the per-leg 50/50 split (spec §12.69(G) — two
    ///         beneficiaries; indexer accrues treasury-vs-creator per tokenId). `treasuryN`/`creatorN`
    ///         sum EXACTLY to the collected `amountN` for leg N (no leakage/rounding drain).
    event FeesSplit(
        uint256 indexed tokenId,
        address indexed creator,
        uint256 treasury0,
        uint256 creator0,
        uint256 treasury1,
        uint256 creator1
    );

    /// @notice Emitted when the migrator binds a graduated position's creator (spec §12.69(B)).
    event CreatorRegistered(uint256 indexed tokenId, address indexed creator);

    /// @notice Permissionless: harvest the held position's accrued V3 fees (both legs) and split each
    ///         leg 50/50 — treasury share to the FIXED treasury (treasury-first), creator share routed
    ///         to the pull-payment {ICreatorVault} credited to `creatorOf[tokenId]` (spec §12.69).
    ///         Never touches principal liquidity. Returns the TOTAL collected per leg (pre-split).
    function collect(uint256 tokenId) external returns (uint256 amount0, uint256 amount1);

    /// @notice Migrator-only, set-once: bind `tokenId → creator` at graduation (spec §12.69(B)). The
    ///         migrator mints the LP position and authoritatively knows the creator from the
    ///         graduating curve; NPM `mint` uses `_mint` (not `_safeMint`) so `onERC721Received` never
    ///         fires on the mint, hence this explicit registration rather than a transfer-data payload.
    function registerCreator(uint256 tokenId, address creator) external;

    /// @notice The post-graduation fee beneficiary bound at registration (set-once).
    function creatorOf(uint256 tokenId) external view returns (address);

    /// @notice The NonfungiblePositionManager (immutable; sole accepted ERC721 sender).
    function positionManager() external view returns (INonfungiblePositionManager);

    /// @notice Gnosis Safe treasury, fixed at deploy, unchangeable forever (spec §6.6).
    function treasury() external view returns (address);

    /// @notice The CurveFactory of this generation — source of the live (one-time-set, immutable-by-
    ///         convention) `creatorVault()` fee sink and `migrator()` registration authority.
    function factory() external view returns (address);

    /// @notice Creator share of every post-graduation collect, in bps (immutable 5000 = 50%, §12.69).
    function creatorLpShareBps() external view returns (uint16);
}
