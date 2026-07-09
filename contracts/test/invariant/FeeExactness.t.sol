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
contract FeeExactnessInvariant is Test {
    CurveHandler internal handler;

    function setUp() public {
        handler = new CurveHandler();
        targetContract(address(handler));
        // M1: set `fail_on_revert = true` for this suite.
    }

    /// @notice EXACT ASSERTION (contracts.md §6 row 3):
    ///         treasury.balance == ghost_feeSum, to the wei.
    /// @dev Native-ETH leg only: creation fee + trade fees + graduation fee are all paid in ETH.
    ///      Graduation WETH dust also goes to the treasury but as WETH (spec §12.13) — asserted
    ///      separately in M1 unit tests, deliberately excluded from this ETH-exactness identity.
    function invariant_feeExactness() public {
        vm.skip(true); // PENDING IMPLEMENTATION (M1) — remove once CurveHandler wires the stack.
        assertEq(
            handler.treasury().balance,
            handler.ghost_feeSum(),
            "gate-2 row 3: treasury ETH receipts != sum of computed in-contract fees (wei-exact)"
        );
    }
}
