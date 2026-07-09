// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {INonfungiblePositionManager} from "src/interfaces/external/INonfungiblePositionManager.sol";

/// @title ILPFeeVault — LP principal permanently locked; trading fees claimable by treasury.
///        (spec §6.3.4, §6.6; contracts.md §2.6)
/// @notice Terminal custody for LP NFTs. No owner, no withdraw, no upgrade path, no privileged
///         functions. ONE external state-mutating function: `collect(tokenId)`, permissionless,
///         paying accrued V3 fees to a treasury address fixed at deploy. There is no
///         decreaseLiquidity, no transferFrom initiation, no approve — principal mathematically
///         cannot leave (VitaliyShulik TokenLocker reference property, spec §4.3).
///         Implementation target ~50 lines.
/// @dev FROZEN interface (tests-as-spec phase). Copy language everywhere: "LP principal
///      permanently locked; trading fees claimable by treasury." — never "burned" (spec §12.14).
interface ILPFeeVault is IERC721Receiver {
    /// @notice Emitted on every fee collection (contracts.md §2.6).
    event FeesCollected(uint256 indexed tokenId, uint256 amount0, uint256 amount1);

    /// @notice Permissionless: collect accrued V3 fees on a held position, paid to the fixed
    ///         treasury (amount0Max/amount1Max = type(uint128).max).
    function collect(uint256 tokenId) external returns (uint256 amount0, uint256 amount1);

    /// @notice The NonfungiblePositionManager (immutable; sole accepted ERC721 sender).
    function positionManager() external view returns (INonfungiblePositionManager);

    /// @notice Gnosis Safe treasury, fixed at deploy, unchangeable forever (spec §6.6).
    function treasury() external view returns (address);
}
