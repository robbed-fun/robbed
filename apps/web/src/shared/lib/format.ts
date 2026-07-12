import { formatEther, formatUnits, getAddress } from "viem";
import type { UsdValue } from "@robbed/shared";

import { env } from "@/shared/lib/env";

/**
 * Display formatting (web.md §7). NO market metric is ever inlined here (§2);
 * these are pure formatters over live values. USD is renderable ONLY with a live
 * `{ usd, ethUsd, asOf }` object — `formatUsd` throws otherwise, so a bare USD
 * figure can never reach the DOM (proven by tests/format.test.ts).
 *
 * WAVE-1 fidelity contract (basis: docs/Robbed.html, sampled 2026-07-11):
 * - ETH amounts are ZERO-PADDED to a fixed decimal count, never trimmed —
 *   the mockup tape reads "0.4200 ETH" / "1.2000 ETH", the portfolio reads
 *   "1.40 ETH" (2 dec). Callers pick the count via `decimals` (default 4).
 * - Sub-0.0001 values render with 2 significant digits RETAINING a trailing
 *   zero, exactly like the mockup's starting price "0.0000010 ETH".
 * - Negative figures use the true minus U+2212 ("−1.8%"), never hyphen-minus.
 */

/** True minus sign (U+2212) — the mockup never renders ASCII "-" for negatives. */
const MINUS_SIGN = "−";

/** ETH amount from a wei decimal string → fixed, zero-padded decimals (default 4). */
export function formatEthFromWei(
  wei: string | bigint,
  opts?: { decimals?: number },
): string {
  const eth = Number(formatEther(BigInt(wei)));
  return formatEthNumber(eth, opts);
}

/**
 * Format an ETH float to a FIXED number of decimals, zero-padded, never trimmed
 * (mockup: "0.4200 ETH"). `decimals` defaults to 4 (trade amounts / tape);
 * portfolio-value callers pass 2 ("1.40 ETH", "+1.94 ETH").
 *
 * Tiny-value rule (DECISION, derived from ALL mockup samples — "0.0005",
 * "0.00034", "0.0000010" cannot share a naive threshold):
 * - abs < 10^-decimals (would render all zeros): 2 significant digits with the
 *   trailing zero retained — "0.0000010" (starting price).
 * - the 1-sig-digit zone (10^-decimals ≤ abs < 10^(1-decimals)): keep the fixed
 *   form when it round-trips EXACTLY ("0.0005" deploy cost, "+0.08" PnL at
 *   2 dec), else extend to 2 significant digits ("0.00034" portfolio price) —
 *   never display a rounded figure that silently loses the only precision it has.
 * - everything else: plain zero-padded toFixed ("0.0310", "0.0012").
 */
export function formatEthNumber(eth: number, opts?: { decimals?: number }): string {
  if (!Number.isFinite(eth)) return "—";
  const decimals = opts?.decimals ?? 4;
  const abs = Math.abs(eth);
  const sign = eth < 0 ? MINUS_SIGN : "";
  if (abs >= 1e21) {
    // Review fix (2026-07-11): Number#toFixed switches to exponential notation at
    // 1e21 ("1e+21 ETH"). Intl with `notation: "standard"` never emits e-notation,
    // so the huge-magnitude branch keeps the same fixed zero-padded contract.
    const huge = new Intl.NumberFormat("en-US", {
      useGrouping: false,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(abs);
    return `${sign}${huge}`;
  }
  const fixed = abs.toFixed(decimals);
  if (abs !== 0 && abs < 10 ** (1 - decimals) && Number(fixed) !== abs) {
    // 2 significant digits, zero-padded via toFixed (never trimmed):
    // 0.000001 → places 7 → "0.0000010"; 0.00034 → places 5 → "0.00034".
    // Review fix (2026-07-11): round to 2 sig digits FIRST and derive the places
    // from the ROUNDED value — 0.00009999 must render "0.00010" (2 sig), not
    // "0.000100" (places from the pre-rounded magnitude yielded 3 sig digits).
    // The exponent comes from `toExponential` (exact, string-based) rather than
    // Math.log10 to avoid float-epsilon flooring errors at power-of-ten edges.
    const rounded = Number(abs.toPrecision(2));
    const exp = Number(rounded.toExponential(1).split("e")[1]);
    const places = Math.min(100, Math.max(decimals, 1 - exp));
    return `${sign}${rounded.toFixed(places)}`;
  }
  return `${sign}${fixed}`;
}

/**
 * Display-only price float (indexer `priceEth`, a display float per the shared
 * WS/REST contract) → 2 significant digits in PLAIN decimal notation, never
 * exponential. Review fix (2026-07-11): `toPrecision(2)` rendered early curve
 * prices as "9.3e-10" in the trades table; Intl with `notation: "standard"`
 * never emits e-notation (verified empirically, 2026-07-12) and
 * `minimumSignificantDigits` retains the trailing zero ("0.0000010").
 */
export function formatPriceEth(price: number | null, sigDigits = 2): string {
  if (price === null || !Number.isFinite(price)) return "—";
  if (price === 0) return "0.0";
  const sign = price < 0 ? MINUS_SIGN : "";
  const text = new Intl.NumberFormat("en-US", {
    notation: "standard",
    useGrouping: false,
    minimumSignificantDigits: sigDigits,
    maximumSignificantDigits: sigDigits,
  }).format(Math.abs(price));
  return `${sign}${text}`;
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

/**
 * Percentage with 1 decimal + explicit sign for deltas. Negatives render with
 * the true minus U+2212 (mockup "−1.8%"), never ASCII hyphen-minus.
 */
export function formatPercent(pct: number | null, opts?: { signed?: boolean }): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const s = Math.abs(pct).toFixed(1);
  // Review fix (2026-07-11): branch the sign on the ROUNDED display value —
  // −0.04 rounds to "0.0" and must render unsigned "0.0%", never "−0.0%".
  const roundsToZero = Number(s) === 0;
  if (pct < 0 && !roundsToZero) return `${MINUS_SIGN}${s}%`;
  return opts?.signed && pct > 0 && !roundsToZero ? `+${s}%` : `${s}%`;
}

/**
 * Companion to `formatPercent` for tone/tint decisions: true when the value
 * ROUNDS to the "0.0%" display (1-decimal contract). A delta that displays as
 * zero must tint neutral, not red/green (review fix 2026-07-11 — "−0.0%" red).
 */
export function percentRoundsToZero(pct: number | null): boolean {
  if (pct === null || !Number.isFinite(pct)) return true;
  return Number(Math.abs(pct).toFixed(1)) === 0;
}

/** Relative age from a unix-seconds timestamp (indexer block time). */
export function formatAge(unixSeconds: number, now = Date.now()): string {
  const deltaSec = Math.max(0, Math.floor(now / 1000) - unixSeconds);
  if (deltaSec < 60) return `${deltaSec}s`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h`;
  return `${Math.floor(deltaSec / 86400)}d`;
}

/**
 * Truncate an address to `0x7fA3…c92E` — EIP-55 checksummed BEFORE slicing
 * (mockup wallet chip shows mixed-case; viem `getAddress`, verified 2026-07-11).
 * Pure/safe: non-address strings pass through untouched; the lowercase
 * normalization means `getAddress` cannot throw on a regex-valid input, but the
 * catch keeps the function total regardless.
 */
export function shortAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return address;
  let checksummed = address;
  try {
    checksummed = getAddress(address.toLowerCase());
  } catch {
    // keep the caller's casing — never throw from a display formatter
  }
  return `${checksummed.slice(0, 6)}…${checksummed.slice(-4)}`;
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
