// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {BaseFixture} from "test/harness/BaseFixture.sol";
import {Reverter} from "test/harness/Harness.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {EthTransferFailed} from "src/errors/Errors.sol";

/// @title CurveSellUnfreezable — THE decisive §12.25 / threat-model UM-1 proof
/// @notice Points the factory `treasury` at a contract that `revert()`s on receive, then proves a
///         curve SELL still succeeds and `accruedFees` grows — because no trade path calls the
///         treasury (pull-payment escrow, spec §12.25). `sweepFees()` reverts (retriable) but can
///         never touch a buy or sell. This is the single most important assertion in M1-8: it shows
///         the "sells always open" guarantee (spec sec 6.5) holds *by construction*, not by policy.
contract CurveSellUnfreezableTest is BaseFixture {
    LaunchToken internal token;
    BondingCurve internal curve;
    Reverter internal reverter;

    function setUp() public {
        _deployStack();
        (token, curve) = _create();
        reverter = new Reverter();
        // Seed the seller with tokens via an honest buy BEFORE the treasury turns hostile (a hostile
        // treasury would only ever block the creation-fee push, never a trade). Past the anti-sniper
        // window so the buy size is unconstrained.
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        _buy(curve, token, alice, 1 ether, 0);
        // Owner (compromised-signer scenario) repoints the treasury at the reverter — the UM-1 attack.
        vm.prank(safeOwner);
        factory.setTreasury(address(reverter));
        assertEq(factory.treasury(), address(reverter), "treasury not repointed to the reverter");
    }

    /// @notice A SELL succeeds against a reverting treasury; the seller is paid; the fee accrues.
    function test_sellSucceeds_whenTreasuryReverts() public {
        uint256 sellAmount = token.balanceOf(alice);
        assertGt(sellAmount, 0, "alice holds no tokens to sell");

        (uint256 quotedOut, uint256 quotedFee) = curve.quoteSell(sellAmount);
        uint256 accruedBefore = curve.accruedFees();
        uint256 aliceEthBefore = alice.balance;

        // The proof: this does NOT revert even though `treasury` reverts on receive.
        uint256 ethOut = _sell(curve, token, alice, sellAmount, 0);

        assertEq(ethOut, quotedOut, "sell paid a different net than quoted");
        assertEq(alice.balance, aliceEthBefore + ethOut, "seller was not actually paid the ETH");
        assertEq(curve.accruedFees(), accruedBefore + quotedFee, "sell fee did not accrue in-contract");
        assertEq(token.balanceOf(alice), 0, "seller still holds tokens after a full sell");
    }

    /// @notice A BUY also succeeds against a reverting treasury (fees accrue, no treasury push).
    function test_buySucceeds_whenTreasuryReverts() public {
        uint256 accruedBefore = curve.accruedFees();
        (, uint256 quotedFee,,) = curve.quoteBuy(0.5 ether);
        uint256 got = _buy(curve, token, bob, 0.5 ether, 0);
        assertGt(got, 0, "buy returned no tokens");
        assertEq(curve.accruedFees(), accruedBefore + quotedFee, "buy fee did not accrue in-contract");
    }

    /// @notice `sweepFees()` is the ONLY thing a reverting treasury blocks — and only itself. It is
    ///         permissionless and retriable: fixing the treasury pointer lets the accrued fees flow.
    function test_sweepReverts_butTradingUnaffected_thenRetriable() public {
        // Generate some accrued fees, then confirm the sweep reverts into the reverter.
        _buy(curve, token, bob, 0.3 ether, 0);
        assertGt(curve.accruedFees(), 0, "no accrued fees to sweep");

        vm.expectRevert(EthTransferFailed.selector);
        curve.sweepFees();

        // A sell in the SAME hostile-treasury state still works (re-proving un-freezability).
        uint256 sellAmount = token.balanceOf(alice);
        uint256 ethOut = _sell(curve, token, alice, sellAmount, 0);
        assertGt(ethOut, 0, "sell blocked while sweep is failing");

        // Ops repoints the treasury back to a healthy address → the sweep now succeeds, wei-exact.
        address healthy = makeAddr("healthyTreasury");
        vm.prank(safeOwner);
        factory.setTreasury(healthy);
        uint256 accrued = curve.accruedFees();
        uint256 swept = curve.sweepFees();
        assertEq(swept, accrued, "sweep amount != accrued");
        assertEq(healthy.balance, accrued, "treasury did not receive the swept fees wei-exact");
        assertEq(curve.accruedFees(), 0, "accruedFees not zeroed after a successful sweep");
    }

    /// @notice Solvency holds throughout the hostile-treasury episode:
    ///         balance >= realEthReserves + accruedFees (spec §12.25 solvency form).
    function test_solvencyHolds_underHostileTreasury() public {
        _buy(curve, token, bob, 0.7 ether, 0);
        _sell(curve, token, alice, token.balanceOf(alice) / 2, 0);
        (,, uint256 realEth,) = curve.reserves();
        assertGe(address(curve).balance, realEth + curve.accruedFees(), "solvency broken under hostile treasury");
    }
}
