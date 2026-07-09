// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {CurveHandler} from "test/invariant/handlers/CurveHandler.sol";

/// @title Gate-2 invariant 5 — post-graduation curve holds zero value
///        (spec §10 gate 2; contracts.md §6 test matrix row 5)
/// @notice graduate() transfers the curve's ENTIRE token balance and ENTIRE ETH balance
///         (donations included) to the migrator (contracts.md §2.3), so immediately after
///         graduation the curve holds exactly 0 ETH and 0 tokens. The handler keeps fuzzing
///         post-grad pokes (buy/sell/graduate/donations); nothing may become extractable — any
///         value that appears post-grad must be exactly the recorded post-grad donations, and
///         all state-mutating functions revert (phase is terminal — contracts.md §2.3).
contract PostGraduationZeroValueInvariant is Test {
    CurveHandler internal handler;

    function setUp() public {
        handler = new CurveHandler();
        targetContract(address(handler));
        // M1: set `fail_on_revert = true` for this suite.
    }

    /// @notice EXACT ASSERTIONS (contracts.md §6 row 5), evaluated whenever phase == Graduated:
    ///         (1) address(curve).balance == ghost_postGradEthDonated (0 unless receive() still
    ///             accepts donations post-grad — and then not extractable by anyone);
    ///         (2) token.balanceOf(curve) == 0;
    ///         (3) post-grad buy/sell/graduate all revert (probed under snapshot).
    function invariant_postGraduationZeroValue() public {
        vm.skip(true); // PENDING IMPLEMENTATION (M1) — remove once CurveHandler wires the stack.
        IBondingCurve curve = handler.curve();
        if (curve.phase() != IBondingCurve.Phase.Graduated) return;

        assertEq(
            address(curve).balance,
            handler.ghost_postGradEthDonated(),
            "gate-2 row 5: curve holds ETH beyond recorded post-grad donations"
        );
        assertEq(handler.token().balanceOf(address(curve)), 0, "gate-2 row 5: curve holds tokens post-graduation");

        // Terminal-phase probe: every state-mutating entry reverts (contracts.md §2.3).
        uint256 snap = vm.snapshotState();
        vm.deal(address(this), 1 ether);
        vm.expectRevert();
        curve.buy{value: 1 ether}(address(this), address(this), 0);
        vm.expectRevert();
        curve.sell(address(this), 1, 0);
        vm.expectRevert();
        curve.graduate();
        vm.revertToState(snap);
    }
}
