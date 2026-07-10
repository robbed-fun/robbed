/**
 * curve-quote — pure TS port of contracts/src/libs/CurveMath.sol (spec §6.2,
 * §6.4; contracts.md §2.3). BYTE-IDENTICAL semantics to the on-chain library so
 * the client can preview a trade WITHOUT a chain round-trip:
 *  - M3-6 launch initial-buy preview + a non-zero `minTokensOut` slippage floor
 *    for a NOT-YET-DEPLOYED token, seeded by the factory's initial virtual
 *    reserves (`VIRTUAL_ETH_0` / `VIRTUAL_TOKEN_0`, contracts.md §2.2);
 *  - a reusable pre-grad quote for any live curve given its current reserves.
 *
 * ── Rounding — THE load-bearing invariant (CurveMath.sol @dev; §6.2/§12.25) ──
 * Both primitives solve the constant-product relation `newA · newB = k` for the
 * reserve the trader does NOT supply and round THAT retained reserve UP (ceil).
 * Rounding the retained reserve up == rounding the paid-out amount DOWN, so every
 * rounding error accrues to the curve, never to the caller. In Solidity this is
 * `Math.mulDiv(x, y, d, Math.Rounding.Ceil)`; here it is {@link ceilMulDiv} over
 * native `bigint` — arbitrary precision, so the 512-bit-product concern the
 * Solidity comment raises cannot arise (the values are exact). All inputs and
 * outputs are wei-scale `bigint` (never `number`): token amounts reach ~1.073e27
 * and lose precision as JS `number`.
 *
 * k non-decreasing (buy shown; sell symmetric): newVirtualToken = ceil(k/(vE+e))
 * ≥ k/(vE+e) ⇒ k' = (vE+e)·newVirtualToken ≥ k. No underflow: since vE+e ≥ vE the
 * real quotient is ≤ vT and its ceil is ≤ vT (integer upper bound), so the
 * subtraction never underflows and tokensOut ≥ 0. (contracts.md §2.3.)
 *
 * Fidelity note: {@link buyTokensOut} / {@link sellEthOut} mirror the CurveMath
 * primitives ONLY (no fee, no graduation clamp — those live in {BondingCurve}).
 * {@link previewBuy} / {@link previewSell} add the in-contract fee (floor,
 * contracts.md §2.3 §12.25) for a display quote. They deliberately do NOT apply
 * the graduation-boundary clamp: the clamp only bites within the last
 * `GRADUATION_ETH − realEthReserves` of the curve; a launch initial-buy is far
 * from it, and the on-chain `quoteBuy` view (contracts.md §2.3) stays
 * authoritative near graduation. Callers previewing a near-graduation buy must
 * use the chain view, not this module.
 */

/** A reserve was zero — the constant-product relation is undefined. Mirrors
 *  CurveMath.CurveMathZeroReserve (a defensive guard: a live curve is seeded with
 *  strictly-positive virtual reserves and can never reach zero). */
export class CurveQuoteZeroReserveError extends Error {
  constructor() {
    super("CurveMathZeroReserve: a virtual reserve is zero");
    this.name = "CurveQuoteZeroReserveError";
  }
}

/** Basis-points denominator (contracts.md §2.3 fee: `floor(x · bps / 10_000)`). */
const BPS_DENOMINATOR = 10_000n;

/**
 * ceil(x · y / d) over bigint — the exact analogue of OZ `Math.mulDiv(x, y, d,
 * Math.Rounding.Ceil)`. Requires `d > 0`; `x, y ≥ 0`.
 */
function ceilMulDiv(x: bigint, y: bigint, d: bigint): bigint {
  const numerator = x * y;
  // (n + d − 1) / d with truncating bigint division == ceil(n / d) for n ≥ 0, d > 0.
  return (numerator + d - 1n) / d;
}

/**
 * Tokens received for a net-of-fee ETH buy, priced on the constant product.
 * Byte-identical to `CurveMath.buyTokensOut`. Rounds tokensOut DOWN.
 * @param virtualEth   Current virtual ETH reserve (> 0), wei.
 * @param virtualToken Current virtual token reserve (> 0), wei.
 * @param ethInNet     Net ETH added to the reserve (post-fee), wei; 0 ⇒ 0 out.
 * @returns tokensOut — `0 ≤ tokensOut ≤ virtualToken`, wei.
 */
