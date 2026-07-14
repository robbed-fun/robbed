// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IUniswapV3SwapCallback} from "src/interfaces/external/IUniswapV3SwapCallback.sol";

/// @title IV3Migrator — graduation executor, Option B (,
/// contracts.md)
/// @notice Stateless-per-token executor: Uniswap V3, 1% fee tier (tick spacing 200), full-range
///         position, LP NFT → LPFeeVault. Also owns creation-time pool initialization (pre-seed
///         defense). No owner.
/// @dev FROZEN interface (tests-as-spec phase). Invariants owned (gate 2, contracts.md):
///      never mints into a pool whose tick is outside target ± TOLERANCE_TICKS; arb-back spend
///      bounded by curve inventory above what the target-price mint requires (budget rule,
/// O-8); donation/sync-style/swap griefing cannot produce a hostile-ratio mint
///      (corrected or reverted); `Graduated` emitted exactly once per token.
interface IV3Migrator is IUniswapV3SwapCallback {
    // ────────────────────────────────── Events ─────────────────────────────────

    /// @notice Emitted on creation-time pool initialization.
    /// @param preExisting True if an attacker pre-created the pool — initialization skipped;
    ///        tolerated: migrate() never trusts slot0 and will arb it back (defense in depth).
    event PoolInitialized(address indexed token, address indexed pool, uint160 sqrtPriceX96, bool preExisting);

    /// @notice Canonical graduation event (step 5, event family).
    event Graduated(
        address indexed token,
        address indexed pool,
        uint256 indexed tokenId,
        uint128 liquidity,
        uint256 wethInPosition,
        uint256 tokensInPosition,
        uint256 graduationFee,
        address caller,
        uint256 callerReward,
        uint256 tokensBurned,
        uint256 wethDustToTreasury
    );

    // ─────────────────────────────── Mutating ──────────────────────────────────

    /// @notice Called by the factory during createToken. Creates + initializes the token/WETH 1%
    /// pool at the deterministic graduation price.
    /// @dev onlyFactory. Uses NPM.createAndInitializePoolIfNecessary with sqrtPriceX96 chosen by
    ///      token ordering: SQRT_PRICE_TOKEN0_X96 if token < WETH else SQRT_PRICE_TOKEN1_X96
    ///      (both immutables from M0 constants).
    function initializePool(address token) external returns (address pool);

    /// @notice Called by a curve's graduate() with the curve's entire ETH balance (minus caller
    ///         reward) and after receiving the curve's entire token balance.
    /// @dev onlyCurve (factory.isCurve(msg.sender)). Full sequence (contracts.md):
    ///      graduation fee → treasury FIRST; wrap ETH → WETH; read slot0; bounded arb-back loop
    ///      (≤ MAX_ARB_ITERATIONS) to target ± TOLERANCE_TICKS, else revert
    ///      PoolPriceUnrecoverable — NEVER mints into a hostile ratio; mint full-range position
    ///      (amount-mins from MIGRATION_SLIPPAGE_BPS) with recipient = LPFeeVault; token dust →
    /// 0x…dEaD, WETH dust → treasury; emit Graduated. Reverts propagate to
    ///      graduate(), leaving the curve ReadyToGraduate for retry.
    function migrate(address token) external payable returns (uint256 tokenId, uint128 liquidity);

    // ────────────────────────────────── Views ──────────────────────────────────
    // Immutable-parameter getters (contracts.md storage table; public so gate-2/gate-3
    // tests can verify tick tolerance and ordering without re-deriving M0 constants).

    /// @notice The ROBBED_ CurveFactory.
    function factory() external view returns (address);

    /// @notice Uniswap V3 Factory (constructor param — open item O-4, never invented).
    function v3Factory() external view returns (address);

    /// @notice NonfungiblePositionManager (constructor param — open item O-4).
    function positionManager() external view returns (address);

    /// @notice Canonical WETH.
    function weth() external view returns (address);

    /// @notice LPFeeVault — recipient of every LP NFT.
    function vault() external view returns (address);

    /// @notice Graduation sqrtPrice when the launch token is token0 (M0 constants).
    function SQRT_PRICE_TOKEN0_X96() external view returns (uint160);

    /// @notice Graduation sqrtPrice when the launch token is token1 (M0 constants).
    function SQRT_PRICE_TOKEN1_X96() external view returns (uint160);

    /// @notice Graduation target tick, launch token as token0 (M0 constants).
    function TARGET_TICK_TOKEN0() external view returns (int24);

    /// @notice Graduation target tick, launch token as token1 (M0 constants).
    function TARGET_TICK_TOKEN1() external view returns (int24);

    /// @notice Arb-back tick tolerance (M0 constants, open item O-8).
    function TOLERANCE_TICKS() external view returns (int24);

    /// @notice Arb-back loop bound (M0 constants, open item O-8).
    function MAX_ARB_ITERATIONS() external view returns (uint8);

    /// @notice Mint amount-min slippage in bps (M0 constants, open item O-8).
    function MIGRATION_SLIPPAGE_BPS() external view returns (uint16);

    /// @notice V3 fee tier: 10_000 (1%, constant).
    function FEE_TIER() external view returns (uint24);

    /// @notice Full-range lower tick at spacing 200: -887_200 (constant).
    function TICK_LOWER() external view returns (int24);

    /// @notice Full-range upper tick at spacing 200: 887_200 (constant).
    function TICK_UPPER() external view returns (int24);
}
