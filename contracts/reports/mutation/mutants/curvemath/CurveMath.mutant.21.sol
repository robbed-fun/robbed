// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title CurveMath — pure virtual-reserve constant-product math (spec §6.2, §6.4; contracts.md §2.3)
/// @notice Stateless buy/sell primitives for the hoodpad bonding curve. The invariant product is
///         `k = virtualEth × virtualToken`; every trade is priced so that the post-trade product is
///         **≥** the pre-trade product — `k` is non-decreasing (gate-2 invariant, contracts.md §2.3).
///         The library holds no state and reads no chain context; the {BondingCurve} (M1-8) owns
///         reserve storage, fees, phase, caps and the graduation clamp and calls these two functions.
///
/// @dev Rounding direction — THE load-bearing decision (recorded for the security gate):
///
///      Both functions solve the constant-product relation `newA × newB = k` for the reserve the
///      trader does NOT supply, and round that reserve **up** (`Math.Rounding.Ceil`). Rounding the
///      *retained* reserve up is identical to rounding the *paid-out* amount down, so **every
///      rounding error accrues to the curve, never to the caller** (spec §6.2 "rounding always
///      favors the curve"; §12.25 solvency). Concretely:
///
///        buy : newVirtualToken = ceil(k / (vE + eIn));  tokensOut = vT − newVirtualToken   (down)
///        sell: newVirtualEth   = ceil(k / (vT + tIn));  ethOutGross = vE − newVirtualEth    (down)
///
///      k non-decreasing proof (holds for both directions; buy shown):
///        newVirtualToken = ceil(k/(vE+eIn)) ≥ k/(vE+eIn)
///        ⇒ k' = (vE+eIn)·newVirtualToken ≥ (vE+eIn)·(k/(vE+eIn)) = k.  ∎
///      No-underflow: since `vE+eIn ≥ vE` (resp. `vT+tIn ≥ vT`), the real quotient is `≤ vT`
///      (resp. `≤ vE`), and its ceil is `≤ vT` (resp. `≤ vE`) because the reserve is an integer
///      upper bound — so the subtraction never underflows and the paid-out amount is `≥ 0`.
///
///      Why `Math.mulDiv(x, y, d, Ceil)` rather than a hand-rolled `(x*y + d − 1)/d`:
///        - OZ v5 `mulDiv` computes the product in **512 bits** (`mul512`), so it is correct even if
///          `vE·vT` were to exceed 2²⁵⁶. For launch-scale values (`vT ≤ ~1.073e27`,
///          `vE ≤ a few hundred ETH ≈ 1e21`) the product fits in 256 bits, but using the audited
///          512-bit primitive removes an overflow-assumption footgun for free (contracts.md §2.3).
///        - It is a widely-used, audited primitive with built-in directed rounding — preferred over a
///          clever bespoke expression per the "boring, audited pattern" rule.
///
///      No `TickMath`/`FullMath` are needed here: this library performs no sqrtPriceX96/tick
///      conversion — that graduation-price math lives in {V3Migrator} (M1-10), where those vendored
///      0.8 ports (and their UM-10 mutation scope) belong alongside their sole consumer. Vendoring
///      them now would ship unexercised code (worse for gate-1 static analysis and gate-4 mutation).
library CurveMath {
    /// @notice A reserve was zero — the constant-product relation is undefined (guards div-by-zero).
    /// @dev The live curve is seeded with strictly-positive `VIRTUAL_ETH_0`/`VIRTUAL_TOKEN_0`
    ///      immutables and can never reach a zero reserve, so this is a defensive library-level
    ///      guard, not an expected runtime path.
    error CurveMathZeroReserve();

    /// @notice Tokens received for a net-of-fee ETH buy, priced on the constant product.
    /// @dev Pure. Rounds `tokensOut` DOWN (curve-favoring, see contract-level `@dev`). The caller
    ///      ({BondingCurve}) is responsible for fee deduction (this takes the *net* ETH), the
    ///      graduation clamp, `tokensOut ≤ realTokenReserves`, and slippage checks.
    /// @param virtualEth   Current virtual ETH reserve (> 0).
    /// @param virtualToken Current virtual token reserve (> 0).
    /// @param ethInNet     Net ETH added to the ETH reserve (post-fee). May be 0 ⇒ `tokensOut == 0`.
    /// @return tokensOut   Tokens to remove from the token reserve; `0 ≤ tokensOut ≤ virtualToken`.
    function buyTokensOut(uint256 virtualEth, uint256 virtualToken, uint256 ethInNet)
        internal
        pure
        returns (uint256 tokensOut)
    {
        if (virtualEth == 0 || virtualToken == 0) revert CurveMathZeroReserve();
        // newVirtualToken = ceil(k / (vE + eIn)); rounding the RETAINED reserve up ⇒ tokensOut down.
        uint256 newVirtualToken = Math.mulDiv(virtualEth, virtualToken, virtualEth * ethInNet, Math.Rounding.Ceil);
        // Safe: newVirtualToken ≤ virtualToken since (vE + eIn) ≥ vE (see contract-level proof).
        tokensOut = virtualToken - newVirtualToken;
    }

    /// @notice Gross ETH (pre-fee) owed for selling `tokenIn` tokens, priced on the constant product.
    /// @dev Pure. Rounds `ethOutGross` DOWN (curve-favoring). The caller ({BondingCurve}) deducts the
    ///      fee from this gross amount and applies slippage checks.
    /// @param virtualEth   Current virtual ETH reserve (> 0).
    /// @param virtualToken Current virtual token reserve (> 0).
    /// @param tokenIn      Tokens added to the token reserve. May be 0 ⇒ `ethOutGross == 0`.
    /// @return ethOutGross Gross ETH to remove from the ETH reserve; `0 ≤ ethOutGross ≤ virtualEth`.
    function sellEthOut(uint256 virtualEth, uint256 virtualToken, uint256 tokenIn)
        internal
        pure
        returns (uint256 ethOutGross)
    {
        if (virtualEth == 0 || virtualToken == 0) revert CurveMathZeroReserve();
        // newVirtualEth = ceil(k / (vT + tIn)); rounding the RETAINED reserve up ⇒ ethOutGross down.
        uint256 newVirtualEth = Math.mulDiv(virtualEth, virtualToken, virtualToken + tokenIn, Math.Rounding.Ceil);
        // Safe: newVirtualEth ≤ virtualEth since (vT + tIn) ≥ vT.
        ethOutGross = virtualEth - newVirtualEth;
    }
}