export function buyTokensOut(
  virtualEth: bigint,
  virtualToken: bigint,
  ethInNet: bigint,
): bigint {
  if (virtualEth === 0n || virtualToken === 0n) throw new CurveQuoteZeroReserveError();
  // newVirtualToken = ceil(k / (vE + eIn)); retained reserve up ⇒ tokensOut down.
  const newVirtualToken = ceilMulDiv(virtualEth, virtualToken, virtualEth + ethInNet);
  return virtualToken - newVirtualToken;
}

/**
 * Gross ETH (pre-fee) owed for selling `tokenIn` tokens, priced on the constant
 * product. Byte-identical to `CurveMath.sellEthOut`. Rounds ethOutGross DOWN.
 * @param virtualEth   Current virtual ETH reserve (> 0), wei.
 * @param virtualToken Current virtual token reserve (> 0), wei.
 * @param tokenIn      Tokens added to the reserve, wei; 0 ⇒ 0 out.
 * @returns ethOutGross — `0 ≤ ethOutGross ≤ virtualEth`, wei.
 */
export function sellEthOut(
  virtualEth: bigint,
  virtualToken: bigint,
  tokenIn: bigint,
): bigint {
  if (virtualEth === 0n || virtualToken === 0n) throw new CurveQuoteZeroReserveError();
  // newVirtualEth = ceil(k / (vT + tIn)); retained reserve up ⇒ ethOutGross down.
  const newVirtualEth = ceilMulDiv(virtualEth, virtualToken, virtualToken + tokenIn);
  return virtualEth - newVirtualEth;
}

export interface BuyPreview {
  /** In-contract fee, wei — `floor(ethInGross · tradeFeeBps / 10_000)`. */
  fee: bigint;
  /** Net ETH priced on the curve, wei — `ethInGross − fee`. */
  netEth: bigint;
  /** Tokens out, wei — floored (curve-favoring). Use as the `minTokensOut` basis. */
  tokensOut: bigint;
}

export interface SellPreview {
  /** Gross ETH from the curve before fee, wei. */
  ethOutGross: bigint;
  /** In-contract fee, wei — `floor(ethOutGross · tradeFeeBps / 10_000)`. */
  fee: bigint;
  /** Net ETH the seller receives, wei — `ethOutGross − fee`. Use as `minEthOut` basis. */
  ethOut: bigint;
}

/**
 * Fee-inclusive buy preview (contracts.md §2.3 buy order: fee first, then curve
 * math on the net). Mirrors the curve EXCEPT the graduation clamp (see module
 * @dev). Use `tokensOut` to derive a slippage-protected `minTokensOut`.
 * @param tradeFeeBps The curve's snapshot `TRADE_FEE_BPS` (per-curve, §12.40d).
 */
export function previewBuy(
  virtualEth: bigint,
  virtualToken: bigint,
  ethInGross: bigint,
  tradeFeeBps: number | bigint,
): BuyPreview {
  const bps = BigInt(tradeFeeBps);
  const fee = (ethInGross * bps) / BPS_DENOMINATOR; // floor
  const netEth = ethInGross - fee;
  const tokensOut = buyTokensOut(virtualEth, virtualToken, netEth);
  return { fee, netEth, tokensOut };
}

/**
 * Fee-inclusive sell preview (contracts.md §2.3 sell order: curve math on the
 * token leg first, then fee on the gross ETH out). Use `ethOut` to derive a
 * slippage-protected `minEthOut`.
 * @param tradeFeeBps The curve's snapshot `TRADE_FEE_BPS` (per-curve, §12.40d).
 */
export function previewSell(
  virtualEth: bigint,
  virtualToken: bigint,
  tokenIn: bigint,
  tradeFeeBps: number | bigint,
): SellPreview {
  const bps = BigInt(tradeFeeBps);
  const ethOutGross = sellEthOut(virtualEth, virtualToken, tokenIn);
  const fee = (ethOutGross * bps) / BPS_DENOMINATOR; // floor
  return { ethOutGross, fee, ethOut: ethOutGross - fee };
}
