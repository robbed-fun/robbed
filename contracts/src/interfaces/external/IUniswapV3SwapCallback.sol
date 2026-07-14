// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IUniswapV3SwapCallback — minimal local interface
/// @notice Implemented by V3Migrator for the graduation arb-back swaps (contracts.md);
///         the callback verifies msg.sender against the in-flight migration's pool (`_activePool`)
///         and reverts NotPool otherwise.
/// @dev Minimal local interface, no upstream npm dependency (contracts.md inventory).
interface IUniswapV3SwapCallback {
    /// @notice Called by the pool during swap(); the callee must pay the owed amounts.
    /// @param amount0Delta Positive = amount of token0 owed to the pool.
    /// @param amount1Delta Positive = amount of token1 owed to the pool.
    /// @param data         Opaque data passed through from swap().
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}
