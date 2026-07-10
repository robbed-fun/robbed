import { formatEther, formatUnits } from "viem";
import type { UsdValue } from "@robbed/shared";

import { env } from "@/shared/lib/env";

/**
 * Display formatting (web.md §7). NO market metric is ever inlined here (§2);
 * these are pure formatters over live values. USD is renderable ONLY with a live
 * `{ usd, ethUsd, asOf }` object — `formatUsd` throws otherwise, so a bare USD
 * figure can never reach the DOM (proven by tests/format.test.ts).
 */

/** ETH amount from a wei decimal string → up to 4 significant fractional digits. */
export function formatEthFromWei(wei: string | bigint): string {
  const eth = Number(formatEther(BigInt(wei)));
  return formatEthNumber(eth);
}

/** Format an ETH float to 4 significant decimals, trimming trailing zeros. */
export function formatEthNumber(eth: number): string {
  if (!Number.isFinite(eth)) return "—";
  if (eth === 0) return "0";
  const abs = Math.abs(eth);
  // 4 significant digits; more precision for sub-1 amounts, compact for large.
  const digits = abs >= 1 ? 4 : Math.min(8, 4 + Math.ceil(-Math.log10(abs)));
  return trimZeros(eth.toFixed(digits));
}

/** Token amount from a wei decimal string (18 decimals) → compact (1.24M). */
export function formatTokenFromWei(wei: string | bigint, decimals = 18): string {
  const n = Number(formatUnits(BigInt(wei), decimals));
  return formatCompact(n);
}

/** Compact number: 1_240_000 → "1.24M". */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n);
}

/** Percentage with 1 decimal + explicit sign for deltas. */
export function formatPercent(pct: number | null, opts?: { signed?: boolean }): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const s = pct.toFixed(1);
  return opts?.signed && pct > 0 ? `+${s}%` : `${s}%`;
}

/** Relative age from a unix-seconds timestamp (indexer block time). */
export function formatAge(unixSeconds: number, now = Date.now()): string {
  const deltaSec = Math.max(0, Math.floor(now / 1000) - unixSeconds);
  if (deltaSec < 60) return `${deltaSec}s`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h`;
  return `${Math.floor(deltaSec / 86400)}d`;
}

/** Truncate an address to `0x1234…abcd`. */
export function shortAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Render a USD figure — ONLY from a live snapshot object (§2). There is no code
 * path that produces a USD string without `{ usd, ethUsd, asOf }`; callers that
 * lack it must show the ETH denomination instead. Returns the figure plus the
 * source/timestamp the UI must disclose on hover.
 */
export function formatUsd(value: UsdValue | null | undefined): {
  text: string;
  asOf: string;
  ethUsd: string;
  stale: boolean;
} {
  if (!value || value.usd === undefined || value.asOf === undefined) {
    throw new Error(
      "[robbed/web] formatUsd requires a live { usd, ethUsd, asOf } snapshot — " +
        "USD is never rendered without a source + timestamp (spec §2).",
    );
  }
  const usdNum = Number(value.usd);
  // PROD (default): full precision, NOT compact — the value is rendered VERBATIM
  // from the indexer payload so the exact figure the user sees is the exact figure
  // the indexer priced (§2 source-fidelity; asserted by tests/discover-card.test.tsx).
  // DEMO MODE (Gap 2): render compact (e.g. 610K, 1.2M form) to match the ROBBED_
  // terminal mockup (docs/Robbed.html) exactly. Gated by `env.mockData()` — the
  // prod formatter keeps full precision; this branch is dead with the flag off.
  const compact = env.mockData();
  const text = Number.isFinite(usdNum)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        ...(compact
          ? { notation: "compact" as const }
          : { maximumFractionDigits: usdNum >= 1 ? 0 : 4 }),
      }).format(usdNum)
    : "—";
  return {
    text,
    asOf: value.asOf,
    ethUsd: value.ethUsd,
    stale: value.stale === true,
  };
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}
