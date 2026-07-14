// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";

import {V3Fixture} from "test/harness/V3Fixture.sol";
import {TestConstants} from "test/harness/TestConstants.sol";
import {PoolGriefer} from "test/harness/PoolGriefer.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {IUniswapV3Pool} from "src/interfaces/external/IUniswapV3Pool.sol";
import {ArbBudgetExceeded} from "src/errors/Errors.sol";

/// @title V3Migrator arb-back adversarial kill-tests (M1-13 follow-up)
/// @notice Closes the LOCAL half of the M1-13 residual: the arb-back mutation campaign ended at
///         0.585 adequacy with the per-leg budgets, the budget==0 guard, the cumulative WETH-spend
///         accounting, the tolerance boundaries and BOTH address orderings under-pinned by tests.
///         This suite authors the enumerated kill-tests (1) budget-boundary, (2) token>WETH ordering
///         mirror, (3) 2-iteration WETH-leg spend, (4) exact-tolerance-tick boundary, and (5) the
///         M-10-A symmetric-floor freeze regression (separate contract at the bottom). The
///         amount-min floors (`tokenMin`/`wethMin`, survivors 169–174/178/181–186/190) stay with the
///         env-gated gate-3 fork run (M1-12) by design and are NOT attempted here.
///
/// @dev KILL MECHANISM (why these are genuine killers, not padding): every revert expectation is the
///      EXACT `ArbBudgetExceeded()` selector. In the unmutated migrator that error is thrown from a
///      SINGLE site (`_arbStep`, budget == 0), which on a leg-over-budget scenario is reachable only
///      on the SECOND loop iteration after a full-budget exact-input spend (v3-core swap semantics:
///      exact input is fully consumed unless the price limit — the exact target — is reached; the
///      pool itself reverts `'AS'` on a zero-amount swap). Budget/accounting mutants therefore
///      produce a DIFFERENT observable — `'AS'`, `Panic(0x11)`, `PoolPriceUnrecoverable`, NPM
///      `'Price slippage check'`, or an unexpected success/failure — and fail the expectation.
///      Success-path tests pin the complementary boundary: the arb must run (or must NOT run) and
///      the final pool tick is asserted EXACTLY.
///
///      ORDERING (kill-test 2): the campaign proved the legacy suite only ever exercised ONE
///      token/WETH sort order (ordering-sensitive mutants 6/7/19/97/99/100 all survived). This
///      abstract base is instantiated TWICE with the MockWETH9 runtime code `vm.etch`ed at an
///      extreme address, forcing the launch token to be token0 in one run and token1 in the other —
///      every directed arb-back cycle below runs in BOTH orderings.
abstract contract MigratorArbBackKillBase is Test, V3Fixture {
    address internal treasury = makeAddr("killTreasury");
    address internal owner = makeAddr("killOwner");
    address internal buyer = makeAddr("killBuyer");
    address internal grad = makeAddr("killGraduator");

    /// @dev Where to etch MockWETH9 to force the ordering (see {V3Fixture._deployV3FullStack}).
    function _wethAt() internal pure virtual returns (address);
    /// @dev The token/WETH sort order this instantiation forces (asserted on every subject).
    function _expectToken0() internal pure virtual returns (bool);

    function setUp() public {
        _deployV3FullStack(treasury, owner, _wethAt(), TestConstants.MIGRATION_SLIPPAGE_BPS);
    }

    // ────────────────────── exact tick-boundary sqrt prices ──────────────────────
    // getSqrtRatioAtTick(t) for the M0 graduation targets ±174000 (TestConstants; the
    // re-derivation, retargeted to a flat 5.7-ETH raise 2026-07-13, moved the target from ±182400 →
    // ±174000) at the O-8 tolerance boundary ±100 and one tick beyond (: TOLERANCE_TICKS =
    // 100). Pure tick↔sqrt math — NOT market data — computed offline with the bit-exact port of
    // v3-core TickMath.getSqrtRatioAtTick in tools/m0/lib/v3tick.ts (the port reproduces
    // SQRT_PRICE_TOKEN0/1_X96 at ±174000 exactly). Each use is self-validating: the test asserts
    // slot0.tick equals the intended boundary tick right after setting the price, so a stale constant
    // fails loudly here and never silently weakens a kill.
    uint160 internal constant SQRT_T0_UP_TOL = 13_270_211_984_268_622_465_799_735; // tick −173900
    uint160 internal constant SQRT_T0_DN_TOL = 13_138_177_737_490_687_459_419_401; // tick −174100
    uint160 internal constant SQRT_T0_UP_TOL1 = 13_270_875_478_280_900_253_003_126; // tick −173899
    uint160 internal constant SQRT_T0_DN_TOL1 = 13_137_520_877_867_874_119_308_261; // tick −174101
    uint160 internal constant SQRT_T1_UP_TOL = 477_775_674_892_458_050_763_727_428_404_715; // tick 174100
    uint160 internal constant SQRT_T1_DN_TOL = 473_021_963_991_831_318_245_719_935_450_742; // tick 173900
    uint160 internal constant SQRT_T1_UP_TOL1 = 477_799_563_079_012_939_164_193_231_889_723; // tick 174101
    uint160 internal constant SQRT_T1_DN_TOL1 = 472_998_314_667_316_285_218_458_002_697_789; // tick 173899

    /// @dev (`sqrtPriceX96`, tick) of the tolerance boundary: `up` = higher-tick side, `beyond` =
    ///      one tick past the boundary.
    function _boundary(bool up, bool beyond) internal pure returns (uint160 sqrtP, int24 tick) {
        if (_expectToken0()) {
            if (up) return beyond ? (SQRT_T0_UP_TOL1, int24(-173_899)) : (SQRT_T0_UP_TOL, int24(-173_900));
            return beyond ? (SQRT_T0_DN_TOL1, int24(-174_101)) : (SQRT_T0_DN_TOL, int24(-174_100));
        }
        if (up) return beyond ? (SQRT_T1_UP_TOL1, int24(174_101)) : (SQRT_T1_UP_TOL, int24(174_100));
        return beyond ? (SQRT_T1_DN_TOL1, int24(173_899)) : (SQRT_T1_DN_TOL, int24(173_900));
    }

    // ── helpers (conventions mirror test/unit/Migrator.t.sol) ────────────────────

    function _subject(string memory tag) internal returns (LaunchToken token, BondingCurve curve, address pool) {
        (token, curve, pool) = _createSubject(makeAddr(tag));
        // The forced ordering must actually be in effect, else every kill below is vacuous.
        assertEq(address(token) < address(weth), _expectToken0(), "fixture: forced token/WETH ordering not in effect");
    }

    function _fillToReady(BondingCurve curve, LaunchToken token) internal {
        vm.warp(uint256(curve.EARLY_WINDOW_END()) + 1);
        (,, uint256 realEth,) = curve.reserves();
        uint256 remaining = curve.GRADUATION_ETH() - realEth;
        uint256 gross = (remaining * 10_000) / (10_000 - curve.TRADE_FEE_BPS()) + 1e15;
        vm.deal(buyer, gross);
        vm.prank(buyer);
        router.buy{value: gross}(address(token), buyer, 0, block.timestamp);
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "not ready");
    }

    function _newGriefer(LaunchToken token, BondingCurve curve, address pool, uint256 tokenBuyEth)
        internal
        returns (PoolGriefer g)
    {
        g = new PoolGriefer(pool, address(token), address(weth), address(npm));
        vm.deal(address(g), 100 ether);
        vm.prank(address(g));
        weth.deposit{value: 50 ether}();
        if (tokenBuyEth > 0) {
            vm.warp(uint256(curve.EARLY_WINDOW_END()) + 1);
            vm.deal(address(g), address(g).balance + tokenBuyEth);
            vm.prank(address(g));
            router.buy{value: tokenBuyEth}(address(token), address(g), 0, block.timestamp);
        }
    }

    function _tickOf(address pool) internal view returns (int24 tick) {
        (, tick,,,,,) = IUniswapV3Pool(pool).slot0();
    }

    function _targetTick(LaunchToken token) internal view returns (int24) {
        return address(token) < address(weth) ? migrator.TARGET_TICK_TOKEN0() : migrator.TARGET_TICK_TOKEN1();
    }

    function _targetSqrt(LaunchToken token) internal view returns (uint160) {
        return address(token) < address(weth) ? migrator.SQRT_PRICE_TOKEN0_X96() : migrator.SQRT_PRICE_TOKEN1_X96();
    }

    /// @dev Set the (liquidity-free) pool price EXACTLY to `sqrtP` via a price-limited 1-wei swap
    ///      (v3-core: with zero in-range liquidity the swap jumps straight to the limit).
    function _setPoolPrice(PoolGriefer g, address pool, uint160 sqrtP) internal {
        (uint160 cur,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (sqrtP == cur) return;
        g.grief_swap(sqrtP < cur, 1, sqrtP);
    }

    /// @dev Attacker band on the TOKEN-OVERPRICED side of target (the token-selling-arb direction):
    ///      higher ticks for token0, lower ticks for token1; single-sided in the launch token.
    function _mintTokenSideBand(PoolGriefer g, LaunchToken token, uint256 tokenAmt) internal {
        int24 tt = _targetTick(token);
        if (_expectToken0()) g.grief_mint(tt + 400, tt + 2400, tokenAmt, 0);
        else g.grief_mint(tt - 2400, tt - 400, 0, tokenAmt);
    }

    /// @dev Attacker band on the TOKEN-UNDERPRICED side of target (the WETH-buying-arb direction);
    ///      single-sided in WETH.
    function _mintWethSideBand(PoolGriefer g, LaunchToken token, uint256 wethAmt) internal {
        int24 tt = _targetTick(token);
        if (_expectToken0()) g.grief_mint(tt - 2400, tt - 400, 0, wethAmt);
        else g.grief_mint(tt + 400, tt + 2400, wethAmt, 0);
    }

    /// @dev Push the price BEYOND the token-side band (≈ ±2600 ticks) buying the band's tokens with
    ///      WETH — the migrator must then SELL tokens (token leg) to walk back.
    function _griefTokenOverpricedDeep(PoolGriefer g, LaunchToken token) internal {
        uint160 t = _targetSqrt(token);
        if (_expectToken0()) g.grief_swap(false, 40 ether, uint160((uint256(t) * 114) / 100));
        else g.grief_swap(true, 40 ether, uint160((uint256(t) * 88) / 100));
    }

    /// @dev Push the price INTO the token-side band (≈ ±1400 ticks, M-10-A PoC shape) — the
    ///      recoverable token-leg direction.
    function _griefTokenOverpricedRecoverable(PoolGriefer g, LaunchToken token) internal {
        uint160 t = _targetSqrt(token);
        if (_expectToken0()) g.grief_swap(false, 40 ether, uint160((uint256(t) * 107) / 100));
        else g.grief_swap(true, 40 ether, uint160((uint256(t) * 93) / 100));
    }

    /// @dev Sell the griefer's whole token inventory to push the price BEYOND the WETH-side band
    ///      (≈ ±2600 ticks), draining the band's WETH — the migrator must then BUY tokens with WETH
    ///      (WETH leg) to walk back.
    function _griefTokenUnderpricedDeep(PoolGriefer g, LaunchToken token) internal {
        uint160 t = _targetSqrt(token);
        int256 amt = int256(token.balanceOf(address(g)));
        if (_expectToken0()) g.grief_swap(true, amt, uint160((uint256(t) * 88) / 100));
        else g.grief_swap(false, amt, uint160((uint256(t) * 114) / 100));
    }

    function _assertGriefed(LaunchToken token, address pool) internal view {
        assertGt(
            _absDiff(_tickOf(pool), _targetTick(token)),
            uint256(uint24(migrator.TOLERANCE_TICKS())),
            "grief did not move the pool off-target (vacuous scenario)"
        );
    }

    function _assertGraduatedClean(LaunchToken token, BondingCurve curve, address pool) internal view {
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.Graduated), "did not graduate");
        int24 target = _targetTick(token);
        int24 tol = migrator.TOLERANCE_TICKS();
        int24 tick = _tickOf(pool);
        assertTrue(tick >= target - tol && tick <= target + tol, "minted outside tolerance (hostile ratio)");
        assertGt(IUniswapV3Pool(pool).liquidity(), 0, "no liquidity minted");
        assertEq(npm.balanceOf(address(vault)), 1, "LP NFT not in vault");
        assertEq(token.balanceOf(address(migrator)), 0, "migrator retained tokens");
        assertEq(weth.balanceOf(address(migrator)), 0, "migrator retained WETH");
    }

    function _absDiff(int24 a, int24 b) internal pure returns (uint256) {
        return a >= b ? uint256(uint24(a - b)) : uint256(uint24(b - a));
    }

    // ────────────────────────────── kill-test 2 ──────────────────────────────
    // Ordering mirror of the CLEAN path. In the token0 ordering the final tolerance check's LOWER
    // bound goes hugely wrong under survivors 6 (`targetTick / TOLERANCE_TICKS`), 7 (`%`) and 19
    // (dropped `c.targetTick`): with target −174000 every graduation then reverts
    // PoolPriceUnrecoverable. The legacy suite never ran token0, so they lived. Kills: 6, 7, 19.

    function test_ordering_cleanGraduation_mintsExactlyAtTarget() public {
        (LaunchToken token, BondingCurve curve, address pool) = _subject("clean");
        _fillToReady(curve, token);
        vm.prank(grad);
        curve.graduate();
        _assertGraduatedClean(token, curve, pool);
        // No grief and no arb: the pool must still sit EXACTLY at the M0 graduation tick.
        assertEq(_tickOf(pool), _targetTick(token), "clean graduation moved the pool off the init price");
    }

    // ────────────────────────────── kill-test 1a ──────────────────────────────
    // TOKEN-leg budget OVER the boundary. The attacker's token-side band holds ≈ 4.5e24 tokens —
    // more than 2× the symmetric token budget `dust + LP_TOKEN_TRANCHE·slippageBps ≈ 2.07e24` — so
    // iteration 1 fully spends the budget (exact-input, limit not reached), stalls mid-band OUTSIDE
    // tolerance, and iteration 2 must revert EXACTLY ArbBudgetExceeded with the curve retriable.
    // Kills (L308 floor / L310 budget): 110, 111, 112, 113, 114, 115, 119 (floor shrunk → budget
    // inflated → the arb walks the whole band, over-draining the token side below `tokenMin` → NPM
    // 'Price slippage check', not ArbBudgetExceeded); 120, 121 (budget inflated, same); 129, 130
    // (budget-0 → 1: dust swaps until iterations exhaust → PoolPriceUnrecoverable). In the token0
    // run additionally kills 97 (`inputAsset` forced to token1: the token-leg step then walks the
    // WETH branch and its spend tracking underflows → Panic(0x11)). Also pins the L314 guard on the
    // token path (154/150/151/152 analogues: without the revert the loop feeds the pool a
    // zero-amount swap → v3-core 'AS').

    function test_budgetBoundary_tokenLeg_overBudget_revertsArbBudgetExceeded() public {
        (LaunchToken token, BondingCurve curve, address pool) = _subject("tokOver");
        PoolGriefer g = _newGriefer(token, curve, pool, 0.5 ether);
        require(token.balanceOf(address(g)) >= 4_500_000e18, "griefer under-funded");

        _mintTokenSideBand(g, token, 4_500_000e18);
        _griefTokenOverpricedDeep(g, token);
        _assertGriefed(token, pool);

        _fillToReady(curve, token);

        vm.expectRevert(ArbBudgetExceeded.selector);
        vm.prank(grad);
        curve.graduate();

        // Clean freeze: still permissionlessly retriable, never a hostile mint.
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "curve stranded");
    }

    // ────────────────────────────── kill-test 1b ──────────────────────────────
    // WETH-leg budget WITHIN the boundary. Walking back the 0.015-ETH band costs ≈ 0.015 ETH — far
    // above the mutated budgets of survivors 27/28 (`(wethForMint ± bps)/BPS ≈ 5.7e14 wei`), 29
    // (`/bps/BPS ≈ 5.7e12`) and 34 (`%`, < 1e4 wei) but comfortably inside the real
    // `wethForMint·1% ≈ 5.75e16` (G=5.749). The mutants exhaust their tiny budget and revert
    // ArbBudgetExceeded where graduation MUST succeed. Kills: 27, 28, 29, 34.

    function test_budgetBoundary_wethLeg_withinBudget_graduates() public {
        (LaunchToken token, BondingCurve curve, address pool) = _subject("wethIn");
        PoolGriefer g = _newGriefer(token, curve, pool, 0.1 ether);

        // Band sized so the WETH-leg walk-back cost stays under the ~1% budget: at G=5.749,
        // wethForMint ≈ 5.747 ETH → 1% budget ≈ 0.0575 ETH, so a 0.015-ETH band recovers within budget
        // (even more headroom than at the prior G=2.484 / ~0.0248-ETH budget).
        _mintWethSideBand(g, token, 0.015 ether);
        _griefTokenUnderpricedDeep(g, token);
        _assertGriefed(token, pool);

        _fillToReady(curve, token);
        vm.prank(grad);
        curve.graduate(); // must NOT revert: cost ≈ 0.03 ETH < the 1% WETH-leg budget
        _assertGraduatedClean(token, curve, pool);
    }

    // ────────────────────────────── kill-test 3 ──────────────────────────────
    // 2-iteration WETH-leg spend. The band needs ≈ 2 ETH of arb WETH ≫ the ~0.0575 ETH budget, so
    // iteration 1 consumes the ENTIRE budget as one exact-input swap (v3-core: input is fully
    // consumed unless the price limit is reached) and the loop provably ENTERS iteration 2, whose
    // budget recomputation `wethArbBudget − wethArbSpent == 0` must throw EXACTLY ArbBudgetExceeded
    // — the only site that error exists. A second PRODUCTIVE spend is unreachable by construction
    // (full consumption or target reached), so this is the strongest multi-iteration observable;
    // the iteration-2 entry + cumulative-spend accounting is what it pins.
    // Kills (survivor IDs): 55 (loop `break` after the first step → the second iteration never
    // runs → PoolPriceUnrecoverable instead); 31, 32, 33 (wethArbBudget formula inflated ≈ 807 ETH
    // → the arb over-spends ≈ 2 ETH, recovers, then NPM 'Price slippage check' on `wethMin`);
    // 133 (budget grows with spend → same over-spend path); 142, 143 (exhausted budget → 1 wei:
    // dust swaps until iterations exhaust → PoolPriceUnrecoverable); 150, 151, 152, 154 (budget==0
    // guard weakened/removed → zero-amount pool swap → v3-core 'AS'); 157 (spend accumulator `−` →
    // Panic(0x11) underflow on iteration 1); 158, 163, 166 (accumulator zeroed/shrunk → budget
    // refills each iteration → 8·B total ≈ 0.46 ETH < 2 ETH → PoolPriceUnrecoverable);
    // 104, 107 (`if (true)` leg confusion: WETH-input swap draws the TOKEN budget ≈ 2.07e24 → the
    // price-limited swap spends ≈ 2 ETH, recovers → 'Price slippage check'); 100 in the token0 run
    // and 99 in the token1 run (`==` → `>=`/`<=` on the input-asset compare: WETH input classified
    // as the token leg → same over-spend as 104). The retry coda pins retriability: after a
    // third party corrects the price, the SAME curve graduates.

    function test_wethLeg_secondIteration_budgetExhausted_revertsExactly_thenRetriable() public {
        (LaunchToken token, BondingCurve curve, address pool) = _subject("wethOver");
        PoolGriefer g = _newGriefer(token, curve, pool, 0.5 ether);

        _mintWethSideBand(g, token, 2 ether);
        _griefTokenUnderpricedDeep(g, token);
        _assertGriefed(token, pool);

        _fillToReady(curve, token);

        vm.expectRevert(ArbBudgetExceeded.selector); // iteration 2, budget exhausted — exact error
        vm.prank(grad);
        curve.graduate();
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "curve stranded");

        // retriability: anyone can correct the pool price; the same curve then graduates.
        _setPoolPriceCorrective(g, token);
        vm.prank(grad);
        curve.graduate();
        _assertGraduatedClean(token, curve, pool);
    }

    /// @dev Third-party correction: buy the price back up (token0) / down (token1) to the exact
    ///      graduation target with the griefer's own WETH (strictly money-losing griefing).
    function _setPoolPriceCorrective(PoolGriefer g, LaunchToken token) internal {
        uint160 t = _targetSqrt(token);
        if (_expectToken0()) g.grief_swap(false, 10 ether, t);
        else g.grief_swap(true, 10 ether, t);
    }

    // ────────────────────────────── kill-test 4 ──────────────────────────────
    // Exact tolerance-tick boundary (O-8: TOLERANCE_TICKS = 100). At EXACTLY
    // target ± 100 the boundary is INCLUSIVE: `_withinTolerance` breaks before any swap, the final
    // check passes, and the pool tick after graduation is UNCHANGED (the arb demonstrably did not
    // run). One tick beyond, the arb MUST run — and, being price-limited, lands EXACTLY on the
    // target tick. A genuine graduation FAILURE just beyond the boundary requires the arb budget to
    // bind (an empty pool recovers a 1-tick error for free), which is precisely what kill-tests 1a
    // and 3 assert; the boundary pair here pins the inclusive/exclusive edge itself.
    // Kills: 71, 74 (`_withinTolerance` boundary made exclusive → the arb runs at exactly ±100 and
    // moves the tick to target, failing the tick-unchanged assert); 9, 10 (final-check lower bound
    // `==`/`<=` → spurious PoolPriceUnrecoverable at exactly −100); 14, 15 (upper bound mirror at
    // exactly +100).

    function test_toleranceBoundary_exactUpper_graduates_withoutArb() public {
        _runBoundaryInclusive(true, "bUp");
    }

    function test_toleranceBoundary_exactLower_graduates_withoutArb() public {
        _runBoundaryInclusive(false, "bDn");
    }

    function _runBoundaryInclusive(bool up, string memory tag) internal {
        (LaunchToken token, BondingCurve curve, address pool) = _subject(tag);
        PoolGriefer g = _newGriefer(token, curve, pool, 0);

        (uint160 sqrtP, int24 btick) = _boundary(up, false);
        // Constant self-validation: the boundary tick must be exactly target ± TOLERANCE_TICKS.
        assertEq(
            btick,
            up ? _targetTick(token) + migrator.TOLERANCE_TICKS() : _targetTick(token) - migrator.TOLERANCE_TICKS()
        );
        _setPoolPrice(g, pool, sqrtP);
        assertEq(_tickOf(pool), btick, "boundary sqrt constant stale vs M0 target");

        _fillToReady(curve, token);
        vm.prank(grad);
        curve.graduate(); // inclusive boundary: must succeed
        _assertGraduatedClean(token, curve, pool);
        assertEq(_tickOf(pool), btick, "arb ran at the INCLUSIVE tolerance boundary (must not)");
    }

    function test_toleranceBoundary_justBeyondUpper_arbRunsBackToExactTarget() public {
        _runBoundaryBeyond(true, "b1Up");
    }

    function test_toleranceBoundary_justBeyondLower_arbRunsBackToExactTarget() public {
        _runBoundaryBeyond(false, "b1Dn");
    }

    function _runBoundaryBeyond(bool up, string memory tag) internal {
        (LaunchToken token, BondingCurve curve, address pool) = _subject(tag);
        PoolGriefer g = _newGriefer(token, curve, pool, 0);

        (uint160 sqrtP, int24 btick) = _boundary(up, true);
        _setPoolPrice(g, pool, sqrtP);
        assertEq(_tickOf(pool), btick, "beyond-boundary sqrt constant stale vs M0 target");

        _fillToReady(curve, token);
        vm.prank(grad);
        curve.graduate(); // 1 tick beyond: the arb must run (empty pool → free recovery)
        _assertGraduatedClean(token, curve, pool);
        assertEq(
            _tickOf(pool), _targetTick(token), "arb did not run at boundary+1, or overshot the price-limited target"
        );
    }

    // ────────────────────────── kill-test 2 (directed mirror) ──────────────────────────
    // Token-leg RECOVERABLE grief (M-10-A PoC shape) in BOTH orderings. The token0 run is the
    // mirror the legacy suite never executed: survivor 97 (`inputAsset` forced to token1) makes the
    // token0 token-leg step walk the WETH branch — its spend tracking underflows (Panic) instead of
    // graduating. The token1 run intentionally overlaps test_M10A_tokenLegGrief_recoverable_*
    // (unit/Migrator.t.sol) so the directed cycle stays ordering-symmetric here.

    function test_ordering_tokenLegRecoverable_graduates() public {
        (LaunchToken token, BondingCurve curve, address pool) = _subject("tokRec");
        PoolGriefer g = _newGriefer(token, curve, pool, 0.1 ether);
        require(token.balanceOf(address(g)) >= 900_000e18, "griefer under-funded");

        _mintTokenSideBand(g, token, 900_000e18);
        _griefTokenOverpricedRecoverable(g, token);
        _assertGriefed(token, pool);

        _fillToReady(curve, token);
        vm.prank(grad);
        curve.graduate(); // recoverable range: LIVENESS — must succeed (M-10-A)
        _assertGraduatedClean(token, curve, pool);
    }
}

