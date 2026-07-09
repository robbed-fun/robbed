// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IUniswapV3Pool — minimal local interface (slot0, swap, initialize, liquidity)
/// @notice Used by V3Migrator for creation-time pool initialization and the graduation
///         pre-seed-defense arb-back loop (spec §6.3.2, contracts.md §2.5, §3.4).
/// @dev Minimal local interface, no upstream npm dependency (contracts.md §2 inventory).
///      token0/token1/fee are included for token-ordering checks in the migrator and tests.
interface IUniswapV3Pool {
    /// @notice The pool's current price/tick state. Read by migrate() before the arb-back loop
    ///         (contracts.md §3.4 step 4).
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    /// @notice One-time price initialization. Called at token-creation time via
    ///         NPM.createAndInitializePoolIfNecessary (spec §6.3.2).
    function initialize(uint160 sqrtPriceX96) external;

    /// @notice Price-limited swap; used by the migrator's arb-back with its own
    ///         uniswapV3SwapCallback — no external SwapRouter dependency (contracts.md §3.4 step 5).
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);

    /// @notice In-range liquidity.
    function liquidity() external view returns (uint128);

    /// @notice Pool token0 (lower address of the pair).
    function token0() external view returns (address);

    /// @notice Pool token1 (higher address of the pair).
    function token1() external view returns (address);

    /// @notice Pool fee in hundredths of a bip (10_000 = 1% tier, spec §12.1).
    function fee() external view returns (uint24);
}
