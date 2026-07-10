// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {V3Fixture} from "test/harness/V3Fixture.sol";
import {PoolGriefer} from "test/harness/PoolGriefer.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {IUniswapV3Pool} from "src/interfaces/external/IUniswapV3Pool.sol";

/// @title PoolGriefHandler — adversarial handler for gate-2 invariant 6 (pre-seed defense)
///        (spec §6.3.2, §10 gate 2; contracts.md §6 test matrix row 6)
/// @notice Deploys the REAL Uniswap V3 stack once (V3Fixture), then each fuzz call runs an
///         INDEPENDENT full lifecycle on a FRESH subject token/pool: create → fuzz-grief the
///         near-empty pool (donations, sync-style dual inflation, price-limited swaps both
///         directions, attacker concentrated liquidity at hostile ticks) → fill the curve →
///         graduate. Because graduation is a one-time terminal event, a fresh subject per call is
///         what actually exercises the arb-back across many griefed states. The griefer is a
///         CONTRACT so `pool.swap`/`npm.mint` call back to collect owed amounts from its own funded
///         balances — griefing is strictly money-losing.
/// @dev Recorded ghost state is monotonic across the campaign (a single hostile mint anywhere trips
///      the invariant forever).
contract PoolGriefHandler is V3Fixture {
    uint160 internal constant MIN_SQRT = 4_295_128_739;
    uint160 internal constant MAX_SQRT = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;

    address internal buyer = makeAddr("griefFiller");

    // ── Ghost state (contracts.md §6 row 6) ──────────────────────────────────────
    /// @notice MUST remain false forever: set if graduation minted while the pool tick was outside
    ///         target ± TOLERANCE_TICKS (the hostile-ratio mint).
    bool public ghost_mintedOutsideTolerance;
    /// @notice True once at least one graduate() has succeeded (coverage sentinel).
    bool public ghost_graduated;
    /// @notice Pool tick of the most recent successful migration mint.
    int24 public ghost_tickAtMint;
    /// @notice Target tick of the most recent successful migration mint.
    int24 public ghost_targetAtMint;
    /// @notice True if a FAILED graduate() left the curve non-retriable (stranded = liveness break).
    bool public ghost_curveStranded;
    /// @notice Count of full griefing lifecycles executed (coverage).
    uint256 public ghost_cycles;
    /// @notice Count of successful graduations (coverage).
    uint256 public ghost_graduations;
    /// @notice M-10-A LIVENESS coverage: count of graduations that SUCCEEDED while the pre-graduation
    ///         pool was mispriced in the TOKEN-selling-arb direction beyond tolerance (token0 →
    ///         tick > target+tol; token1 → tick < target−tol). Pre-fix these froze (`ArbBudgetExceeded`
    ///         with ≈0 token budget); this counter proves the symmetric token-leg budget lets the
    ///         arb-back self-heal token-side mispricing across the fuzz campaign, not just in the
    ///         directed unit PoC.
    uint256 public ghost_tokenLegLivenessGraduations;

    receive() external payable {} // accept curve refunds + graduation caller reward

    constructor() {
        _deployV3FullStack(makeAddr("griefTreasury"), makeAddr("griefOwner"));
    }

    /// @notice One independent, fuzz-parameterized griefed graduation.
    function fullGriefCycle(
        uint8 kind,
        bool zeroForOne,
        uint256 amountIn,
        uint256 sqrtLimitSeed,
        int24 tLow,
        int24 tHigh,
        uint256 mintAmt0,
        uint256 mintAmt1
    ) external {
        ghost_cycles += 1;

        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(makeAddr("griefCreator"));
        vm.warp(uint256(curve.EARLY_WINDOW_END()) + 1);
        PoolGriefer griefer = new PoolGriefer(pool, address(token), address(weth), address(npm));
        _fundWeth(griefer, 80 ether);
        _fundTokens(token, curve, griefer, 2 ether);

        _grief(kind, token, pool, griefer, zeroForOne, amountIn, sqrtLimitSeed, tLow, tHigh, mintAmt0, mintAmt1);
        _fillToGraduation(token, curve);
        _graduateAndRecord(token, curve, pool);
    }

    /// @notice DIRECTED M-10-A liveness cycle: a recoverable TOKEN-leg grief (attacker concentrated
    ///         LP on the token-overpriced side + a swap into it) that MUST graduate within tolerance.
    ///         Guarantees the campaign exercises the symmetric token-leg budget's liveness (not just
    ///         the random menu, which may under-sample this direction). Sized inside the
    ///         slippage-recoverable range (`< LP_TOKEN_TRANCHE · MIGRATION_SLIPPAGE_BPS`).
    function tokenLegRecoverableGraduation(uint256 amtSeed) external {
        ghost_cycles += 1;

        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(makeAddr("griefCreator"));
        vm.warp(uint256(curve.EARLY_WINDOW_END()) + 1);
        PoolGriefer griefer = new PoolGriefer(pool, address(token), address(weth), address(npm));
        _fundWeth(griefer, 80 ether);
        _fundTokens(token, curve, griefer, 0.1 ether); // ~ tens of millions of tokens of inventory

        uint256 hostile = bound(amtSeed, 200_000e18, 1_800_000e18); // < lpTranche·1% budget
        if (token.balanceOf(address(griefer)) < hostile) return; // under-funded (curve state edge)

        bool tokenIsToken0 = address(token) < address(weth);
        int24 tt = tokenIsToken0 ? migrator.TARGET_TICK_TOKEN0() : migrator.TARGET_TICK_TOKEN1();
        uint160 target = tokenIsToken0 ? migrator.SQRT_PRICE_TOKEN0_X96() : migrator.SQRT_PRICE_TOKEN1_X96();

        if (tokenIsToken0) {
            try griefer.grief_mint(((tt + 400) / 200) * 200, ((tt + 2400) / 200) * 200, hostile, 0) {} catch {}
            try griefer.grief_swap(false, 40 ether, uint160((uint256(target) * 107) / 100)) {} catch {}
        } else {
            try griefer.grief_mint(((tt - 2400) / 200) * 200, ((tt - 400) / 200) * 200, 0, hostile) {} catch {}
            try griefer.grief_swap(true, 40 ether, uint160((uint256(target) * 93) / 100)) {} catch {}
        }

        _fillToGraduation(token, curve);
        _graduateAndRecord(token, curve, pool); // increments ghost_tokenLegLivenessGraduations on success
    }

    // ── griefing menu ────────────────────────────────────────────────────────

    function _grief(
        uint8 kind,
        LaunchToken token,
        address pool,
        PoolGriefer griefer,
        bool zeroForOne,
        uint256 amountIn,
        uint256 sqrtLimitSeed,
        int24 tLow,
        int24 tHigh,
        uint256 mintAmt0,
        uint256 mintAmt1
    ) internal {
        uint8 k = kind % 6;
        if (k == 4) {
            // (a) inert donations, both assets
            _donate(token, pool, griefer, amountIn);
            return;
        }
        if (k == 5) {
            // (b) sync-style: dual-side inflation then a swap
            _donate(token, pool, griefer, amountIn);
            _swap(pool, griefer, zeroForOne, amountIn, sqrtLimitSeed);
            return;
        }
        if (k == 2 || k == 3) {
            // (d) attacker concentrated liquidity at a hostile range, then a hard swap
            _mintHostile(pool, griefer, tLow, tHigh, mintAmt0, mintAmt1);
        }
        // (c) price-limited swap (k==0 up-ish / k==1 down-ish; direction still fuzzed)
        _swap(pool, griefer, zeroForOne, amountIn, sqrtLimitSeed);
    }

    function _donate(LaunchToken token, address pool, PoolGriefer griefer, uint256 seed) internal {
        uint256 tb = token.balanceOf(address(griefer));
        uint256 wb = weth.balanceOf(address(griefer));
        if (tb != 0) {
            try griefer.grief_donate(address(token), bound(seed, 1, tb)) {} catch {}
        }
        if (wb != 0) {
            try griefer.grief_donate(address(weth), bound(seed, 1, wb)) {} catch {}
        }
    }

    function _swap(address pool, PoolGriefer griefer, bool zeroForOne, uint256 amountIn, uint256 sqrtLimitSeed)
        internal
    {
        (uint160 cur,,,,,,) = IUniswapV3Pool(pool).slot0();
        uint160 limit;
        if (zeroForOne) {
            if (cur <= MIN_SQRT + 1) return;
            limit = uint160(bound(sqrtLimitSeed, MIN_SQRT + 1, cur - 1));
        } else {
            if (cur >= MAX_SQRT - 1) return;
            limit = uint160(bound(sqrtLimitSeed, cur + 1, MAX_SQRT - 1));
        }
        try griefer.grief_swap(zeroForOne, int256(bound(amountIn, 1, 20 ether)), limit) {} catch {}
    }

    function _mintHostile(address pool, PoolGriefer griefer, int24 tLow, int24 tHigh, uint256 a0, uint256 a1) internal {
        int24 lo = int24(bound(int256(tLow), -887_200, 887_000) / 200 * 200);
        int24 hi = int24(bound(int256(tHigh), -887_000, 887_200) / 200 * 200);
        if (lo >= hi) return;
        uint256 tb = _grieferTokenBal(griefer);
        uint256 wb = weth.balanceOf(address(griefer));
        a0 = bound(a0, 0, tb);
        a1 = bound(a1, 0, wb);
        if (a0 == 0 && a1 == 0) return;
        try griefer.grief_mint(lo, hi, a0, a1) {} catch {}
    }

    function _grieferTokenBal(PoolGriefer griefer) private view returns (uint256) {
        return LaunchToken(griefer.token()).balanceOf(address(griefer));
    }

    // ── lifecycle ─────────────────────────────────────────────────────────────

    function _fundWeth(PoolGriefer griefer, uint256 amount) internal {
        vm.deal(address(griefer), address(griefer).balance + amount);
        vm.prank(address(griefer));
        weth.deposit{value: amount}();
    }

    function _fundTokens(LaunchToken token_, BondingCurve curve, PoolGriefer griefer, uint256 ethIn) internal {
        if (curve.phase() != IBondingCurve.Phase.Trading) return;
        vm.deal(address(this), address(this).balance + ethIn);
        try router.buy{value: ethIn}(address(token_), address(griefer), 0, block.timestamp) returns (uint256) {}
            catch {}
    }

    function _fillToGraduation(LaunchToken token_, BondingCurve curve) internal {
        if (curve.phase() != IBondingCurve.Phase.Trading) return;
        (,, uint256 realEth,) = curve.reserves();
        uint256 remaining = curve.GRADUATION_ETH() - realEth;
        uint256 gross = (remaining * 10_000) / (10_000 - curve.TRADE_FEE_BPS()) + 1e12;
        vm.deal(buyer, gross);
        vm.prank(buyer);
        try router.buy{value: gross}(address(token_), buyer, 0, block.timestamp) returns (uint256) {} catch {}
    }

    function _graduateAndRecord(LaunchToken token_, BondingCurve curve, address pool) internal {
        if (curve.phase() != IBondingCurve.Phase.ReadyToGraduate) return;
        bool tokenIsToken0 = address(token_) < address(weth);
        int24 target = tokenIsToken0 ? migrator.TARGET_TICK_TOKEN0() : migrator.TARGET_TICK_TOKEN1();
        int24 tolTicks = migrator.TOLERANCE_TICKS();
        // Snapshot the pre-graduation (post-grief) tick to classify the arb-back direction.
        (, int24 tickBefore,,,,,) = IUniswapV3Pool(pool).slot0();
        bool tokenLegDirection =
            (tokenIsToken0 && tickBefore > target + tolTicks) || (!tokenIsToken0 && tickBefore < target - tolTicks);
        try curve.graduate() {
            ghost_graduated = true;
            ghost_graduations += 1;
            if (tokenLegDirection) ghost_tokenLegLivenessGraduations += 1; // M-10-A liveness coverage
            (, int24 tickAfter,,,,,) = IUniswapV3Pool(pool).slot0();
            int24 tol = tolTicks;
            ghost_tickAtMint = tickAfter;
            ghost_targetAtMint = target;
            if (tickAfter > target + tol || tickAfter < target - tol) {
                ghost_mintedOutsideTolerance = true; // row-6 violation
            }
        } catch {
            // Clean revert (PoolPriceUnrecoverable / ArbBudgetExceeded): curve must be retriable.
            if (curve.phase() != IBondingCurve.Phase.ReadyToGraduate) ghost_curveStranded = true;
        }
    }

    // ── views for the invariant contract ─────────────────────────────────────

    function toleranceTicks() external view returns (int24) {
        return migrator.TOLERANCE_TICKS();
    }
}
