import { formatEther, formatUnits } from "viem";

import { formatEthNumber } from "@/shared/lib/format";

/**
 * Portfolio-local display formatters (mockup: docs/Robbed.html page "2c"). Pure
 * formatting over SUPPLIED indexer/on-chain values — never market math and never
 * a hardcoded metric (§2). These are slice-local because they differ from the
 * shared token/ETH formatters: balances render as GROUPED integers (mockup
 * "4,120,551", not the compact "4.12M" the grid uses) and PnL values carry an
 * explicit sign.
 */

/** Token balance (wei, 18dp) → grouped integer, matching the mockup rows. */
export function formatBalance(wei: string): string {
  const n = Number(formatUnits(BigInt(wei), 18));
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    // Sub-unit dust keeps a little precision; whole balances group with no decimals.
    maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 0,
  }).format(n);
}

/**
 * Signed ETH float → `+0.62` / `−0.07` / `0.00` (leading `+` only for positives;
 * negatives carry the true minus U+2212 from the shared formatter). Portfolio
 * values render with 2 decimals per the mockup ("1.40 ETH", LOOT "+1.94 ETH").
 */
export function signedEth(eth: number): string {
  if (!Number.isFinite(eth)) return "—";
  const base = formatEthNumber(eth, { decimals: 2 }); // carries U+2212 for negatives
  return eth > 0 ? `+${base}` : base;
}

/** Signed ETH from a wei decimal string (PnL bounds are wei). */
export function signedEthFromWei(wei: string): string {
  return signedEth(Number(formatEther(BigInt(wei))));
}

export type PnlTone = "green" | "red" | "muted";

/**
 * Tone for a PnL ETH range: green when the whole range is a gain, red when it is
 * a loss, muted when it straddles zero (or is exactly zero) — so a range that
 * cannot commit to a sign is NOT painted as a win/loss (no false precision, §5.2).
 */
export function pnlTone(lowEth: number, highEth: number): PnlTone {
  if (lowEth >= 0 && highEth > 0) return "green";
  if (highEth <= 0 && lowEth < 0) return "red";
  return "muted";
}

/**
 * "first seen 3mo ago" line (mockup) from the summary's `firstSeenAt` unix-sec.
 * null → "new here" (a never-seen address). Coarser than `formatAge` (which caps
 * at days) because accounts span months/years; still timestamp-only (never
 * `block.number`, CLAUDE.md).
 */
export function formatFirstSeen(unixSeconds: number | null, now = Date.now()): string {
  if (unixSeconds === null) return "new here";
  const d = Math.max(0, Math.floor(now / 1000) - unixSeconds);
  if (d < 60) return "first seen just now";
  let span: string;
  if (d < 3_600) span = `${Math.floor(d / 60)}m`;
  else if (d < 86_400) span = `${Math.floor(d / 3_600)}h`;
  else if (d < 2_592_000) span = `${Math.floor(d / 86_400)}d`;
  else if (d < 31_536_000) span = `${Math.floor(d / 2_592_000)}mo`;
  else span = `${Math.floor(d / 31_536_000)}y`;
  return `first seen ${span} ago`;
}
