/**
 * Price derivation — ETH per token, uniform across venues so the candle series
 * is venue-continuous by construction (indexer.md).
 *
 * All robbed tokens and WETH are 18-decimal, so ratios are pure numbers with
 * no decimal adjustment (indexer.md "18/18 decimals"). Prices are
 * DISPLAY-ONLY doubles (indexer.md); we scale through bigint first to keep
 * ~18 fractional digits before the single lossy Number() conversion.
 */

const SCALE = 10n ** 18n;
const Q192 = 1n << 192n;

/**
 * Curve spot price from POST-trade virtual reserves carried in the `Trade`
 * event (indexer.md) `price = virtualEth / virtualToken`. Zero hot-path
 * RPC reads. Returns 0 if reserves are degenerate (guards div-by-zero).
 */
export function curvePriceEth(virtualEth: bigint, virtualToken: bigint): number {
  if (virtualToken <= 0n) return 0;
  return Number((virtualEth * SCALE) / virtualToken) / 1e18;
}

/**
 * V3 price from `sqrtPriceX96` (indexer.md, X-2 orientation).
 *
 * The raw ratio `(sqrtPriceX96 / 2^96)^2` is **token1 per token0**. We want
 * WETH per token:
 *  - token is **token0** (`token < WETH`, WETH is token1) → raw is already
 *    WETH-per-token → use directly;
 *  - token is **token1** (`token > WETH`, WETH is token0) → raw is
 *    token-per-WETH → **invert** (`1 / raw`).
 *
 * `tokenIsToken0 = (token < WETH)` is resolved once per pool at graduation and
 * cached (`graduations.token_is_token0`). The fork test (contracts.md gate 3)
 * arbitrates the sign.
 */
export function v3PriceEth(sqrtPriceX96: bigint, tokenIsToken0: boolean): number {
  if (sqrtPriceX96 <= 0n) return 0;
  // raw * 1e18, computed in bigint to preserve precision before Number().
  const rawScaled = (sqrtPriceX96 * sqrtPriceX96 * SCALE) / Q192;
  const raw = Number(rawScaled) / 1e18; // token1-per-token0
  if (tokenIsToken0) return raw; // WETH per token, use directly
  if (raw === 0) return 0;
  return 1 / raw; // invert: token-per-WETH → WETH-per-token
}

/** `token_is_token0` orientation: the token is token0 iff its address sorts below WETH. */
export function tokenIsToken0(tokenAddress: string, weth: string): boolean {
  return BigInt(tokenAddress.toLowerCase()) < BigInt(weth.toLowerCase());
}
