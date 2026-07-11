import { formatUnits } from "viem";

/**
 * YOU RECEIVE preview formatting (fidelity audit fix 13; mockup template 2a line
 * 418: `1,462.8` — GROUPED with exactly 1 decimal). Slice-local `lib/` helper:
 * this display rule applies only to the trade widget's receive box, so it does
 * NOT belong in `shared/lib/format` (whose token formatter is compact "1.24M"
 * for tables/cards).
 *
 * DECISION (recorded): values ≥ 1 render grouped + 1 fixed decimal per the
 * mockup; sub-1 values keep 4 significant digits (the mockup shows no sub-1
 * sample — 1 decimal would collapse e.g. 0.0421 to "0.0", silently destroying
 * the only precision the quote has, which the format contract forbids).
 * Pure display formatting over an on-chain quote — never market math (§2).
 */
export function formatReceiveTokenAmount(wei: bigint, decimals = 18): string {
  const n = Number(formatUnits(wei, decimals));
  if (!Number.isFinite(n)) return "—";
  if (n >= 1) {
    return n.toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }
  if (n === 0) return "0.0";
  // Sub-1: 4 significant digits, no exponent (toPrecision can emit e-notation
  // for tiny magnitudes; toFixed re-expands it deterministically).
  const places = Math.min(100, 3 - Math.floor(Math.log10(n)));
  return n.toFixed(places);
}
