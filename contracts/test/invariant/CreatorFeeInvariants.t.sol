// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {ICreatorVault} from "src/interfaces/ICreatorVault.sol";
import {ILaunchToken} from "src/interfaces/ILaunchToken.sol";
import {IRouter} from "src/interfaces/IRouter.sol";
import {CreatorFeeCurveHandler} from "test/invariant/handlers/CreatorFeeCurveHandler.sol";

/// @title Gate-2 re-run with the Phase-2 creator fee LIVE + a HOSTILE creator
/// @notice The audit-surface reopen. One handler drives a fuzzed actor sequence with a
///         non-zero `creatorFeeBps` (the ratified testnet 50) and a reverting creator address; every
///         gate-2 invariant below must hold — the creator-inclusive solvency + fee-exactness forms,
///         plus the decisive "sells always open under a hostile creator" property. At
///         `creatorFeeBps == 0` the parallel {CurveHandler} suites (unchanged) prove the same
///         invariants for the treasury-only build.
/// forge-config: default.invariant.fail-on-revert = true
contract CreatorFeeInvariants is Test {
    CreatorFeeCurveHandler internal handler;

    function setUp() public {
        handler = new CreatorFeeCurveHandler();
        targetContract(address(handler));
    }

    /// @notice F-1 COVERAGE PROOF (robbed-security gate-2 re-run), deterministic — not left to fuzz
    ///         luck. The handler's dedicated {CreatorFeeCurveHandler.forceF1BoundaryBuy} action is a
    ///         first-class fuzz target (so the invariant campaign exercises it), and here we drive it
    ///         directly to PROVE it reaches the two-floor clamp boundary where the raw ceilDiv rounds
    ///         `acceptedEthGross` to grossIn + 1 (the F-1 underflow the fix guards) AND the strict,
    ///         uncaught buy clears. A regressed fix would panic here (checked `grossIn -
    ///         acceptedEthGross`) and inside the campaign's strict path.
    function test_f1_handlerReachesClampBoundary() public {
        CreatorFeeCurveHandler h = new CreatorFeeCurveHandler();
        assertEq(h.ghost_f1BoundaryHits(), 0, "precondition: no boundary hit yet");
        h.forceF1BoundaryBuy(0);
        assertEq(
            h.ghost_f1BoundaryHits(),
            1,
            "F-1: handler did not reach the accepted>grossIn clamp boundary (coverage gap not closed)"
        );
        assertEq(uint256(h.curve().phase()), uint256(IBondingCurve.Phase.ReadyToGraduate), "boundary buy must graduate");
    }

    /// @notice Row 2 (solvency form) `balance ≥ realEthReserves + accruedFees +
    ///         accruedCreatorFees`; a Trading-phase sell never reverted under the hostile creator;
    ///         and every actor's full balance is drainable (paid out) under snapshot/revert.
    function invariant_solvencyWithCreatorLeg() public {
        IBondingCurve curve = handler.curve();
        ILaunchToken token = handler.token();
        IRouter router = handler.router();

        (,, uint256 realEth,) = curve.reserves();
        assertGe(
            address(curve).balance,
            realEth + curve.accruedFees() + curve.accruedCreatorFees(),
            "gate-2 row 2 (12.63): balance < realEthReserves + accruedFees + accruedCreatorFees"
        );
        assertFalse(
            handler.ghost_sellRevertedWhilePaused(),
            "gate-2 row 2 / spec 6.5 / 12.63: a Trading-phase sell reverted (hostile creator froze a sell)"
        );

        if (curve.phase() == IBondingCurve.Phase.Trading) {
            uint256 snap = vm.snapshotState();
            address[] memory actors = handler.actors();
            for (uint256 i = 0; i < actors.length; ++i) {
                uint256 bal = token.balanceOf(actors[i]);
                if (bal == 0) continue;
                uint256 ethBefore = actors[i].balance;
                vm.startPrank(actors[i]);
                token.approve(address(router), bal);
                uint256 ethOut = router.sell(address(token), bal, actors[i], 0, block.timestamp);
                vm.stopPrank();
                assertEq(
                    actors[i].balance, ethBefore + ethOut, "gate-2 row 2 (12.63): sell proceeds not actually paid out"
                );
            }
            vm.revertToState(snap);
        }
    }

    /// @notice Row 3 (exact-fee, both legs, to the wei):
    ///         - TREASURY leg: `treasury.balance + accruedFees == ghost_feeSum`;
    ///         - CREATOR leg: `creatorVault.balanceOf(creator) + accruedCreatorFees + claimed ==
    ///           ghost_creatorFeeSum` (ghost = independent Σ of every computed creator fee).
    function invariant_feeExactnessBothLegs() public view {
        IBondingCurve curve = handler.curve();
        ICreatorVault vault = handler.creatorVault();

        assertEq(
            handler.treasury().balance + curve.accruedFees(),
            handler.ghost_feeSum(),
            "gate-2 row 3 (12.25): treasury receipts + accruedFees != sum of computed treasury fees"
        );
        assertEq(
            vault.balanceOf(handler.creatorAddr()) + curve.accruedCreatorFees() + handler.ghost_creatorClaimed(),
            handler.ghost_creatorFeeSum(),
            "gate-2 row 3 (12.63): creator vault + escrow + claimed != sum of computed creator fees"
        );
    }

    /// @notice Row 7 (identity) actor ETH out never exceeds actor ETH in minus BOTH fee legs
    ///         minus the value still locked in the curve (`balance − accruedFees − accruedCreatorFees`,
    ///         i.e. the live reserves). A subtraction underflow is itself a violation and fails.
    function invariant_noExtractionWithCreatorLeg() public view {
        IBondingCurve curve = handler.curve();
        uint256 lockedCurveValue = address(curve).balance - curve.accruedFees() - curve.accruedCreatorFees();
        assertLe(
            handler.ghost_totalEthOut(),
            handler.ghost_totalEthIn() - handler.ghost_feeSum() - handler.ghost_creatorFeeSum() - lockedCurveValue,
            "gate-2 row 7 (12.63): actors extracted ETH beyond fair curve value (incl. creator leg)"
        );
    }

    /// @notice Row 4: graduation fires at most once even with the creator leg live.
    function invariant_graduationSingleFire() public view {
        assertLe(handler.ghost_graduatedCount(), 1, "gate-2 row 4 (12.63): graduated more than once");
    }

    /// @notice post-graduation zero value: after graduation the curve's ETH balance equals
    ///         exactly the two unswept escrows plus any post-grad donation — nothing extractable, no
    ///         residual reserve/LP value. Both escrows drain to 0 via their permissionless sweeps.
    function invariant_postGraduationZeroValue() public view {
        IBondingCurve curve = handler.curve();
        if (curve.phase() != IBondingCurve.Phase.Graduated) return;
        (,, uint256 realEth, uint256 realToken) = curve.reserves();
        assertEq(realEth, 0, "gate-2 row 5 (12.63): post-grad realEthReserves != 0");
        assertEq(realToken, 0, "gate-2 row 5 (12.63): post-grad realTokenReserves != 0");
        assertEq(
            address(curve).balance,
            curve.accruedFees() + curve.accruedCreatorFees() + handler.ghost_postGradEthDonated(),
            "gate-2 row 5 (12.63): post-grad curve holds value beyond the two fee escrows + donations"
        );
    }
}
