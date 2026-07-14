import { formatEther } from "viem";

import { formatEthNumber, formatPriceEth } from "@/shared/lib/format";
import { compactPriceParts, formatPriceCompact } from "@/shared/lib/format-price";
import { cn } from "@/shared/lib/utils";

/**
 * Presentational ETH PRICE renderer (web.md "Numbers"). Tiny values (< 1e-4, a
 * long leading-zero run) render in the DexScreener/pump.fun compact subscript
 * form — a REAL `<sub>` carrying the zero count — while normal-magnitude values
 * keep standard formatting so existing displays don't regress. Pure display over
 * a supplied indexer/on-chain figure: NO market math, NO hardcoded metric.
 *
 * Shares its decomposition with the plain-string `formatPriceCompact` (chart
 * axes, aria) via `compactPriceParts`, so string and JSX output cannot diverge.
 * The compact branch marks its glyphs `aria-hidden` and exposes the ASCII
 * fallback (`0.0(10)63 ETH`) as the accessible name so screen readers never read
 * a raw subscript.
 *
 * SSR-safe (no hooks / no "use client") — used inside the server-pre-rendered
 * Token Detail header (web.md SSR-vs-client rule).
 */
export function PriceEth({
  value,
  wei,
  unit = null,
  className,
  sigDigits,
  decimals,
}: {
  /** already-decimal ETH float (indexer `priceEth`). Provide either `value` or `wei`. */
  value?: number | null;
  /** wei decimal string / bigint (18dp). Converted to an ETH float for display. */
  wei?: string | bigint | null;
  /** optional trailing unit ("ETH"), inheriting the number's color. */
  unit?: string | null;
  className?: string;
  /** significant digits kept in the compact form (default 4). */
  sigDigits?: number;
  /**
   * When set, normal-magnitude values render zero-padded to this many decimals
   * (AMOUNT style, e.g. the event tape's "0.4200"); the default is 2 significant
   * digits (PRICE style — matches `formatPriceEth`, the trades feed / stat cells).
   */
  decimals?: number;
}) {
  const num =
    wei !== undefined && wei !== null ? Number(formatEther(BigInt(wei))) : (value ?? null);
  const plain =
    decimals !== undefined
      ? (abs: number) => formatEthNumber(abs, { decimals })
      : (abs: number) => formatPriceEth(abs);

  const parts = compactPriceParts(num, { sigDigits });
  const unitNode = unit ? <span className="ml-1">{unit}</span> : null;

  if (parts.kind === "empty") {
    return <span className={cn("tabular-nums", className)}>—</span>;
  }

  if (parts.kind === "plain") {
    return (
      <span className={cn("tabular-nums", className)}>
        {parts.sign}
        {plain(parts.abs)}
        {unitNode}
      </span>
    );
  }

  // compact subscript form — real <sub>; aria-label carries the ASCII fallback.
  const aria = formatPriceCompact(num, { sigDigits, unit, subscript: "paren", plain });
  return (
    <span className={cn("tabular-nums", className)} aria-label={aria}>
      <span aria-hidden>
        {parts.sign}
        {parts.intPart}.0<sub>{parts.leadingZeros}</sub>
        {parts.significantDigits}
      </span>
      {unitNode}
    </span>
  );
}
