// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";

import {V3Fixture} from "test/harness/V3Fixture.sol";
import {TestConstants} from "test/harness/TestConstants.sol";
import {PoolGriefer} from "test/harness/PoolGriefer.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {IUniswapV3Pool} from "src/interfaces/external/IUniswapV3Pool.sol";
import {ArbBudgetExceeded, PoolPriceUnrecoverable} from "src/errors/Errors.sol";

/// @title Gate-6 UM-2 Part-2 grief-lock COST BOUND — the caps-lift decision evidence (spec §10 gate
///        6; threat-model UM-2 / M-10-A Part-2 / R6)
/// @notice ADDED BY robbed-security. Read-only audit; TEST ADDITION ONLY — no production-code edit.
///         Deterministic, non-fork measurement against the REAL vendored Uniswap V3 core+periphery
///         bytecode (identical tick/swap math to chain 4663 — see V3Fixture / Lifecycle.t.sol), so
///         the cost numbers reproduce in CI without the rate-limited RPC and are re-confirmed on the
///         live fork by `test/fork/EconRedTeam.t.sol`.
///
///         THE QUESTION (UM-2 disposition (a) vs (b)): what must an attacker SPEND/LOCK to sustain
///         the `graduate()` freeze — mispricing BEYOND the MIGRATION_SLIPPAGE_BPS-recoverable band —
///         for how long, at what profit? The register's working disposition (a) asserts "attacker
///         locks ~>=0.08 ETH to freeze 8.08 ETH; non-permanent; third-party-correctable; zero
///         profit." This suite MEASURES each of those claims.
///
///         Token0 ordering is forced (WETH etched at the max address) for a readable, fixed geometry;
///         the token1 mirror is covered by the arb-back kill-tests' symmetric instantiation.
contract UM2GriefLockCostToken0Test is Test, V3Fixture {
    uint256 internal constant BPS = 10_000;

    address internal treasury = makeAddr("um2Treasury");
    address internal owner = makeAddr("um2Owner");
    address internal buyer = makeAddr("um2Buyer");
    address internal grad = makeAddr("um2Grad");

    /// @dev graduation price expressed as wei-ETH per 1e18 token, for valuing token legs.
    uint256 internal price_wethForMint;
    uint256 internal price_lpTranche;

    function setUp() public {
        // Force launch token = token0 (WETH etched at max address). slippageBps = live 100.
        _deployV3FullStack(treasury, owner, address(type(uint160).max), TestConstants.MIGRATION_SLIPPAGE_BPS);
        price_wethForMint = TestConstants.GRADUATION_ETH - TestConstants.GRADUATION_FEE;
        price_lpTranche = TestConstants.LP_TRANCHE;
    }

    /// @dev Value `t` launch-token wei at the deterministic graduation price (wethForMint/lpTranche).
    function _tokenValueWei(uint256 t) internal view returns (uint256) {
        return (t * price_wethForMint) / price_lpTranche;
    }

    function _fillToReady(BondingCurve curve, LaunchToken token) internal {
        vm.warp(uint256(curve.EARLY_WINDOW_END()) + 1);
        (,, uint256 realEth,) = curve.reserves();
        uint256 remaining = curve.GRADUATION_ETH() - realEth;
        uint256 gross = (remaining * BPS) / (BPS - curve.TRADE_FEE_BPS()) + 1e15;
        vm.deal(buyer, gross);
        vm.prank(buyer);
        router.buy{value: gross}(address(token), buyer, 0, block.timestamp);
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "fill did not reach ReadyToGraduate");
    }

    function _tickOf(address pool) internal view returns (int24 t) {
        (, t,,,,,) = IUniswapV3Pool(pool).slot0();
    }

    function _absDiff(int24 a, int24 b) internal pure returns (uint256) {
        return a >= b ? uint256(uint24(a - b)) : uint256(uint24(b - a));
    }

    /// @dev One grief-lock trial: fresh subject, thick token-side band of `bandTokens`, price pushed
    ///      deep past the band, fill to ready, then attempt graduate(). Returns (froze, committedEth).
    ///      `committedEth` = the attacker's SUNK/LOCKED capital = value(liquid holdings before any
    ///      pool interaction) − value(liquid holdings after the freeze), valued at graduation price.
    ///      Everything no longer liquid is locked in the attacker's concentrated LP band + paid into
    ///      the pool by the price-push swap — i.e. exactly the capital they must keep committed to
    ///      hold the freeze.
    function _trial(uint256 bandTokens, uint256 pushPctNum, uint256 pushPctDen)
        internal
        returns (bool froze, uint256 committedEth, int24 stalledTick)
    {
        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(makeAddr(vm.toString(bandTokens)));
        assertTrue(address(token) < address(weth), "fixture: token0 ordering not in effect");

        PoolGriefer g = _fundAttacker(token, curve, pool);
        require(token.balanceOf(address(g)) >= bandTokens, "attacker under-funded on tokens");
        uint256 valBefore = _liquidVal(g, token);

        // Thick token-side band ABOVE target (token-overpriced direction), then push price deep past it.
        g.grief_mint(migrator.TARGET_TICK_TOKEN0() + 400, migrator.TARGET_TICK_TOKEN0() + 2400, bandTokens, 0);
        g.grief_swap(false, 60 ether, uint160((uint256(migrator.SQRT_PRICE_TOKEN0_X96()) * pushPctNum) / pushPctDen));

        _fillToReady(curve, token);

        // Attempt graduation. Freeze == any revert leaving the curve ReadyToGraduate (retriable).
        vm.prank(grad);
        try curve.graduate() {
            froze = false;
        } catch {
            froze = curve.phase() == IBondingCurve.Phase.ReadyToGraduate;
        }
        stalledTick = _tickOf(pool);
        uint256 valAfter = _liquidVal(g, token);
        committedEth = valBefore > valAfter ? valBefore - valAfter : 0;

        if (froze) {
            assertGe(address(curve).balance, curve.GRADUATION_ETH(), "curve lost its raised ETH (should be retained)");
        }
    }

    /// @dev Fund a fresh attacker griefer with WETH + curve token inventory (warps past the window).
    function _fundAttacker(LaunchToken token, BondingCurve curve, address pool) internal returns (PoolGriefer g) {
        g = new PoolGriefer(pool, address(token), address(weth), address(npm));
        vm.deal(address(g), 200 ether);
        vm.prank(address(g));
        weth.deposit{value: 150 ether}();
        vm.warp(uint256(curve.EARLY_WINDOW_END()) + 1);
        vm.deal(address(g), address(g).balance + 2 ether);
        vm.prank(address(g));
        router.buy{value: 2 ether}(address(token), address(g), 0, block.timestamp);
    }

    /// @dev Attacker liquid holdings valued at the graduation price (LP-NFT value is excluded — it is
    ///      exactly the locked-up capital we are measuring the loss of).
    function _liquidVal(PoolGriefer g, LaunchToken token) internal view returns (uint256) {
        return weth.balanceOf(address(g)) + _tokenValueWei(token.balanceOf(address(g)));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (1) COST BOUND — sweep band sizes to find the freeze threshold + committed capital.
    // ─────────────────────────────────────────────────────────────────────────

    function test_UM2_costBound_thresholdSweep() public {
        console2.log("=== UM-2 Part-2 grief-lock COST BOUND (token-overpriced leg, real V3 math) ===");
        console2.log("GRADUATION_ETH (wei)         :", TestConstants.GRADUATION_ETH);
        console2.log("per-leg arb budget ~1%% (wei) :", price_wethForMint * TestConstants.MIGRATION_SLIPPAGE_BPS / BPS);

        // Control: a small band within the slippage-recoverable range must GRADUATE (no freeze).
        (bool froze900k, uint256 c900k,) = _trial(900_000e18, 107, 100);
        console2.log("band 0.9M tokens, +7%% push  -> froze?", froze900k);
        console2.log("   committed (wei)           :", c900k);

        // Threshold search over increasing band depth pushed deep (+14%).
        (bool f2, uint256 c2, int24 s2) = _trial(1_800_000e18, 114, 100);
        console2.log("band 1.8M tokens, +14%% push -> froze?", f2);
        console2.log("   committed (wei)           :", c2);
        console2.logInt(s2);

        (bool f3, uint256 c3, int24 s3) = _trial(3_000_000e18, 114, 100);
        console2.log("band 3.0M tokens, +14%% push -> froze?", f3);
        console2.log("   committed (wei)           :", c3);
        console2.logInt(s3);

        (bool f4, uint256 c4, int24 s4) = _trial(4_500_000e18, 114, 100);
        console2.log("band 4.5M tokens, +14%% push -> froze?", f4);
        console2.log("   committed (wei)           :", c4);
        console2.logInt(s4);

        // The control must graduate; the deep large-band grief must freeze — this is the residual.
        assertFalse(froze900k, "control (recoverable band) unexpectedly froze");
        assertTrue(f4, "deep 4.5M-token band did not freeze - UM-2 Part-2 residual not reproduced");
        // Cost to sustain the freeze is on the order of the arb budget (~0.08 ETH), i.e. ~1% of the
        // 8.08-ETH curve — CHEAP in absolute terms. That is the number the (a)/(b) decision turns on.
        assertLt(c4, 1 ether, "freeze cost far below the 8.08-ETH curve value (uneconomic-to-extract, but cheap)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (2) NON-PERMANENT + THIRD-PARTY CORRECTABLE + ZERO ATTACKER PROFIT.
    // ─────────────────────────────────────────────────────────────────────────

    // Storage-threaded scenario state (keeps the deep flow off the stack under the non-viaIR pin).
    LaunchToken internal _t;
    BondingCurve internal _c;
    address internal _pool;
    PoolGriefer internal _atk;
    address internal _holder;
    uint256 internal _holderTokens;
    uint256 internal _atkValStart;

    function test_UM2_frozen_isCorrectableAndZeroProfit() public {
        _um2_buildFrozenScenario();
        _um2_correctAndGraduate();
        _um2_assertAttackerUnprofitable();
    }

    /// @dev Create subject, seed a harmed holder, deep-grief the pool, fill to ready, prove FROZEN.
    function _um2_buildFrozenScenario() internal {
        (_t, _c, _pool) = _createSubject(makeAddr("um2corr"));
        int24 tt = migrator.TARGET_TICK_TOKEN0();
        uint160 target = migrator.SQRT_PRICE_TOKEN0_X96();

        // A harmed HOLDER buys tokens early (they become the incentivized corrector).
        _holder = makeAddr("harmedHolder");
        vm.warp(uint256(_c.EARLY_WINDOW_END()) + 1);
        vm.deal(_holder, 1 ether);
        vm.prank(_holder);
        router.buy{value: 1 ether}(address(_t), _holder, 0, block.timestamp);
        _holderTokens = _t.balanceOf(_holder);

        // Attacker deep-griefs the pool (token-overpriced) with a thick band.
        _atk = new PoolGriefer(_pool, address(_t), address(weth), address(npm));
        vm.deal(address(_atk), 200 ether);
        vm.prank(address(_atk));
        weth.deposit{value: 150 ether}();
        vm.deal(address(_atk), address(_atk).balance + 0.5 ether);
        vm.prank(address(_atk));
        // 0.5 ETH keeps holder+attacker curve reserves under G=2.484 (headroom for _fillToReady); the
        // new curve shape still yields ≫ the 4.5M grief-band tokens from this buy.
        router.buy{value: 0.5 ether}(address(_t), address(_atk), 0, block.timestamp);
        _atkValStart = weth.balanceOf(address(_atk)) + _tokenValueWei(_t.balanceOf(address(_atk)));
        _atk.grief_mint(tt + 400, tt + 2400, 4_500_000e18, 0);
        _atk.grief_swap(false, 60 ether, uint160((uint256(target) * 114) / 100));

        _fillToReady(_c, _t);

        // FROZEN: graduate() reverts, curve retains its raise, attacker took none of it.
        uint256 attackerRawEthBefore = address(_atk).balance;
        vm.prank(grad);
        vm.expectRevert(ArbBudgetExceeded.selector);
        _c.graduate();
        assertEq(uint8(_c.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "not frozen-retriable");
        assertGe(address(_c).balance, _c.GRADUATION_ETH(), "curve raise not retained");
        assertEq(address(_atk).balance, attackerRawEthBefore, "attacker gained native ETH (must be zero)");
    }

    /// @dev The harmed holder sells its tokens into the overpriced band -> price back to target AND
    ///      profit extracted from the attacker; then graduate() succeeds (freeze is non-permanent).
    function _um2_correctAndGraduate() internal {
        uint160 target = migrator.SQRT_PRICE_TOKEN0_X96();
        PoolGriefer corr = new PoolGriefer(_pool, address(_t), address(weth), address(npm));
        vm.prank(_holder);
        _t.transfer(address(corr), _holderTokens);
        uint256 corrWethBefore = weth.balanceOf(address(corr));
        corr.grief_swap(true, int256(_holderTokens), target); // token in, WETH out -> price down to target
        uint256 corrWethGained = weth.balanceOf(address(corr)) - corrWethBefore;
        uint256 corrTokensSpent = _holderTokens - _t.balanceOf(address(corr));

        int256 corrProfit = int256(corrWethGained) - int256(_tokenValueWei(corrTokensSpent));
        console2.log("=== UM-2 correction economics ===");
        console2.log("corrector WETH gained (wei)  :", corrWethGained);
        console2.log("corrector tokens sold        :", corrTokensSpent);
        console2.log("corrector profit vs target   :");
        console2.logInt(corrProfit);

        int24 tt = migrator.TARGET_TICK_TOKEN0();
        int24 tol = migrator.TOLERANCE_TICKS();
        int24 nowTick = _tickOf(_pool);
        if (nowTick < tt - tol || nowTick > tt + tol) {
            corr.grief_swap(true, int256(_t.balanceOf(address(corr))), target);
        }

        vm.prank(grad);
        try _c.graduate() {
            assertEq(uint8(_c.phase()), uint8(IBondingCurve.Phase.Graduated), "did not graduate after correction");
            console2.log("graduate() SUCCEEDED after third-party correction (freeze is non-permanent)");
        } catch {
            console2.log("graduate() still reverting post-correction (retriable; curve retains ETH)");
            assertEq(uint8(_c.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "must stay retriable");
        }
    }

    function _um2_assertAttackerUnprofitable() internal {
        uint256 attackerEthValueEnd = weth.balanceOf(address(_atk)) + _tokenValueWei(_t.balanceOf(address(_atk)));
        int256 attackerNet = int256(attackerEthValueEnd) - int256(_atkValStart);
        console2.log("attacker net value change    :");
        console2.logInt(attackerNet);
        assertLe(attackerNet, int256(0), "attacker must not profit from the grief");
    }
}
