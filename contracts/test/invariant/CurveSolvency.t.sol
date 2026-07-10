// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {ILaunchToken} from "src/interfaces/ILaunchToken.sol";
import {IRouter} from "src/interfaces/IRouter.sol";
import {CurveHandler} from "test/invariant/handlers/CurveHandler.sol";

/// @title Gate-2 invariant 2 — curve solvency under any fill sequence
///        (spec §10 gate 2; contracts.md §6 test matrix row 2)
/// @notice `address(curve).balance ≥ realEthReserves` at every checkpoint, and any circulating
///         token amount can be sold and actually paid out ("drain" assertion under
///         snapshot/revert). Also pins the sells-never-pausable sentinel: a phase-Trading sell
///         has no legal revert path regardless of pauseBuys/pauseCreates (spec §6.5).
/// forge-config: default.invariant.fail-on-revert = true
contract CurveSolvencyInvariant is Test {
    CurveHandler internal handler;

    function setUp() public {
        handler = new CurveHandler();
        targetContract(address(handler));
    }

    /// @notice EXACT ASSERTIONS (contracts.md §6 row 2, §12.25-updated):
    ///         (1) address(curve).balance ≥ realEthReserves + accruedFees — the §12.25 solvency
    ///             form; donations only ever widen the gap (`≥`, contracts.md §5.7);
    ///         (2) sells never reverted while paused (sentinel, spec §6.5);
    ///         (3) drain: at this checkpoint, force-sell every actor's full balance sequentially,
    ///             assert all succeed with ETH actually received, then roll back.
    function invariant_curveSolvency() public {
        IBondingCurve curve = handler.curve();
        ILaunchToken token = handler.token();
        IRouter router = handler.router();

        (,, uint256 realEth,) = curve.reserves();
        assertGe(
            address(curve).balance,
            realEth + curve.accruedFees(),
            "gate-2 row 2 (12.25): curve balance < realEthReserves + accruedFees"
        );
        assertFalse(handler.ghost_sellRevertedWhilePaused(), "gate-2 row 2 / spec 6.5: a Trading-phase sell reverted");

        // Drain assertion — checked under snapshot, then rolled back (contracts.md §6 row 2).
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
                assertEq(actors[i].balance, ethBefore + ethOut, "gate-2 row 2: sell proceeds not actually paid out");
            }
            vm.revertToState(snap);
        }
    }
}
