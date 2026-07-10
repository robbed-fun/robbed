// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ILPFeeVault} from "./interfaces/ILPFeeVault.sol";
import {INonfungiblePositionManager} from "./interfaces/external/INonfungiblePositionManager.sol";
import {ZeroAddress, NotPositionManager} from "./errors/Errors.sol";

/// @title LPFeeVault — LP principal permanently locked; trading fees claimable by treasury.
///        (spec §6.3.4, §6.6; contracts.md §2.6)
/// @notice Terminal custody for graduation LP NFTs. No owner, no withdraw, no upgrade path, no
///         privileged functions, no setter. The ONLY external state-mutating function is
///         permissionless `collect(tokenId)`, which routes accrued V3 fees to a treasury address
///         fixed at deploy. There is deliberately no `decreaseLiquidity`, no `transferFrom`
///         initiation, no `approve`, no `setApprovalForAll` — this contract can call NOTHING on the
///         position manager except `collect`, so the position's PRINCIPAL liquidity mathematically
///         cannot leave (VitaliyShulik `TokenLocker` reference property, spec §4.3). Copy language
///         everywhere: "LP principal permanently locked; trading fees claimable by treasury" —
///         never "burned" (spec §12.14).
///
/// @dev Minimalism is a hard constraint (spec §6.6; CLAUDE.md — auto-fail if it grows a privileged
///      path). Design decisions recorded for the hoodpad-security gate:
///
///      1. **`collect` recipient is the IMMUTABLE `treasury`, never `msg.sender`.** The NPM
///         `CollectParams.recipient` is hardcoded to `treasury`, so an arbitrary caller cannot
///         redirect fees to themselves — the function is permissionless in WHO pays gas, not in
///         WHERE the money goes. Alternative rejected: a `recipient` parameter (would let anyone
///         steal the fees) or an owner-settable treasury (would reintroduce a privileged path the
///         §6.6 minimalism rule forbids). Fixed-at-deploy mirrors the immutable-contracts rule (§6).
///
///      2. **`onERC721Received` accepts NFTs ONLY from the position manager.** The graduation mint
///         (`V3Migrator` → `NPM.mint` with `recipient = this`) causes the NPM to `safeTransferFrom`
///         the freshly-minted LP NFT here. Restricting the accepted sender to the NPM keeps the
///         vault from being griefed with arbitrary ERC721s that would pollute the `collect` surface.
///         It is a `view` guard — no state, no re-entrancy surface.
contract LPFeeVault is ILPFeeVault {
    /// @inheritdoc ILPFeeVault
    INonfungiblePositionManager public immutable override positionManager;
    /// @inheritdoc ILPFeeVault
    address public immutable override treasury;

    /// @param positionManager_ Canonical NonfungiblePositionManager (§12.28 address via deploy).
    /// @param treasury_        Gnosis Safe treasury, fixed forever (spec §6.6).
    constructor(address positionManager_, address treasury_) {
        if (positionManager_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        positionManager = INonfungiblePositionManager(positionManager_);
        treasury = treasury_;
    }

    /// @inheritdoc ILPFeeVault
    function collect(uint256 tokenId) external override returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId, recipient: treasury, amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );
        emit FeesCollected(tokenId, amount0, amount1);
    }

    /// @inheritdoc IERC721Receiver
    /// @dev Accepts LP NFTs only from the position manager itself (spec §6.3.4).
    function onERC721Received(address, address, uint256, bytes calldata) external view override returns (bytes4) {
        if (msg.sender != address(positionManager)) revert NotPositionManager();
        return IERC721Receiver.onERC721Received.selector;
    }
}
