// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IV3Migrator} from "./interfaces/IV3Migrator.sol";
import {ICurveFactory} from "./interfaces/ICurveFactory.sol";
import {IBondingCurve} from "./interfaces/IBondingCurve.sol";
import {IWETH9} from "./interfaces/external/IWETH9.sol";
import {IUniswapV3Factory} from "./interfaces/external/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "./interfaces/external/IUniswapV3Pool.sol";
import {INonfungiblePositionManager} from "./interfaces/external/INonfungiblePositionManager.sol";
// Kept despite inheritance via {IV3Migrator}: removing it breaks `@inheritdoc IUniswapV3SwapCallback`
// (line 449) — solc requires the referenced base to be a DIRECT import, not transitively in scope
// (verified 2026-07-10: removal → "Documentation tag @inheritdoc references inexistent contract").
import {IUniswapV3SwapCallback} from "./interfaces/external/IUniswapV3SwapCallback.sol";

import {
    NotFactory,
    NotCurve,
    NotPool,
    ZeroAddress,
    PoolPriceUnrecoverable,
    ArbBudgetExceeded,
    InsufficientLiquidityMinted
} from "./errors/Errors.sol";

/// @title V3Migrator — graduation executor, Option B (spec §6.3, §6.3.2, §12.1, §12.11, §12.13;
///        contracts.md §2.5, §3.4)
/// @notice Ownerless, stateless-per-token executor. Owns two jobs: (1) create + initialize the
///         token/WETH 1% V3 pool at the deterministic graduation price at token-CREATION time
///         (`initializePool`, the pre-seed defense §6.3.2); (2) at graduation (`migrate`), read the
///         pool's live `slot0`, ARB the price back to target using curve inventory in a bounded loop
///         — reverting rather than ever minting into a hostile ratio — then mint a full-range LP
///         position (LP tranche + raised WETH) whose NFT goes to the {LPFeeVault}. Implements
///         `IUniswapV3SwapCallback` so the arb-back needs NO external SwapRouter.
///
/// @dev Load-bearing engineering decisions (recorded for the hoodpad-security gate):
///
///      1. **Reverting-treasury CANNOT lock graduation (TM-T1, graduation-fee leg).** The flat
///         graduation fee AND the residual WETH dust are paid to the treasury as **WETH via
///         `IERC20(weth).transfer`**, never as native ETH via a low-level `call`. Canonical WETH9
///         `transfer` credits a balance mapping and invokes NO recipient callback, so a
///         hostile/mispointed `treasury` (threat-model UM-1/UM-2) can never revert it and can never
///         freeze `graduate()`. This is the guarantee-preserving alternative to a native-ETH
///         pull-accumulator: it needs no extra state or function, pays the treasury AT graduation
///         (not later), and changes no product guarantee (fee still → treasury first, §6.3 step 1).
///         The only native-ETH send in the whole graduation flow is the curve's CALLER_REWARD to
///         `graduate()`'s caller — if that caller rejects ETH only THEIR attempt reverts; anyone
///         else may retry (handled in {BondingCurve.graduate}). No treasury-lock vector remains.
///
///      2. **Arb-back budget rule — token leg vs WETH leg (TM-T2).** Griefers can move the
///         pre-graduation pool's `slot0` arbitrarily (a near-empty pool is cheap to push). Before
///         minting, `migrate` swaps the price back toward `targetTick` in a bounded loop, price-
///         limited to `targetSqrtPrice` (so a swap can never OVERSHOOT past target). Each leg draws
///         from a SYMMETRIC, `MIGRATION_SLIPPAGE_BPS`-bounded budget defined against that leg's mint
///         requirement, so the arb can never cannibalize the LP-mint floor below the parity tolerance
///         and so BOTH directions of mispricing self-correct identically (M-10-A / UM-2 realised):
///           • **token leg** (pool token-overpriced → sell token to push price down, receiving
///             WETH): the mint's token requirement is the FULL `LP_TOKEN_TRANCHE`; the arb may draw
///             the token balance DOWN to `LP_TOKEN_TRANCHE · (1 − slippageBps)` (i.e. spend at most
///             dust + `LP_TOKEN_TRANCHE · slippageBps`). PRIOR BUG: the floor was the full
///             `LP_TOKEN_TRANCHE`, but the curve forwards ≈ exactly `LP_TOKEN_TRANCHE` at graduation
///             (rounding favours the curve → only dust above), so a token-overpriced pool gave
///             `budget ≈ 0 → ArbBudgetExceeded`, freezing the curve in `ReadyToGraduate` (§12.12)
///             while the attacker kept a withdrawable position — the token side could NOT self-correct
///             even within tolerance. Fixed to mirror the WETH leg below.
///           • **WETH leg** (pool token-underpriced → buy token with WETH to push price up): the
///             mint's WETH requirement is the FULL `wethForMint`; the arb may spend at most
///             `MIGRATION_SLIPPAGE_BPS` of it (`wethArbBudget = wethForMint · slippageBps / 1e4`).
///         Both legs bound the position's under-funding on their side — hence the $69k parity
///         (§12.11) — to `MIGRATION_SLIPPAGE_BPS`. The mint reads the LIVE (arb-adjusted) balances as
///         its `amountDesired` on BOTH sides; whichever side the arb reduced becomes the binding side
///         at the fixed target ratio, and the mint's `amount0Min`/`amount1Min` (each = the PRE-arb
///         `LP_TOKEN_TRANCHE` / `wethForMint` × `(1 − slippageBps)`) INDEPENDENTLY re-enforce the
///         parity floor on BOTH sides, so parity holds even if the loop math is wrong (defense in
///         depth). When the needed leg's budget is exhausted while still off-target →
///         `ArbBudgetExceeded`; when iterations run out still off-target → `PoolPriceUnrecoverable`.
///         Both revert the whole `graduate()`, leaving the curve `ReadyToGraduate` and permissionlessly
///         retriable — never a hostile mint (spec §6.3.2). Residual mispricing BEYOND the
///         slippage-recoverable range still reverts (retriable once the pool corrects); fully closing
///         that frozen window is the UM-2 caps-lift disposition (gate-6 cost proof or an escape hatch
///         that would touch the §12.12 two-way lock) — escalated to the architect, NOT decided here.
///         Alternatives weighed: (a) a single shared budget — rejected, it lets one leg silently drain
///         the other's mint floor; (b) a dedicated `maxWethArbBps`/`maxTokenArbBps` immutable pair —
///         folded into the single `MIGRATION_SLIPPAGE_BPS` since all express the same value-skew
///         tolerance and one knob is a smaller config surface.
///
///      3. **No on-chain tick↔sqrtPrice conversion — no TickMath/FullMath vendoring.** The M0
///         notebook pre-computes BOTH orderings' `sqrtPriceX96` AND `tick` (constants.json.v3), so
///         `migrate` only ever COMPARES the live `slot0` tick/sqrtPrice against immutables and uses
///         the target `sqrtPrice` immutable as the swap price limit. No `getSqrtRatioAtTick` /
///         `getTickAtSqrtRatio` is needed on-chain. This drops the vendored-library attack surface
///         (and its M1-13 mutation-testing burden) entirely — the smaller-surface choice.
///
///      4. **Own swap callback, `_activePool`-gated.** The arb-back calls `pool.swap` directly and
///         pays the owed side in `uniswapV3SwapCallback` from the migrator's own balances. The
///         callback authorises `msg.sender` against `_activePool` (set for the duration of `migrate`
///         only), so no stray/hostile pool can invoke it — chosen over a SwapRouter dependency to
///         keep the graduation path free of an extra trusted integration.
contract V3Migrator is IV3Migrator {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    /// @dev "Burn" sink for residual token dust — LaunchToken has no burn fn (spec §12.13).
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ─────────────────────────────── Immutables ────────────────────────────────

    /// @inheritdoc IV3Migrator
    address public immutable override factory;
    /// @inheritdoc IV3Migrator
    address public immutable override v3Factory;
    /// @inheritdoc IV3Migrator
    address public immutable override positionManager;
    /// @inheritdoc IV3Migrator
    address public immutable override weth;
    /// @inheritdoc IV3Migrator
    address public immutable override vault;

    /// @inheritdoc IV3Migrator
    uint160 public immutable override SQRT_PRICE_TOKEN0_X96;
    /// @inheritdoc IV3Migrator
    uint160 public immutable override SQRT_PRICE_TOKEN1_X96;
    /// @inheritdoc IV3Migrator
    int24 public immutable override TARGET_TICK_TOKEN0;
    /// @inheritdoc IV3Migrator
    int24 public immutable override TARGET_TICK_TOKEN1;
    /// @inheritdoc IV3Migrator
    int24 public immutable override TOLERANCE_TICKS;
    /// @inheritdoc IV3Migrator
    uint8 public immutable override MAX_ARB_ITERATIONS;
    /// @inheritdoc IV3Migrator
    uint16 public immutable override MIGRATION_SLIPPAGE_BPS;

    /// @inheritdoc IV3Migrator
    uint24 public constant override FEE_TIER = 10_000; // 1% tier (spec §12.1)
    /// @inheritdoc IV3Migrator
    int24 public constant override TICK_LOWER = -887_200; // full range at spacing 200
    /// @inheritdoc IV3Migrator
    int24 public constant override TICK_UPPER = 887_200;

    // ──────────────────────────────── Storage ──────────────────────────────────

    /// @dev Pool of the in-flight migration; set at the top of `migrate`, cleared before mint.
    ///      Sole authorisation for `uniswapV3SwapCallback` — non-zero ONLY mid-arb-back.
    address private _activePool;

    // ─────────────────────────── Construction config ───────────────────────────

    /// @notice Deploy-time configuration. Every market-dependent value originates from
    ///         `tools/m0/out/constants.json` via the deploy script — never inlined (spec §2, §6.4).
    ///         V3 addresses are the §12.28-confirmed registry values (never invented).
    struct MigratorInit {
        address factory; // hoodpad CurveFactory
        address v3Factory; // Uniswap V3 Factory (§12.28)
        address positionManager; // NonfungiblePositionManager (§12.28)
        address weth; // canonical WETH
        address vault; // LPFeeVault
        uint160 sqrtPriceToken0X96; // graduation price, launch token = token0 (M0)
        uint160 sqrtPriceToken1X96; // graduation price, launch token = token1 (M0)
        int24 targetTickToken0; // graduation tick, token0 (M0)
        int24 targetTickToken1; // graduation tick, token1 (M0)
        int24 toleranceTicks; // arb-back tolerance (M0)
        uint8 maxArbIterations; // arb-back loop bound (M0)
        uint16 migrationSlippageBps; // mint amount-mins + WETH arb budget (M0)
    }

    /// @param p Deploy config (see {MigratorInit}).
    constructor(MigratorInit memory p) {
        if (
            p.factory == address(0) || p.v3Factory == address(0) || p.positionManager == address(0)
                || p.weth == address(0) || p.vault == address(0)
        ) revert ZeroAddress();
        if (p.sqrtPriceToken0X96 == 0 || p.sqrtPriceToken1X96 == 0 || p.maxArbIterations == 0) revert ZeroAddress();

        factory = p.factory;
        v3Factory = p.v3Factory;
        positionManager = p.positionManager;
        weth = p.weth;
        vault = p.vault;
        SQRT_PRICE_TOKEN0_X96 = p.sqrtPriceToken0X96;
        SQRT_PRICE_TOKEN1_X96 = p.sqrtPriceToken1X96;
        TARGET_TICK_TOKEN0 = p.targetTickToken0;
        TARGET_TICK_TOKEN1 = p.targetTickToken1;
        TOLERANCE_TICKS = p.toleranceTicks;
        MAX_ARB_ITERATIONS = p.maxArbIterations;
        MIGRATION_SLIPPAGE_BPS = p.migrationSlippageBps;
    }

    // ─────────────────────────── Creation-time pool init ───────────────────────

    /// @inheritdoc IV3Migrator
    /// @dev onlyFactory. Idempotent: `createAndInitializePoolIfNecessary` no-ops if the pool is
    ///      already initialized. If an attacker pre-created/initialized the pool at a hostile price
    ///      the init is skipped (`preExisting = true`) — tolerated by design because `migrate` never
    ///      trusts `slot0` and always arbs it back (defense in depth, spec §6.3.2).
    function initializePool(address token) external override returns (address pool) {
        if (msg.sender != factory) revert NotFactory();
        address weth_ = weth;
        (address token0, address token1, uint160 sqrtP) =
            token < weth_ ? (token, weth_, SQRT_PRICE_TOKEN0_X96) : (weth_, token, SQRT_PRICE_TOKEN1_X96);
        bool preExisting = IUniswapV3Factory(v3Factory).getPool(token, weth_, FEE_TIER) != address(0);
        pool = INonfungiblePositionManager(positionManager)
            .createAndInitializePoolIfNecessary(token0, token1, FEE_TIER, sqrtP);
        emit PoolInitialized(token, pool, sqrtP, preExisting);
    }

    // ──────────────────────────────── Graduation ───────────────────────────────

    /// @dev Per-migration context, built once in `migrate` and threaded through the helpers as a
    ///      single memory pointer (one stack slot) — keeps the deep graduation flow off the stack.
    struct Ctx {
        address token;
        address pool;
        bool tokenIsToken0;
        uint160 targetSqrt;
        int24 targetTick;
        uint256 wethForMint;
        uint256 lpTranche;
        uint256 gradFee;
        address treasury;
    }

    /// @inheritdoc IV3Migrator
    /// @dev onlyCurve. Receives the curve's ENTIRE ETH balance minus caller-reward/accruedFees (as
    ///      `msg.value`) and, before this call, the curve's ENTIRE token balance. Full sequence in
    ///      contracts.md §3.4. Any revert here propagates to `graduate()`, leaving the curve
    ///      `ReadyToGraduate` (retriable) — NEVER a hostile mint.
    function migrate(address token) external payable override returns (uint256 tokenId, uint128 liquidity) {
        if (!ICurveFactory(factory).isCurve(msg.sender)) revert NotCurve();

        Ctx memory c;
        c.token = token;
        c.treasury = ICurveFactory(factory).treasury();
        c.tokenIsToken0 = token < weth;
        c.targetSqrt = c.tokenIsToken0 ? SQRT_PRICE_TOKEN0_X96 : SQRT_PRICE_TOKEN1_X96;
        c.targetTick = c.tokenIsToken0 ? TARGET_TICK_TOKEN0 : TARGET_TICK_TOKEN1;
        c.lpTranche = IBondingCurve(msg.sender).LP_TOKEN_TRANCHE();
        c.gradFee = IBondingCurve(msg.sender).GRADUATION_FEE();

        // Wrap the whole raise to WETH up front. The graduation fee is then paid in WETH, which has
        // no recipient callback — a hostile treasury cannot revert it (TM-T1, decision #1).
        IWETH9(weth).deposit{value: msg.value}();
        if (c.gradFee != 0) IERC20(weth).safeTransfer(c.treasury, c.gradFee); // → treasury FIRST (§6.3 step 1)
        c.wethForMint = msg.value - c.gradFee;

        c.pool = IUniswapV3Factory(v3Factory).getPool(token, weth, FEE_TIER);
        if (c.pool == address(0)) revert NotPool(); // must exist — created at initializePool

        // Pre-seed defense: arb the price back to target, then hard-assert tolerance BEFORE minting.
        _arbToTarget(c);
        (, int24 finalTick,,,,,) = IUniswapV3Pool(c.pool).slot0();
        if (finalTick < c.targetTick - TOLERANCE_TICKS || finalTick != c.targetTick + TOLERANCE_TICKS) {
            revert PoolPriceUnrecoverable(finalTick, c.targetTick);
        }

        // Mint the full-range position → vault; split dust (token→dEaD, WETH→treasury).
        (tokenId, liquidity) = _mintAndSettle(c);
    }

    /// @dev Bounded arb-back. Price-limited to `targetSqrt`, so a swap NEVER overshoots past target.
    ///      Budgets per decision #2: token leg = inventory above `lpTranche`; WETH leg =
    ///      `wethForMint · MIGRATION_SLIPPAGE_BPS / 1e4`. Reverts `ArbBudgetExceeded` when the needed
    ///      leg's budget is exhausted while still off-target. Decomposed into `_withinTolerance`
    ///      (loop guard) and `_arbStep` (one swap) so no single frame exceeds the legacy stack limit.
    function _arbToTarget(Ctx memory c) private {
        uint256 wethArbBudget = (c.wethForMint * MIGRATION_SLIPPAGE_BPS) / BPS;
        uint256 wethArbSpent;
        _activePool = c.pool;
        for (uint256 i = 0; i < MAX_ARB_ITERATIONS; ++i) {
            if (_withinTolerance(c)) break;
            wethArbSpent = _arbStep(c, wethArbBudget, wethArbSpent);
        }
        _activePool = address(0);
    }

    /// @dev True once the pool tick sits within `targetTick ± TOLERANCE_TICKS`.
    function _withinTolerance(Ctx memory c) private view returns (bool) {
        (, int24 curTick,,,,,) = IUniswapV3Pool(c.pool).slot0();
        return curTick >= c.targetTick - TOLERANCE_TICKS && curTick <= c.targetTick + TOLERANCE_TICKS;
    }

    /// @dev One price-limited arb swap toward target. Returns the updated cumulative WETH-arb spend.
    function _arbStep(Ctx memory c, uint256 wethArbBudget, uint256 wethArbSpent) private returns (uint256) {
        (uint160 curSqrt,,,,,,) = IUniswapV3Pool(c.pool).slot0();
        // zeroForOne (token0→token1) lowers the price; use it when we're above target.
        bool zeroForOne = curSqrt > c.targetSqrt;
        address inputAsset = zeroForOne ? IUniswapV3Pool(c.pool).token0() : IUniswapV3Pool(c.pool).token1();

        uint256 budget;
        if (inputAsset == c.token) {
            // SYMMETRIC token-leg budget (M-10-A fix). Previously the floor was `lpTranche`, so at
            // graduation — where the curve forwards ≈ exactly `LP_TOKEN_TRANCHE` (rounding favours the
            // curve, leaving only dust above) — a token-overpriced pool gave `budget ≈ 0`, reverted
            // `ArbBudgetExceeded`, and FROZE the curve in `ReadyToGraduate` (both directions locked,
            // §12.12) while the attacker held a withdrawable concentrated-LP position (UM-2 realised).
            // Fix: mirror the WETH leg — allow the arb to draw the token balance DOWN to the
            // slippage-bounded mint floor `lpTranche·(1 − slippageBps)`, i.e. spend at most
            // dust + `lpTranche·slippageBps`, exactly as the WETH leg may spend `wethForMint·
            // slippageBps`. Token-side mispricing now self-corrects within tolerance just like the
            // WETH side. The mint's `amount0Min`/`amount1Min` re-enforce the SAME floor (decision #2
            // defense-in-depth), so parity holds even if this loop math were wrong. Self-tracking: a
            // token-leg swap only ever REDUCES this balance (sell token → receive WETH) and the loop
            // never flips legs (price-limited to `targetSqrt`, so it approaches target from one side),
            // hence `bal − floor` bounds cumulative spend with no separate accumulator.
            uint256 tokenArbFloor = (c.lpTranche * (BPS - MIGRATION_SLIPPAGE_BPS)) / BPS;
            uint256 bal = IERC20(c.token).balanceOf(address(this));
            budget = bal > tokenArbFloor ? bal - tokenArbFloor : 0;
        } else {
            budget = wethArbBudget > wethArbSpent ? wethArbBudget - wethArbSpent : 0; // TM-T2 cap
        }
        if (budget == 0) revert ArbBudgetExceeded();

        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        IUniswapV3Pool(c.pool).swap(address(this), zeroForOne, _toInt256(budget), c.targetSqrt, "");
        if (inputAsset != c.token) {
            // Track cumulative WETH spent (balance strictly decreases on a WETH-input swap).
            return wethArbSpent + (wethBefore - IERC20(weth).balanceOf(address(this)));
        }
        return wethArbSpent;
    }

    /// @dev Mint the full-range LP position (recipient = vault), then split residuals. Emit values
    ///      live in this memory struct (not on the stack) so the 11-field `Graduated` log stays
    ///      within the stack limit under the single non-viaIR 0.8.35 pin (spec §6.7).
    struct MintLocals {
        address token0;
        address token1;
        uint256 amt0Desired;
        uint256 amt1Desired;
        uint256 amt0Min;
        uint256 amt1Min;
        uint256 tokenId;
        uint128 liquidity;
        uint256 used0;
        uint256 used1;
        uint256 tokensInPosition;
        uint256 wethInPosition;
        uint256 tokensBurned;
        uint256 wethDust;
    }

    function _mintAndSettle(Ctx memory c) private returns (uint256 tokenId, uint128 liquidity) {
        MintLocals memory m;
        address weth_ = weth;
        // BOTH desired amounts read the LIVE, fee-and-arb-adjusted balances (M-10-A: the token leg is
        // now symmetric with the WETH leg — its desired can no longer be the fixed pre-arb `lpTranche`
        // because a token-leg arb legitimately draws the balance down to `lpTranche·(1−slippage)`). At
        // the verified target price the pool ratio is fixed, so whichever side the arb REDUCED becomes
        // the binding side and only its paired counterpart is pulled; the surplus side's leftover is
        // burned/sent-to-treasury in `_settleDust` (so donated tokens are never deposited into the LP,
        // spec §3.4 step 8). Uniswap docs (mint guide) confirm only the ratio-required amounts (≤
        // desired) transfer.
        uint256 tokenBal = IERC20(c.token).balanceOf(address(this)); // fee-and-arb-adjusted
        uint256 wethBal = IERC20(weth_).balanceOf(address(this)); // fee-and-arb-adjusted

        // Amount-mins from the PRE-arb expectation (parity floor, decision #2 defense-in-depth). The
        // arb (either leg) may skew a side by at most `slippageBps`, so both actual balances are ≥
        // their min; `NPM.mint` reverts `InsufficientLiquidityMinted`/amount-min otherwise.
        uint256 tokenMin = (c.lpTranche * (BPS - MIGRATION_SLIPPAGE_BPS)) / BPS;
        uint256 wethMin = (c.wethForMint * (BPS - MIGRATION_SLIPPAGE_BPS)) / BPS;

        if (c.tokenIsToken0) {
            (m.token0, m.token1) = (c.token, weth_);
            (m.amt0Desired, m.amt1Desired) = (tokenBal, wethBal);
            (m.amt0Min, m.amt1Min) = (tokenMin, wethMin);
        } else {
            (m.token0, m.token1) = (weth_, c.token);
            (m.amt0Desired, m.amt1Desired) = (wethBal, tokenBal);
            (m.amt0Min, m.amt1Min) = (wethMin, tokenMin);
        }

        IERC20(c.token).forceApprove(positionManager, tokenBal);
        IERC20(weth_).forceApprove(positionManager, wethBal);

        _mint(m);
        if (m.liquidity == 0) revert InsufficientLiquidityMinted();

        // Reset approvals (hygiene; the position is minted, no residual allowance should linger).
        IERC20(c.token).forceApprove(positionManager, 0);
        IERC20(weth_).forceApprove(positionManager, 0);

        _settleDust(c, m);
        return (m.tokenId, m.liquidity);
    }

    /// @dev Isolated NPM.mint call (12-field param struct + 4-tuple return) — written to the memory
    ///      struct so the deep graduation flow stays within the stack limit under the non-viaIR pin.
    function _mint(MintLocals memory m) private {
        (m.tokenId, m.liquidity, m.used0, m.used1) = INonfungiblePositionManager(positionManager)
            .mint(
                INonfungiblePositionManager.MintParams({
                token0: m.token0,
                token1: m.token1,
                fee: FEE_TIER,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                amount0Desired: m.amt0Desired,
                amount1Desired: m.amt1Desired,
                amount0Min: m.amt0Min,
                amount1Min: m.amt1Min,
                recipient: vault,
                deadline: block.timestamp
            })
            );
    }

    /// @dev Split residuals and emit. Token dust → 0xdEaD ("burned"); WETH dust → treasury via a
    ///      callback-free `transfer` (a hostile treasury cannot revert it). All emit operands read
    ///      from the `c`/`m` memory structs to keep the 11-field log off the stack.
    function _settleDust(Ctx memory c, MintLocals memory m) private {
        if (c.tokenIsToken0) {
            m.tokensInPosition = m.used0;
            m.wethInPosition = m.used1;
        } else {
            m.tokensInPosition = m.used1;
            m.wethInPosition = m.used0;
        }

        m.tokensBurned = IERC20(c.token).balanceOf(address(this));
        if (m.tokensBurned != 0) IERC20(c.token).safeTransfer(DEAD, m.tokensBurned);
        m.wethDust = IERC20(weth).balanceOf(address(this));
        if (m.wethDust != 0) IERC20(weth).safeTransfer(c.treasury, m.wethDust);

        _emitGraduated(c, m);
    }

    /// @dev Isolated so the 11-field `Graduated` log sees only the two memory pointers on the stack
    ///      (keeps the emit within the stack limit under the non-viaIR pin, spec §6.7).
    function _emitGraduated(Ctx memory c, MintLocals memory m) private {
        emit Graduated(
            c.token,
            c.pool,
            m.tokenId,
            m.liquidity,
            m.wethInPosition,
            m.tokensInPosition,
            c.gradFee,
            tx.origin, // event-only provenance for the indexer; NEVER used for authorization
            IBondingCurve(msg.sender).CALLER_REWARD(),
            m.tokensBurned,
            m.wethDust
        );
    }

    // ──────────────────────────────── Callback ─────────────────────────────────

    /// @inheritdoc IUniswapV3SwapCallback
    /// @dev Pays the owed side (positive delta = owed TO the pool) from the migrator's own WETH/
    ///      token balances. Authorised strictly against `_activePool` — reverts `NotPool` otherwise,
    ///      so it is inert outside an in-flight `migrate`.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external override {
        address pool = _activePool;
        if (msg.sender != pool) revert NotPool();
        if (amount0Delta > 0) IERC20(IUniswapV3Pool(pool).token0()).safeTransfer(pool, uint256(amount0Delta));
        if (amount1Delta > 0) IERC20(IUniswapV3Pool(pool).token1()).safeTransfer(pool, uint256(amount1Delta));
    }

    // ─────────────────────────────── Internal ──────────────────────────────────

    /// @dev Checked uint256→int256 cast for `pool.swap`'s exact-input amount. Arb budgets are curve
    ///      inventory (≤ 1e27 token, ≤ a few hundred ETH) — orders of magnitude below int256 max —
    ///      but the guard is free insurance against a future param change.
    function _toInt256(uint256 x) private pure returns (int256) {
        if (x > uint256(type(int256).max)) revert ArbBudgetExceeded();
        // forge-lint: disable-next-line(unsafe-typecast)
        return int256(x);
    }
}
