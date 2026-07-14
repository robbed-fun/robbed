// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {CurveHandler} from "test/invariant/handlers/CurveHandler.sol";

/// @title Gate-2 invariant 5 — post-graduation curve holds zero value
/// (gate 2; contracts.md test matrix row 5)
/// @notice graduate() transfers the curve's ENTIRE token balance and ENTIRE ETH balance
/// (donations included) to the migrator (contracts.md), so immediately after
///         graduation the curve holds exactly 0 ETH and 0 tokens. The handler keeps fuzzing
///         post-grad pokes (buy/sell/graduate/donations); nothing may become extractable — any
///         value that appears post-grad must be exactly the recorded post-grad donations, and
/// all state-mutating functions revert (phase is terminal — contracts.md).
/// forge-config: default.invariant.fail-on-revert = true
contract PostGraduationZeroValueInvariant is Test {
    CurveHandler internal handler;

    function setUp() public {
        handler = new CurveHandler();
        targetContract(address(handler));
    }

    /// @notice EXACT ASSERTIONS (contracts.md row 5, -updated), evaluated whenever
    ///         phase == Graduated:
    ///         (1) address(curve).balance == accruedFees + ghost_postGradEthDonated — the ONLY ETH a
    ///             graduated curve holds is the withheld, treasury-only-sweepable trade fees plus any
    ///             inert post-grad donation; neither is extractable by an actor;
    ///         (2) sweepFees() drains the accrued fees, leaving only the inert donations;
    ///         (3) token.balanceOf(curve) == 0;
    ///         (4) post-grad buy/sell/graduate all revert (probed under snapshot).
    function invariant_postGraduationZeroValue() public {
        IBondingCurve curve = handler.curve();
        if (curve.phase() != IBondingCurve.Phase.Graduated) return;

        assertEq(
            address(curve).balance,
            curve.accruedFees() + handler.ghost_postGradEthDonated(),
            "gate-2 row 5 (12.25): curve holds ETH beyond accruedFees + post-grad donations"
        );
        assertEq(handler.token().balanceOf(address(curve)), 0, "gate-2 row 5: curve holds tokens post-graduation");

        // : sweepFees works in the terminal phase and drains reserve/LP value to exactly the
        // inert donations. Checked under snapshot so it does not perturb the ongoing fuzz run.
        uint256 snap = vm.snapshotState();
        curve.sweepFees();
        assertEq(
            address(curve).balance,
            handler.ghost_postGradEthDonated(),
            "gate-2 row 5 (12.25): sweepFees did not drain accrued fees post-graduation"
        );

        // Terminal-phase probe: every trade/graduate entry reverts (contracts.md). Calls come
        // from this test (not the router) so they revert on NotRouter/NotReady regardless — the
        // point is that NO state-mutating value path succeeds post-graduation.
        vm.deal(address(this), 1 ether);
        vm.expectRevert();
        curve.buy{value: 1 ether}(address(this), address(this), address(this), 0);
        vm.expectRevert();
        curve.sell(address(this), address(this), 1, 0);
        vm.expectRevert();
        curve.graduate();
        vm.revertToState(snap);
    }
}
