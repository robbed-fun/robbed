// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {CurveHandler} from "test/invariant/handlers/CurveHandler.sol";

/// @title Gate-2 invariant 3 — exact fee accounting, to the wei
/// (gate 2; contracts.md test matrix row 3)
/// @notice Ghost accumulator in the handler sums every quoted in-contract fee (trade fees both
/// directions before/after curve math per contracts.md, the flat creation fee, the
///         flat graduation fee). Treasury is an EOA-like address with no other inflows, so its
///         native-ETH balance must equal the ghost sum exactly. Fees are computed IN-CONTRACT
/// only — never caller-supplied; this invariant is what makes any drift
///         (rounding, double-charge, skimming) a hard failure.
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";

/// forge-config: default.invariant.fail-on-revert = true
contract FeeExactnessInvariant is Test {
    CurveHandler internal handler;

    function setUp() public {
        handler = new CurveHandler();
        targetContract(address(handler));
    }

    /// @notice EXACT ASSERTION (contracts.md row 3, -updated):
    ///         Σ(treasuries).balance + curve.accruedFees == ghost_feeSum, to the wei.
    /// @dev Under trade fees accrue in-contract (`accruedFees`) and are pulled by
    ///      `sweepFees()`; only the creation-fee and graduation-fee legs are pushed to the treasury.
    ///      So the treasury receipts plus the still-escrowed fees must equal every computed
    ///      in-contract fee (each treasury is a plain EOA with no other inflows). The
    ///      `churnTreasury` admin action repoints the LIVE treasury between two tracked EOAs, so the
    ///      receipts are summed via {CurveHandler.sumTreasuryBalances} — a treasury churn cannot break
    ///      the identity (proof that `setTreasury` never leaks or strands fees). Native-ETH leg only:
    /// graduation WETH dust also goes to the treasury but as WETH — excluded here,
    ///      asserted separately in unit tests.
    function invariant_feeExactness() public view {
        IBondingCurve curve = handler.curve();
        assertEq(
            handler.sumTreasuryBalances() + curve.accruedFees(),
            handler.ghost_feeSum(),
            "gate-2 row 3 (12.25): sum treasury receipts + accruedFees != sum of computed fees (wei-exact)"
        );
    }
}
