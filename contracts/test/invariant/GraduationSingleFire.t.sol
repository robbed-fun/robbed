// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";
import {CurveHandler} from "test/invariant/handlers/CurveHandler.sol";

/// @title Gate-2 invariant 4 — graduation fires exactly once and is always reachable
///        (spec §10 gate 2; contracts.md §6 test matrix row 4)
/// @notice Single-fire: ghost count of successful graduate() calls ≤ 1 (CEI-based by
///         construction: phase = Graduated precedes all transfers — contracts.md §5.4).
///         Reachability: from ANY invariant state with phase == Trading, a single buy of the
///         quote-derived remaining capacity plus graduate() succeeds — no fill sequence strands
///         the curve below/at threshold permanently. Checked under snapshot/revert. The
///         double-graduate unit test (revert NotReady) lands in test/unit/ at M1.
/// forge-config: default.invariant.fail-on-revert = true
contract GraduationSingleFireInvariant is Test {
    CurveHandler internal handler;

    function setUp() public {
        handler = new CurveHandler();
        targetContract(address(handler));
    }

    /// @dev The reachability check below calls `curve.graduate()` from this contract, which pays the
    ///      permissionless CALLER_REWARD to `msg.sender` — so this contract must accept ETH.
    receive() external payable {}

    /// @notice EXACT ASSERTIONS (contracts.md §6 row 4):
    ///         (1) ghost_graduatedCount ≤ 1;
    ///         (2) if phase == Trading: fill-to-threshold + graduate() succeeds (under snapshot);
    ///         (3) if phase == ReadyToGraduate: graduate() alone succeeds (under snapshot).
    function invariant_graduationSingleFireAndReachable() public {
        assertLe(handler.ghost_graduatedCount(), 1, "gate-2 row 4: Graduated fired more than once");

        IBondingCurve curve = handler.curve();
        ICurveFactory factory = handler.factory();
        IBondingCurve.Phase p = curve.phase();

        if (p == IBondingCurve.Phase.Trading) {
            uint256 snap = vm.snapshotState();
            // Reachability is a protocol-liveness property: clear operational buy-side blocks
            // (owner-recoverable, never economics) before proving the threshold is attainable.
            vm.startPrank(handler.safeOwner());
            factory.setPauseBuys(false);
            factory.setCaps(type(uint128).max, type(uint128).max);
            vm.stopPrank();
            vm.warp(uint256(curve.EARLY_WINDOW_END())); // past the anti-sniper per-tx cap

            (,, uint256 realEth,) = curve.reserves();
            uint256 remainingNet = curve.GRADUATION_ETH() - realEth;
            // acceptedGross = ceilDiv(net · 10_000, 10_000 − TRADE_FEE_BPS) — contracts.md §2.3.
            uint256 gross = Math.ceilDiv(remainingNet * 10_000, 10_000 - curve.TRADE_FEE_BPS());
            address filler = makeAddr("reachability-filler");
            vm.deal(filler, gross);
            vm.prank(filler);
            handler.router().buy{value: gross}(address(handler.token()), filler, 0, block.timestamp);
            assertEq(
                uint8(curve.phase()),
                uint8(IBondingCurve.Phase.ReadyToGraduate),
                "gate-2 row 4: exact-threshold fill did not arm graduation"
            );
            curve.graduate();
            assertEq(
                uint8(curve.phase()),
                uint8(IBondingCurve.Phase.Graduated),
                "gate-2 row 4: graduation unreachable from a Trading state"
            );
            vm.revertToState(snap);
        } else if (p == IBondingCurve.Phase.ReadyToGraduate) {
            uint256 snap = vm.snapshotState();
            curve.graduate();
            assertEq(
                uint8(curve.phase()),
                uint8(IBondingCurve.Phase.Graduated),
                "gate-2 row 4: ReadyToGraduate not permissionlessly exitable"
            );
            vm.revertToState(snap);
        }
    }
}
