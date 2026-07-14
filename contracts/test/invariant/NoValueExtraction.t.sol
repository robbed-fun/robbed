// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {CurveHandler} from "test/invariant/handlers/CurveHandler.sol";

/// @title Gate-2 invariant 7 — no fuzzed actor sequence extracts ETH beyond fair curve value
/// (gate 2; contracts.md test matrix row 7)
/// @notice Accounting identity over all actor flows: Σ actor-ETH-out (sell proceeds + clamp
///         refunds; treasury and caller-reward flows excluded) can never exceed Σ actor-ETH-in
///         (accepted buy gross + donations) minus the in-contract fees minus what the curve still
///         holds. Any violation = value extraction (sandwich/reentrancy/rounding-pump/etc.).
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";

/// forge-config: default.invariant.fail-on-revert = true
contract NoValueExtractionInvariant is Test {
    CurveHandler internal handler;

    function setUp() public {
        handler = new CurveHandler();
        targetContract(address(handler));
    }

    /// @notice EXACT ASSERTION (contracts.md row 7, -updated identity):
    ///         ghost_totalEthOut ≤ ghost_totalEthIn − ghost_feeSum − (curve.balance − accruedFees)
    /// @dev Under the accrued trade fees sit inside `curve.balance` but are ALSO counted in
    ///      `ghost_feeSum`; subtracting the balance net of `accruedFees` avoids double-counting them
    /// (the pre- form subtracted the full balance, which under pull-payment would
    ///      underflow by exactly `accruedFees`). The subtraction underflowing is itself a violation
    ///      (out + fees + locked value > in) and fails the run. Post-graduation `curve.balance`
    ///      equals `accruedFees` so the balance term is 0 and the identity keeps holding over the
    ///      remaining flows (LP value stays locked in the migrator/V3 position).
    function invariant_noExtractionBeyondFairValue() public view {
        IBondingCurve curve = handler.curve();
        assertLe(
            handler.ghost_totalEthOut(),
            handler.ghost_totalEthIn() - handler.ghost_feeSum() - (address(curve).balance - curve.accruedFees()),
            "gate-2 row 7 (12.25): actors extracted ETH beyond fair curve value"
        );
    }
}
