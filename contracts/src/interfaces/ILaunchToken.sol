// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/// @title ILaunchToken — hoodpad launch token (spec §6.1, §8.3; contracts.md §2.1)
/// @notice Plain OZ v5 ERC20 + ERC20Permit. 18 decimals. No owner, no mint/burn functions, no
///         hooks, no taxes, no blacklist. Supply minted exactly once, in the constructor, to the
///         curve. External surface beyond OZ: `metadataHash()` and the `TOTAL_SUPPLY` getter.
///         Nothing else. No events beyond ERC20 Transfer/Approval (mint emits Transfer(0x0 → curve)).
/// @dev FROZEN interface (tests-as-spec phase): the M1 implementation compiles against this
///      unchanged. Invariants owned (contracts.md §2.1): `totalSupply() == 1e27` forever;
///      `metadataHash` immutable. "Burning" of graduation dust is a transfer to
///      0x…dEaD — the token itself has no burn() (spec §12.13).
interface ILaunchToken is IERC20, IERC20Metadata, IERC20Permit {
    /// @notice keccak256 of the canonicalized metadata JSON — immutable on-chain integrity
    ///         commitment (spec §8.3; contracts.md §2.1 storage table). Also emitted in
    ///         `TokenCreated` (spec §12.15); the indexer verifies fetched JSON against it.
    function metadataHash() external view returns (bytes32);

    /// @notice Fixed total supply: 1,000,000,000e18 (public constant getter, contracts.md §2.1).
    function TOTAL_SUPPLY() external view returns (uint256);
}
