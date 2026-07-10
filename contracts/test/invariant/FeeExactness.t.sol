// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {CurveHandler} from "test/invariant/handlers/CurveHandler.sol";

/// @title Gate-2 invariant 3 — exact fee accounting, to the wei
///        (spec §10 gate 2; contracts.md §6 test matrix row 3)
/// @notice Ghost accumulator in the handler sums every quoted in-contract fee (trade fees both
///         directions before/after curve math per contracts.md §2.3, the flat creation fee, the
///         flat graduation fee). Treasury is an EOA-like address with no other inflows, so its
///         native-ETH balance must equal the ghost sum exactly. Fees are computed IN-CONTRACT
///         only — never caller-supplied (spec §4.1); this invariant is what makes any drift
///         (rounding, double-charge, skimming) a hard failure.
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";

/// forge-config: default.invariant.fail-on-revert = true
contract FeeExactnessInvariant is Test {
    CurveHandler internal handler;

    function setUp() public {
        handler = new CurveHandler();
        targetContract(address(handler));
    }

    /// @notice EXACT ASSERTION (contracts.md §6 row 3, §12.25-updated):
    ///         treasury.balance + curve.accruedFees == ghost_feeSum, to the wei.
    /// @dev Under §12.25 trade fees accrue in-contract (`accruedFees`) and are pulled by
    ///      `sweepFees()`; only the creation-fee and graduation-fee legs are pushed to the treasury.
    ///      So the treasury receipts plus the still-escrowed fees must equal every computed
    ///      in-contract fee (treasury is a plain EOA with no other inflows). Native-ETH leg only:
    ///      graduation WETH dust also goes to the treasury but as WETH (spec §12.13) — excluded here,
    ///      asserted separately in unit tests.
    function invariant_feeExactness() public view {
        IBondingCurve curve = handler.curve();
        assertEq(
            handler.treasury().balance + curve.accruedFees(),
            handler.ghost_feeSum(),
            "gate-2 row 3 (12.25): treasury receipts + accruedFees != sum of computed fees (wei-exact)"
        );
    }
}
