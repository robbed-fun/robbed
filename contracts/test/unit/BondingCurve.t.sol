// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {BaseFixture} from "test/harness/BaseFixture.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {TestConstants} from "test/harness/TestConstants.sol";

import {
    NotRouter,
    NotTrading,
    NotReady,
    ZeroAmount,
    SlippageExceeded,
    EarlyBuyCapExceeded
} from "src/errors/Errors.sol";

/// @title BondingCurve unit suite (M1-8) — trading, clamp, anti-sniper, lock,
/// graduation single-fire + zero-value, sweep, donations.
contract BondingCurveTest is BaseFixture {
    LaunchToken internal token;
    BondingCurve internal curve;

    function setUp() public {
        _deployStack();
        (token, curve) = _create();
        vm.warp(uint256(curve.EARLY_WINDOW_END())); // default: past the anti-sniper window
    }

    // ─────────────────────────────── Access control ──────────────────────────────

    function test_buy_onlyRouter() public {
        vm.deal(address(this), 1 ether);
        vm.expectRevert(NotRouter.selector);
        curve.buy{value: 1 ether}(address(this), address(this), address(this), 0);
    }

    function test_sell_onlyRouter() public {
        vm.expectRevert(NotRouter.selector);
        curve.sell(address(this), address(this), 1, 0);
    }

    // ────────────────────────────────── Buy path ─────────────────────────────────

    function test_buy_accruesFee_notPushedToTreasury() public {
        uint256 tBefore = treasury.balance; // already holds the creation fee (a push, not a trade fee)
        (, uint256 quotedFee,,) = curve.quoteBuy(1 ether);
        uint256 tOut = _buy(curve, token, alice, 1 ether, 0);
        assertGt(tOut, 0, "no tokens out");
        assertEq(curve.accruedFees(), quotedFee, "fee not accrued");
        assertEq(treasury.balance, tBefore, "treasury received a trade fee (must be pull-payment)");
        // 1% ETH-leg fee.
        assertEq(quotedFee, (1 ether * uint256(TestConstants.TRADE_FEE_BPS)) / 10_000, "fee != 1% of gross");
    }

    function test_buy_kNonDecreasing() public {
        (uint256 vE0, uint256 vT0,,) = curve.reserves();
        _buy(curve, token, alice, 2 ether, 0);
        (uint256 vE1, uint256 vT1,,) = curve.reserves();
        assertGe(vE1 * vT1, vE0 * vT0, "k decreased on buy");
    }

    function test_buy_slippageFloor() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(); // SlippageExceeded(actual, min) — actual < type(uint).max
        router.buy{value: 1 ether}(address(token), alice, type(uint256).max, block.timestamp);
    }

    function test_buy_zeroValueReverts() public {
        vm.prank(alice);
        vm.expectRevert(ZeroAmount.selector);
        router.buy{value: 0}(address(token), alice, 0, block.timestamp);
    }

    // ───────────────────────────── Anti-sniper ──────────────────────────

    function test_antiSniper_capEnforcedInsideWindow() public {
        (, BondingCurve fresh) = _create(); // createdAt = now; window open
        LaunchToken freshTok = LaunchToken(fresh.token());
        uint256 overCap = uint256(fresh.MAX_EARLY_BUY()) + 1;
        vm.deal(alice, overCap);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EarlyBuyCapExceeded.selector, overCap, fresh.MAX_EARLY_BUY()));
        router.buy{value: overCap}(address(freshTok), alice, 0, block.timestamp);
        // At the cap exactly: allowed.
        vm.deal(alice, fresh.MAX_EARLY_BUY());
        vm.prank(alice);
        router.buy{value: fresh.MAX_EARLY_BUY()}(address(freshTok), alice, 0, block.timestamp);
    }

    function test_antiSniper_boundary_endMinus1_vs_end() public {
        (, BondingCurve fresh) = _create();
        LaunchToken freshTok = LaunchToken(fresh.token());
        uint256 big = uint256(fresh.MAX_EARLY_BUY()) + 1 ether;
        // t = end - 1: still inside the window ⇒ capped.
        vm.warp(uint256(fresh.EARLY_WINDOW_END()) - 1);
        vm.deal(alice, big);
        vm.prank(alice);
        vm.expectRevert();
        router.buy{value: big}(address(freshTok), alice, 0, block.timestamp);
        // t = end: window closed ⇒ uncapped buy succeeds.
        vm.warp(uint256(fresh.EARLY_WINDOW_END()));
        vm.deal(alice, big);
        vm.prank(alice);
        router.buy{value: big}(address(freshTok), alice, 0, block.timestamp);
    }

    // ──────────────────────── Graduation-boundary clamp ──────────────────

    function test_clamp_exactFill_armsGraduation_noRefund() public {
        uint256 gross = _grossToGraduate(curve);
        uint256 balBefore = alice.balance;
        vm.deal(alice, alice.balance + gross);
        vm.prank(alice);
        router.buy{value: gross}(address(token), alice, 0, block.timestamp);
        (,, uint256 realEth,) = curve.reserves();
        assertEq(realEth, curve.GRADUATION_ETH(), "did not land exactly on GRADUATION_ETH");
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "not armed");
        assertEq(alice.balance, balBefore, "unexpected refund on an exact fill");
    }

    function test_clamp_overshoot_refundsExcess_landsExact() public {
        uint256 gross = _grossToGraduate(curve) + 3 ether; // large overshoot
        vm.deal(alice, gross);
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        router.buy{value: gross}(address(token), alice, 0, block.timestamp);
        (,, uint256 realEth,) = curve.reserves();
        assertEq(realEth, curve.GRADUATION_ETH(), "overshoot did not clamp to threshold");
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "not armed after overshoot");
        // Refund returned: net spend < the full gross sent.
        assertLt(balBefore - alice.balance, gross, "no refund on overshoot");
        // realEth never exceeds the threshold (invariant).
        assertLe(realEth, curve.GRADUATION_ETH());
    }

    function test_realEth_neverExceedsGraduationThreshold() public {
        _buy(curve, token, alice, 100 ether, 0); // way over capacity
        (,, uint256 realEth,) = curve.reserves();
        assertLe(realEth, curve.GRADUATION_ETH(), "realEth exceeded threshold");
    }

    // ───────────────────── ReadyToGraduate two-way lock ──────────────────

    function test_readyToGraduate_locksBuysAndSells() public {
        _buy(curve, token, bob, 0.5 ether, 0); // give bob sellable tokens first
        _fillToReady(curve, token, alice);
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate));
        // Buy locked.
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(NotTrading.selector);
        router.buy{value: 1 ether}(address(token), alice, 0, block.timestamp);
        // Sell locked too — this is a deterministic protocol lock, NOT a pause.
        uint256 bal = token.balanceOf(bob);
        vm.startPrank(bob);
        token.approve(address(router), bal);
        vm.expectRevert(NotTrading.selector);
        router.sell(address(token), bal, bob, 0, block.timestamp);
        vm.stopPrank();
    }

    // ───────────────────────────── Sell path ─────────────────────────────────────

    function test_sell_paysSeller_accruesFee_returnsInventory() public {
        _buy(curve, token, alice, 1 ether, 0); // < G=2.484 so the curve stays Trading for the sell
        uint256 amt = token.balanceOf(alice);
        (uint256 quotedOut, uint256 quotedFee) = curve.quoteSell(amt);
        (,,, uint256 realTokBefore) = curve.reserves();
        uint256 accruedBefore = curve.accruedFees();
        uint256 ethBefore = alice.balance;

        uint256 out = _sell(curve, token, alice, amt, 0);
        assertEq(out, quotedOut, "sell out != quote");
        assertEq(alice.balance, ethBefore + out, "seller not paid");
        assertEq(curve.accruedFees(), accruedBefore + quotedFee, "sell fee not accrued");
        (,,, uint256 realTokAfter) = curve.reserves();
        assertEq(realTokAfter, realTokBefore + amt, "sold tokens not returned to sellable inventory");
    }

    function test_sell_zeroAmountReverts() public {
        vm.prank(alice);
        vm.expectRevert(ZeroAmount.selector);
        router.sell(address(token), 0, alice, 0, block.timestamp);
    }

    // ───────────────────── Graduation: single-fire + zero value ───────────────────

    function test_graduate_movesValue_paysRewardAndFee_zeroesCurve() public {
        _buy(curve, token, bob, 0.4 ether, 0); // accrue some trade fees first
        _fillToReady(curve, token, alice);
        uint256 accrued = curve.accruedFees();
        uint256 treasuryBefore = treasury.balance;
        uint256 callerBalBefore = address(this).balance;

        curve.graduate(); // permissionless; this contract is the caller

        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.Graduated), "not graduated");
        // Caller reward paid.
        assertEq(address(this).balance, callerBalBefore + curve.CALLER_REWARD(), "caller reward not paid");
        // Graduation fee pushed to treasury by the migrator.
        assertEq(treasury.balance, treasuryBefore + curve.GRADUATION_FEE(), "graduation fee not to treasury");
        // Curve holds ZERO tokens and exactly the withheld accruedFees in ETH (zero-value).
        assertEq(token.balanceOf(address(curve)), 0, "curve still holds tokens");
        assertEq(address(curve).balance, accrued, "curve ETH != withheld accruedFees");
        (,, uint256 realEth, uint256 realTok) = curve.reserves();
        assertEq(realEth, 0, "realEth not zeroed");
        assertEq(realTok, 0, "realToken not zeroed");
        // The withheld fees are still sweepable post-graduation → true zero value.
        uint256 swept = curve.sweepFees();
        assertEq(swept, accrued, "post-grad sweep != accrued");
        assertEq(address(curve).balance, 0, "curve not empty after post-grad sweep");
    }

    function test_graduate_singleFire() public {
        _fillToReady(curve, token, alice);
        curve.graduate();
        vm.expectRevert(NotReady.selector);
        curve.graduate();
    }

    function test_graduate_revertsWhenTrading() public {
        vm.expectRevert(NotReady.selector);
        curve.graduate();
    }

    // ──────────────────────────── Donations ───────────────────────────────

    function test_ethDonation_notCredited_sweptAtGraduation() public {
        _buy(curve, token, bob, 0.4 ether, 0);
        (,, uint256 realBefore,) = curve.reserves();
        // Direct donation to the curve.
        vm.deal(address(this), 5 ether);
        (bool ok,) = address(curve).call{value: 5 ether}("");
        assertTrue(ok, "donation rejected");
        (,, uint256 realAfter,) = curve.reserves();
        assertEq(realAfter, realBefore, "donation credited to reserves (must be ignored)");
        // Solvency uses >=, so the donation only widens the gap.
        assertGe(address(curve).balance, realAfter + curve.accruedFees(), "solvency broke with donation");

        // At graduation the donation flows to the migrator (curve keeps only accruedFees).
        uint256 migBefore = address(migrator).balance;
        _fillToReady(curve, token, alice);
        curve.graduate();
        assertGt(address(migrator).balance, migBefore, "donated ETH not swept into graduation");
        assertEq(address(curve).balance, curve.accruedFees(), "curve retained more than accruedFees");
    }

    // ─────────────────────────── sweepFees ──────────────────────────────

    function test_sweepFees_permissionless_movesAccruedToTreasury_zeroesIt() public {
        uint256 tBefore = treasury.balance;
        _buy(curve, token, alice, 2 ether, 0);
        uint256 accrued = curve.accruedFees();
        assertGt(accrued, 0, "no accrued fees");
        // Called by an unrelated address — permissionless.
        vm.prank(bob);
        uint256 swept = curve.sweepFees();
        assertEq(swept, accrued, "swept != accrued");
        assertEq(treasury.balance, tBefore + accrued, "treasury did not receive swept fees");
        assertEq(curve.accruedFees(), 0, "accruedFees not zeroed");
    }

    function test_sweepFees_zeroWhenNothingAccrued() public {
        uint256 tBefore = treasury.balance;
        uint256 swept = curve.sweepFees();
        assertEq(swept, 0, "expected zero sweep");
        assertEq(treasury.balance, tBefore, "treasury changed on empty sweep");
    }
}
