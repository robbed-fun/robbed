// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IArbSys — minimal Arbitrum/Orbit system precompile interface
/// @notice Lives at `address(100)` (0x0000…0064) on every Orbit chain, including Robinhood Chain
///         (chain ID 4663). The EVM NUMBER opcode returns an L1 ESTIMATE on Orbit and is forbidden
///         in all contract logic (spec §2, CLAUDE.md); any block-based logic must use
///         `ArbSys(address(100)).arbBlockNumber()` or `block.timestamp`.
/// @dev Minimal local interface, no upstream npm dependency (contracts.md §2 inventory).
///      The anti-sniper window is timestamp-based (spec §12.18); this interface is shipped for
///      tests and any future block-window need (contracts.md §2.3).
interface IArbSys {
    /// @notice The true L2 block height of the Orbit chain.
    function arbBlockNumber() external view returns (uint256);
}
