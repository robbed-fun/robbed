// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {CurveHandler} from "test/invariant/handlers/CurveHandler.sol";

/// @title Gate-2 invariant 7 — no fuzzed actor sequence extracts ETH beyond fair curve value
///        (spec §10 gate 2; contracts.md §6 test matrix row 7)
/// @notice Accounting identity over all actor flows: Σ actor-ETH-out (sell proceeds + clamp
///         refunds; treasury and caller-reward flows excluded) can never exceed Σ actor-ETH-in
///         (accepted buy gross + donations) minus the in-contract fees minus what the curve still
///         holds. Any violation = value extraction (sandwich/reentrancy/rounding-pump/etc.).
contract NoValueExtractionInvariant is Test {
    CurveHandler internal handler;

    function setUp() public {
        handler = new CurveHandler();
        targetContract(address(handler));
        // M1: set `fail_on_revert = true` for this suite.
    }

    /// @notice EXACT ASSERTION (contracts.md §6 row 7, verbatim identity):
    ///         ghost_totalEthOut ≤ ghost_totalEthIn − ghost_fees − address(curve).balance
    /// @dev The subtraction underflowing is itself a violation (out+fees+balance > in) and fails
    ///      the run. Post-graduation the curve balance term goes to ~0 and the identity keeps
    ///      holding over the remaining flows (LP value stays locked in the V3 position).
    function invariant_noExtractionBeyondFairValue() public {
        vm.skip(true); // PENDING IMPLEMENTATION (M1) — remove once CurveHandler wires the stack.
        assertLe(
            handler.ghost_totalEthOut(),
            handler.ghost_totalEthIn() - handler.ghost_feeSum() - address(handler.curve()).balance,
            "gate-2 row 7: actors extracted ETH beyond fair curve value"
        );
    }
}
