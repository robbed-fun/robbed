import { formatPriceEth } from "./format";

/**
 * Compact tiny-price display — the DexScreener / pump.fun subscript notation.
 *
 * A memecoin priced at `0.000000000063` ETH is unreadable as a long zero run,
 * so tiny values collapse the leading-zero run into a subscript COUNT:
 *
 *   0.000000000063  →  0.0₁₀63   (subscript "10" = the ten leading zeros)
 *
 * This module is a PURE DISPLAY formatter (no-market-metrics rule): it formats
 * whatever ETH value is handed to it and NEVER fabricates a price, USD, or ETH/USD
 * figure. `compactPriceParts` is the single source of truth for the decomposition;
 * the plain-string formatter (`formatPriceCompact`, for aria-labels / tooltips /
 * canvas chart axes) and the React renderer (`<PriceEth>` in `shared/ui`) both
 * consume it so string and JSX output can never diverge.
 *
 * NOTE: the rendered `0.0` is a fixed motif (matches DexScreener); the subscript
 * carries the FULL leading-zero count, so `0.0₁₀63` decodes as "0." + ten zeros +
 * "63". Normal-magnitude values are NOT compacted — they fall through to the
 * caller's plain formatter (default: 2 significant digits) so existing behavior
 * is preserved.
 */

/** True minus sign (U+2212) — same convention as `shared/lib/format`. */
const MINUS_SIGN = "−";

/**
 * Minimum leading-zero run that triggers the compact form. 4 leading zeros means
 * |value| < 1e-4 (e.g. `0.00009…`); at/above `0.0001` a plain decimal is already
 * short and readable ("0.00034"), so it is left alone.
 */
export const COMPACT_ZERO_RUN = 4;

/** |value| ≥ this is never compacted (== 4 leading zeros boundary, 1e-4). */
const COMPACT_THRESHOLD = 1e-4;

/** Significant digits kept AFTER the elided zero run (spec: 2–4). */
const DEFAULT_SIG_DIGITS = 4;

const SUBSCRIPT_DIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"] as const;

/**
 * Structured decomposition of a price for rendering. `plain` carries the sign +
 * absolute value for the caller's normal formatter; `compact` carries the parts
 * the subscript renderer needs. Discriminated so both the string and JSX layers
 * stay exhaustive.
 */
export type CompactPriceParts =
  | { kind: "empty" }
  | { kind: "plain"; sign: string; abs: number }
  | {
      kind: "compact";
      /** "" or U+2212 */
      sign: string;
      /** always "0" for a sub-1 compact value (kept for symmetry with the spec). */
      intPart: string;
      /** the subscript value — count of leading zeros after the decimal point. */
      leadingZeros: number;
      /** significant digits after the elided zeros, trailing zeros trimmed ("63"). */
      significantDigits: string;
    };

/**
 * PURE decomposition. Handles `null`/`undefined`/`NaN` (→ empty), exact `0` and
 * normal magnitudes (→ plain), and negatives (sign split off). Only |value| < 1e-4
 * with ≥ 4 leading zeros becomes `compact`.
 *
 * The exponent/mantissa come from `toExponential` (exact, string-based) rather
 * than `Math.log10` to avoid float-epsilon flooring at power-of-ten edges — the
 * same discipline `formatEthNumber` uses. A rounding carry that lifts the value
 * back to ≥ 1e-4 (e.g. `0.000099999` → `0.0001`) falls back to plain.
 */
export function compactPriceParts(
  value: number | null | undefined,
  opts?: { sigDigits?: number },
): CompactPriceParts {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { kind: "empty" };
  }
  if (value === 0) return { kind: "plain", sign: "", abs: 0 };
  const sign = value < 0 ? MINUS_SIGN : "";
  const abs = Math.abs(value);
  if (abs >= COMPACT_THRESHOLD) return { kind: "plain", sign, abs };

  const sig = Math.min(8, Math.max(1, Math.floor(opts?.sigDigits ?? DEFAULT_SIG_DIGITS)));
  const [mantissa, expPart] = abs.toExponential(sig - 1).split("e");
  const exp = Number(expPart);
  const leadingZeros = -exp - 1;
  if (leadingZeros < COMPACT_ZERO_RUN) {
    // Rounding carried the value up to ≥ 1e-4 — render it plainly.
    return { kind: "plain", sign, abs };
  }
  const significantDigits = mantissa!.replace(".", "").replace(/0+$/, "") || "0";
  return { kind: "compact", sign, intPart: "0", leadingZeros, significantDigits };
}

/**
 * Render the leading-zero COUNT as a subscript. `unicode` (chart canvas / any
 * plain-text surface that can show glyphs) → `₁₀`; `paren` (ASCII fallback for
 * aria-labels, logs, screen readers) → `(10)`.
 */
export function subscriptCount(n: number, style: "unicode" | "paren" = "unicode"): string {
  if (style === "paren") return `(${n})`;
  return String(n)
    .split("")
    .map((d) => SUBSCRIPT_DIGITS[Number(d)] ?? d)
    .join("");
}

/**
 * PLAIN-STRING price formatter — for non-JSX contexts (aria-labels, tooltips, the
 * lightweight-charts canvas axis/crosshair). Tiny values render compact via
 * `subscriptCount`; normal values go through `plain` (default: 2 significant
 * digits, plain decimal, never exponential — the app's `formatPriceEth`).
 *
 * `subscript: "paren"` yields the ASCII fallback `0.0(10)63`; `"unicode"` yields
 * `0.0₁₀63`. An optional `unit` suffix (` ETH`) is appended.
 */
export function formatPriceCompact(
  value: number | null | undefined,
  opts?: {
    sigDigits?: number;
    unit?: string | null;
    subscript?: "unicode" | "paren";
    plain?: (abs: number) => string;
  },
): string {
  const parts = compactPriceParts(value, { sigDigits: opts?.sigDigits });
  if (parts.kind === "empty") return "—";
  const unit = opts?.unit ? ` ${opts.unit}` : "";
  const plain = opts?.plain ?? ((abs: number) => formatPriceEth(abs));
  if (parts.kind === "plain") return `${parts.sign}${plain(parts.abs)}${unit}`;
  const sub = subscriptCount(parts.leadingZeros, opts?.subscript ?? "unicode");
  return `${parts.sign}${parts.intPart}.0${sub}${parts.significantDigits}${unit}`;
}