/// @notice Kill-test 2 instantiation A — WETH etched at the MAXIMUM address: every CREATE2 subject
///         token sorts BELOW it ⇒ launch token is token0 (the ordering the legacy suite never ran).
contract MigratorArbBackKillToken0Test is MigratorArbBackKillBase {
    function _wethAt() internal pure override returns (address) {
        return address(type(uint160).max);
    }

    function _expectToken0() internal pure override returns (bool) {
        return true;
    }
}

/// @notice Kill-test 2 instantiation B — WETH etched at a tiny address: every subject token sorts
///         ABOVE it ⇒ launch token is token1.
contract MigratorArbBackKillToken1Test is MigratorArbBackKillBase {
    function _wethAt() internal pure override returns (address) {
        return address(0x1001);
    }

    function _expectToken0() internal pure override returns (bool) {
        return false;
    }
}

/// @title Kill-test 5 — M-10-A symmetric-floor freeze REGRESSION (finding M-10-A / UM-2 realised)
/// @notice The M1-10 re-gate proved liveness of the FIXED code (directed unit tests + the
///         `ghost_tokenLegLivenessGraduations` afterInvariant coverage in
///         invariant/PoolGriefingNoHostileMint.t.sol). This suite EXTENDS that with the missing
///         half: demonstrating that REVERTING the fix reproduces the freeze. Deploying the real
///         V3Migrator with `migrationSlippageBps = 0` makes `tokenArbFloor == LP_TOKEN_TRANCHE` —
///         byte-for-byte the PRE-FIX token-leg budget rule (budget ≈ dust at graduation, since the
///         curve forwards ≈ exactly the tranche) — and symmetrically zeroes the WETH budget. The
///         SAME recoverable token-leg grief that the live config graduates
///         (test_M10A_tokenLegGrief_recoverable_graduates and test_ordering_tokenLegRecoverable_*
/// above) then freezes in `ReadyToGraduate` (two-way lock) with EXACTLY
///         ArbBudgetExceeded — the M-10-A PoC, now a committed regression. Kills any future mutant
///         re-introducing an asymmetric (tranche-anchored) token floor, and pins that
/// `MIGRATION_SLIPPAGE_BPS > 0` is load-bearing for graduation liveness.
contract MigratorM10AFloorRegressionTest is Test, V3Fixture {
    address internal treasury = makeAddr("m10aTreasury");
    address internal owner = makeAddr("m10aOwner");
    address internal buyer = makeAddr("m10aBuyer");
    address internal grad = makeAddr("m10aGraduator");

    function setUp() public {
        // slippageBps = 0 ⇒ the pre-M-10-A token-leg floor (and a zero WETH budget): the fix undone.
        _deployV3FullStack(treasury, owner, address(0), 0);
    }

    function test_M10A_regression_preFixTokenFloor_freezesGraduation() public {
        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(makeAddr("m10aCreator"));
        PoolGriefer g = new PoolGriefer(pool, address(token), address(weth), address(npm));
        vm.deal(address(g), 100 ether);
        vm.prank(address(g));
        weth.deposit{value: 50 ether}();
        vm.warp(uint256(curve.EARLY_WINDOW_END()) + 1);
        vm.deal(address(g), address(g).balance + 0.1 ether);
        vm.prank(address(g));
        router.buy{value: 0.1 ether}(address(token), address(g), 0, block.timestamp);
        require(token.balanceOf(address(g)) >= 900_000e18, "griefer under-funded");

        // The exact M-10-A PoC grief (recoverable under the LIVE 100-bps config — proven by
        // unit/Migrator.t.sol::test_M10A_tokenLegGrief_recoverable_graduates).
        bool t0 = address(token) < address(weth);
        int24 tt = t0 ? migrator.TARGET_TICK_TOKEN0() : migrator.TARGET_TICK_TOKEN1();
        uint160 target = t0 ? migrator.SQRT_PRICE_TOKEN0_X96() : migrator.SQRT_PRICE_TOKEN1_X96();
        if (t0) {
            g.grief_mint(tt + 400, tt + 2400, 900_000e18, 0);
            g.grief_swap(false, 40 ether, uint160((uint256(target) * 107) / 100));
        } else {
            g.grief_mint(tt - 2400, tt - 400, 0, 900_000e18);
            g.grief_swap(true, 40 ether, uint160((uint256(target) * 93) / 100));
        }

        // Fill to ReadyToGraduate.
        (,, uint256 realEth,) = curve.reserves();
        uint256 gross = ((curve.GRADUATION_ETH() - realEth) * 10_000) / (10_000 - curve.TRADE_FEE_BPS()) + 1e15;
        vm.deal(buyer, gross);
        vm.prank(buyer);
        router.buy{value: gross}(address(token), buyer, 0, block.timestamp);

        // THE FREEZE: pre-fix floor ⇒ token budget ≈ dust ⇒ exact ArbBudgetExceeded, curve locked
        // in ReadyToGraduate (both directions) while the attacker's LP stays withdrawable.
        vm.expectRevert(ArbBudgetExceeded.selector);
        vm.prank(grad);
        curve.graduate();
        assertEq(
            uint8(curve.phase()),
            uint8(IBondingCurve.Phase.ReadyToGraduate),
            "freeze not reproduced: pre-fix floor should lock the curve"
        );
    }
}
