/**
 * Projection helpers shared across card/detail/trade/holder/portfolio. No wire
 * shapes are declared here — only math/format utilities feeding the frozen shared
 * DTOs.
 */
import type { TokenCard } from "@robbed/shared";
import type { EthUsdSnapshot } from "../lib/usd";

/** Epoch-zero placeholder when NO snapshot exists — marks the value stale
 * (age → ∞) rather than inventing a constant price (spec §2). */
export const MISSING_ETH_USD: EthUsdSnapshot = {
  price_usd: 0,
  fetched_at: "1970-01-01T00:00:00.000Z",
};

export function resolveSnapshot(
  snap: { price_usd: number; fetched_at: string } | null,
): EthUsdSnapshot {
  return snap ?? MISSING_ETH_USD;
}

/** Ratio of two uint256 decimal strings as a float in [0, ∞); 0 when denom is 0. */
export function ratio(numer: string, denom: string): number {
  const d = BigInt(denom || "0");
  if (d === 0n) return 0;
  const n = BigInt(numer || "0");
  // Scale to preserve fractional precision without float overflow.
  const scaled = (n * 1_000_000n) / d;
  return Number(scaled) / 1_000_000;
}

/** Progress fraction real/grad in [0,1] (over-1 clamped for display sanity). */
export function progressFraction(realEth: string, gradEth: string): number {
  const p = ratio(realEth, gradEth);
  return p > 1 ? 1 : p;
}

/**
 * Derived venue/status pill (indexer.md §3.2): `graduated` → graduated;
 * `real_eth ≥ graduation_eth` and not yet graduated → the §12.12 lock window
 * `graduating`; else `curve`. SINGLE source used by the card and portfolio
 * token-ref projections so the pill can't drift between surfaces.
 */
export function statusFrom(
  graduated: boolean,
  realEthReserves: string,
  graduationEth: string,
): TokenCard["status"] {
  if (graduated) return "graduated";
  if (BigInt(realEthReserves || "0") >= BigInt(graduationEth || "0")) return "graduating";
  return "curve";
}
