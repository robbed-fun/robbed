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

    /// @notice The tick spacing enabled for a given fee amount, or 0 if the fee amount is not enabled.
    /// @dev Signature matches Uniswap v3-core `IUniswapV3Factory.feeAmountTickSpacing` exactly
    ///      (fee: uint24, returns int24, view). Used by the deploy-time V3 runtime assertion
    ///      (contracts.md §7.2, spec §12.28): `feeAmountTickSpacing(10000) == 200` proves the 1% tier
    ///      is enabled on the registry-sourced 4663 Factory — the one V3 fact the address registry
    ///      cannot confirm. Fail-closed if the address is wrong for this chain.
    function feeAmountTickSpacing(uint24 fee) external view returns (int24 tickSpacing);
}
