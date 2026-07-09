// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {CurveHandler} from "test/invariant/handlers/CurveHandler.sol";

/// @title Gate-2 invariant 1 — k = virtualEth × virtualToken non-decreasing from trades
///        (spec §10 gate 2; contracts.md §6 test matrix row 1)
/// @notice Handler: N fuzzed actors doing buy/sell/donate in random order + amounts;
///         `assertGe(vE·vT, ghost_lastK)` after every action (in-handler) and here after every
///         run. Complemented by a direct CurveMath fuzz unit in test/fuzz/ (M1): ∀ (state,
///         amount), post-trade k ≥ pre-trade k — the rounding-direction proof (buy rounds
///         tokensOut down, sell rounds ethOut down; contracts.md §2.3).
contract KNonDecreasingInvariant is Test {
    CurveHandler internal handler;

    function setUp() public {
        handler = new CurveHandler();
        targetContract(address(handler));
        // M1: set `fail_on_revert = true` for this suite (in-handler assertions must surface).
    }

    /// @notice EXACT ASSERTION (contracts.md §6 row 1): current vE·vT ≥ k recorded after the
    ///         previous action — rounding drifts k upward only (contracts.md §2.3 curve math).
    function invariant_kNonDecreasing() public {
        vm.skip(true); // PENDING IMPLEMENTATION (M1) — remove once CurveHandler wires the stack.
        (uint256 vE, uint256 vT,,) = handler.curve().reserves();
        assertGe(vE * vT, handler.ghost_lastK(), "gate-2 row 1: k (vE*vT) decreased across a trade sequence");
    }
}
