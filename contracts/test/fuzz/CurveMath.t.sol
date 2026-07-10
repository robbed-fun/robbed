// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {CurveMath} from "../../src/libs/CurveMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title CurveMath direct fuzz (M1-6) — spec §6.2; contracts.md §2.3 (gate 2)
/// @notice Proves the pure-math invariants without curve state: `k` non-decreasing across every
///         trade; no reserve underflow (payout ≤ retained reserve); and rounding that NEVER lets a
///         caller extract more than the most-generous (floor-rounded) fair value — i.e. rounding
///         always favors the curve (spec §6.2, §12.25). This is the direct-library complement to the
///         stateful `KNonDecreasing`/`CurveSolvency` invariant suites (M1-8).
/// @dev Inputs are bounded to launch-realistic magnitudes (≤ 1e30) so the test's OWN reference
///      product `vE·vT` cannot overflow uint256 — the library itself is 512-bit safe via
///      `Math.mulDiv`, but the assertions here multiply reserves in plain uint256. Real curve values
///      are far smaller (`vT ≤ ~1.073e27`, `vE ≤ ~1e21`), so this bound is generous and safe.
contract CurveMathFuzzTest is Test {
    uint256 internal constant MAX_RESERVE = 1e30;
    uint256 internal constant MAX_AMOUNT = 1e30;

    // ────────────────────────────────────── Buy ─────────────────────────────────────────

    /// @notice ∀(vE, vT, eIn): k non-decreasing, no underflow, rounding curve-favoring.
    function testFuzz_Buy(uint256 virtualEth, uint256 virtualToken, uint256 ethInNet) public pure {
        virtualEth = bound(virtualEth, 1, MAX_RESERVE);
        virtualToken = bound(virtualToken, 1, MAX_RESERVE);
        ethInNet = bound(ethInNet, 0, MAX_AMOUNT);

        uint256 tokensOut = CurveMath.buyTokensOut(virtualEth, virtualToken, ethInNet);

        // No reserve underflow: cannot remove more tokens than the reserve holds.
        assertLe(tokensOut, virtualToken, "tokensOut must not exceed virtualToken");

        // k non-decreasing: post-trade product ≥ pre-trade product.
        uint256 kBefore = virtualEth * virtualToken;
        uint256 kAfter = (virtualEth + ethInNet) * (virtualToken - tokensOut);
        assertGe(kAfter, kBefore, "k must be non-decreasing on buy");

        // Rounding favors the curve: our (ceil-based) payout never exceeds the floor-based payout,
        // which is the MOST the caller could fairly receive under any rounding choice.
        uint256 floorRetained = Math.mulDiv(virtualEth, virtualToken, virtualEth + ethInNet, Math.Rounding.Floor);
        uint256 floorFavoringPayout = virtualToken - floorRetained;
        assertLe(tokensOut, floorFavoringPayout, "buy payout must never exceed fair (floor) value");
    }

    /// @notice Zero net-ETH in ⇒ zero tokens out (identity), k unchanged.
    function testFuzz_BuyZeroInIsIdentity(uint256 virtualEth, uint256 virtualToken) public pure {
        virtualEth = bound(virtualEth, 1, MAX_RESERVE);
        virtualToken = bound(virtualToken, 1, MAX_RESERVE);
        assertEq(CurveMath.buyTokensOut(virtualEth, virtualToken, 0), 0, "zero in gives zero out");
    }

    /// @notice F1 (mutation-adequacy): POSITIVITY + MONOTONICITY of the buy output.
    /// @dev The `k`-non-decreasing and floor-favoring assertions all hold for `tokensOut == 0`, so a
    ///      `tokensOut = 0` (statement-deletion / operand-zeroing) mutant SURVIVED the pre-M1-13 suite.
    ///      This pins two facts that a degenerate output cannot satisfy:
    ///        (1) POSITIVITY — for `ethInNet` above a floor with non-degenerate reserves the buy
    ///            returns strictly-positive tokens. The floor `ethInNet ≥ 1e7` guarantees output > 0:
    ///            `tokensOut > 0 ⇔ ethInNet ≥ virtualEth/(virtualToken−1)`, and with the bounds below
    ///            `virtualEth/(virtualToken−1) ≤ 1e24/(1e18−1) < 1e7`. Kills the zero-output mutant.
    ///        (2) MONOTONICITY — `buyTokensOut` is non-decreasing in `ethInNet`; adding ETH never
    ///            returns fewer tokens. Kills operator swaps in the denominator (`vE + eIn`) that would
    ///            invert the trend.
    ///      High fuzz runs (F3) so the positivity floor and the monotone step are exercised densely.
    /// forge-config: default.fuzz.runs = 20000
    function testFuzz_BuyPositiveAndMonotonic(uint256 virtualEth, uint256 virtualToken, uint256 ethInNet, uint256 delta)
        public
        pure
    {
        virtualEth = bound(virtualEth, 1e6, 1e24);
        virtualToken = bound(virtualToken, 1e18, 1e30);
        ethInNet = bound(ethInNet, 1e7, MAX_AMOUNT); // floor ⇒ strictly-positive output (see @dev)
        delta = bound(delta, 0, MAX_AMOUNT);

        uint256 out1 = CurveMath.buyTokensOut(virtualEth, virtualToken, ethInNet);
        assertGt(out1, 0, "buy must yield >0 tokens above the input floor"); // F1 positivity

        uint256 out2 = CurveMath.buyTokensOut(virtualEth, virtualToken, ethInNet + delta);
        assertGe(out2, out1, "buy tokensOut must be non-decreasing in ethInNet"); // F1 monotonicity
    }

    /// @notice F2 (mutation-adequacy): DIFFERENTIAL exact-equality against an independent reference.
    /// @dev The rounding direction is `Math.Rounding.Ceil` — an ENUM argument no arithmetic-operator
    ///      mutation can flip, and `k`-monotonicity alone tolerates a `Ceil→Floor` inversion (it only
    ///      shifts the payout by ≤1 wei in the CURVE's disfavor, still leaving `k` non-decreasing). So a
    ///      hand-authored `Ceil→Floor` mutant would SURVIVE. This pins the exact value against a
    ///      reference that computes the ceil independently (`q + (r != 0 ? 1 : 0)`, NOT the OZ enum):
    ///      any `Ceil→Floor` flip drops the `+1`, inflating `tokensOut` by 1 wei and breaking equality.
    /// forge-config: default.fuzz.runs = 20000
    function testFuzz_BuyReferenceEquality(uint256 virtualEth, uint256 virtualToken, uint256 ethInNet) public pure {
        virtualEth = bound(virtualEth, 1, MAX_RESERVE);
        virtualToken = bound(virtualToken, 1, MAX_RESERVE);
        ethInNet = bound(ethInNet, 0, MAX_AMOUNT);

        uint256 tokensOut = CurveMath.buyTokensOut(virtualEth, virtualToken, ethInNet);
        assertEq(tokensOut, _refBuy(virtualEth, virtualToken, ethInNet), "buy must equal ceil-reference");
    }

    // ────────────────────────────────────── Sell ────────────────────────────────────────

    /// @notice ∀(vE, vT, tIn): k non-decreasing, no underflow, rounding curve-favoring.
    function testFuzz_Sell(uint256 virtualEth, uint256 virtualToken, uint256 tokenIn) public pure {
        virtualEth = bound(virtualEth, 1, MAX_RESERVE);
        virtualToken = bound(virtualToken, 1, MAX_RESERVE);
        tokenIn = bound(tokenIn, 0, MAX_AMOUNT);

        uint256 ethOutGross = CurveMath.sellEthOut(virtualEth, virtualToken, tokenIn);

        // No reserve underflow: cannot remove more ETH than the reserve holds.
        assertLe(ethOutGross, virtualEth, "ethOut must not exceed virtualEth");

        // k non-decreasing.
        uint256 kBefore = virtualEth * virtualToken;
        uint256 kAfter = (virtualEth - ethOutGross) * (virtualToken + tokenIn);
        assertGe(kAfter, kBefore, "k must be non-decreasing on sell");

        // Rounding favors the curve.
        uint256 floorRetained = Math.mulDiv(virtualEth, virtualToken, virtualToken + tokenIn, Math.Rounding.Floor);
        uint256 floorFavoringPayout = virtualEth - floorRetained;
        assertLe(ethOutGross, floorFavoringPayout, "sell payout must never exceed fair (floor) value");
    }

    /// @notice Zero tokens in ⇒ zero ETH out (identity).
    function testFuzz_SellZeroInIsIdentity(uint256 virtualEth, uint256 virtualToken) public pure {
        virtualEth = bound(virtualEth, 1, MAX_RESERVE);
        virtualToken = bound(virtualToken, 1, MAX_RESERVE);
        assertEq(CurveMath.sellEthOut(virtualEth, virtualToken, 0), 0, "zero in gives zero out");
    }

    /// @notice F1 (mutation-adequacy): POSITIVITY + MONOTONICITY of the sell output (symmetric to buy).
    /// @dev Floor `tokenIn ≥ 1e13` guarantees `ethOutGross > 0`: positivity ⇔ `tokenIn ≥
    ///      virtualToken/(virtualEth−1)`, and with the bounds below that ratio is ≤ 1e24/(1e18−1) < 1e13.
    ///      Monotonic non-decreasing in `tokenIn`. Kills the `ethOutGross = 0` mutant and denominator
    ///      operator swaps in `vT + tIn`. High fuzz runs (F3).
    /// forge-config: default.fuzz.runs = 20000
    function testFuzz_SellPositiveAndMonotonic(uint256 virtualEth, uint256 virtualToken, uint256 tokenIn, uint256 delta)
        public
        pure
    {
        virtualEth = bound(virtualEth, 1e18, 1e30);
        virtualToken = bound(virtualToken, 1e6, 1e24);
        tokenIn = bound(tokenIn, 1e13, MAX_AMOUNT); // floor ⇒ strictly-positive output (see @dev)
        delta = bound(delta, 0, MAX_AMOUNT);

        uint256 out1 = CurveMath.sellEthOut(virtualEth, virtualToken, tokenIn);
        assertGt(out1, 0, "sell must yield >0 eth above the input floor"); // F1 positivity

        uint256 out2 = CurveMath.sellEthOut(virtualEth, virtualToken, tokenIn + delta);
        assertGe(out2, out1, "sell ethOut must be non-decreasing in tokenIn"); // F1 monotonicity
    }

    /// @notice F2 (mutation-adequacy): DIFFERENTIAL exact-equality against an independent reference —
    ///         catches a `Ceil→Floor` inversion that `k`-monotonicity alone leaves at ≤1 wei.
    /// forge-config: default.fuzz.runs = 20000
    function testFuzz_SellReferenceEquality(uint256 virtualEth, uint256 virtualToken, uint256 tokenIn) public pure {
        virtualEth = bound(virtualEth, 1, MAX_RESERVE);
        virtualToken = bound(virtualToken, 1, MAX_RESERVE);
        tokenIn = bound(tokenIn, 0, MAX_AMOUNT);

        uint256 ethOutGross = CurveMath.sellEthOut(virtualEth, virtualToken, tokenIn);
        assertEq(ethOutGross, _refSell(virtualEth, virtualToken, tokenIn), "sell must equal ceil-reference");
    }

    // ───────────────────────── Round-trip: no free value extraction ──────────────────────

    /// @notice Buy then immediately sell the received tokens back must never return MORE net ETH
    ///         than was put in — the round-trip is value-losing (or break-even at worst) for the
    ///         trader, i.e. no fee-free arbitrage against the curve (gate 2: no ETH extraction beyond
    ///         fair curve value). Fees are NOT modeled here (pure math); this proves the math alone
    ///         is already non-extractive before fees make it strictly losing.
    function testFuzz_BuyThenSellNoProfit(uint256 virtualEth, uint256 virtualToken, uint256 ethInNet) public pure {
        virtualEth = bound(virtualEth, 1e6, MAX_RESERVE);
        virtualToken = bound(virtualToken, 1e6, MAX_RESERVE);
        ethInNet = bound(ethInNet, 0, MAX_AMOUNT);

        uint256 tokensOut = CurveMath.buyTokensOut(virtualEth, virtualToken, ethInNet);
        // Apply the buy to reserves, then sell the tokens straight back.
        uint256 vE2 = virtualEth + ethInNet;
        uint256 vT2 = virtualToken - tokensOut;
        uint256 ethBack = CurveMath.sellEthOut(vE2, vT2, tokensOut);

        assertLe(ethBack, ethInNet, "round-trip must not return more ETH than supplied (no extraction)");
    }

    // ─────────────────────────────── Zero-reserve guard ─────────────────────────────────

    function test_BuyRevertsOnZeroReserve() public {
        vm.expectRevert(CurveMath.CurveMathZeroReserve.selector);
        this.callBuy(0, 1e18, 1e18);
        vm.expectRevert(CurveMath.CurveMathZeroReserve.selector);
        this.callBuy(1e18, 0, 1e18);
    }

    function test_SellRevertsOnZeroReserve() public {
        vm.expectRevert(CurveMath.CurveMathZeroReserve.selector);
        this.callSell(0, 1e18, 1e18);
        vm.expectRevert(CurveMath.CurveMathZeroReserve.selector);
        this.callSell(1e18, 0, 1e18);
    }

    // External wrappers so `vm.expectRevert` observes the library revert across a call boundary.
    function callBuy(uint256 vE, uint256 vT, uint256 e) external pure returns (uint256) {
        return CurveMath.buyTokensOut(vE, vT, e);
    }

    function callSell(uint256 vE, uint256 vT, uint256 t) external pure returns (uint256) {
        return CurveMath.sellEthOut(vE, vT, t);
    }

    // ───────────────────────── Independent full-precision reference (F2) ──────────────────────
    // These recompute the curve output WITHOUT `Math.mulDiv`/`Math.Rounding` — the ceil is written by
    // hand as `q + (r != 0 ? 1 : 0)` — so they are a genuinely independent oracle for the rounding
    // DIRECTION, not a copy of the library under test. `virtualEth·virtualToken` is bounded to
    // ≤ MAX_RESERVE² = 1e60 < 2²⁵⁶ by the callers, so the plain-uint256 product cannot overflow.

    /// @dev tokensOut = virtualToken − ceil(virtualEth·virtualToken / (virtualEth + ethInNet)).
    function _refBuy(uint256 vE, uint256 vT, uint256 eIn) private pure returns (uint256) {
        uint256 num = vE * vT;
        uint256 den = vE + eIn;
        uint256 ceilRetained = num / den + (num % den == 0 ? 0 : 1);
        return vT - ceilRetained;
    }

    /// @dev ethOutGross = virtualEth − ceil(virtualEth·virtualToken / (virtualToken + tokenIn)).
    function _refSell(uint256 vE, uint256 vT, uint256 tIn) private pure returns (uint256) {
        uint256 num = vE * vT;
        uint256 den = vT + tIn;
        uint256 ceilRetained = num / den + (num % den == 0 ? 0 : 1);
        return vE - ceilRetained;
    }
}
