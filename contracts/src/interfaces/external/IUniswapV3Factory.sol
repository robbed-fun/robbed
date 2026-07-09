// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IUniswapV3Factory — minimal local interface (getPool, createPool)
/// @notice The live V3 Factory address on chain 4663 is an OPEN ITEM (spec §13, contracts.md O-4):
///         pulled from the official Uniswap deployments registry at implementation time, passed as
///         a constructor/config param, never invented.
/// @dev Minimal local interface, no upstream npm dependency (contracts.md §2 inventory).
interface IUniswapV3Factory {
    /// @notice Returns the pool for the pair+fee, or address(0) if it does not exist.
    /// @dev tokenA/tokenB order-insensitive.
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);

    /// @notice Deploys a pool for the pair+fee. Reverts if it already exists.
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
}
