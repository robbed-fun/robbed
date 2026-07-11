import { formatEthFromWei, formatEthNumber, formatTokenFromWei } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * Presentational ETH / token amount (web.md §7). Values are pre-computed
 * indexer/on-chain figures formatted for display — this component NEVER does
 * market math and NEVER carries a hardcoded metric (§2). ETH is the primary
 * denomination (§2); USD renders only via `UsdAmount`.
 */
export function EthAmount({
  wei,
  eth,
  className,
  unit = "ETH",
  decimals,
}: {
  /** wei decimal string. Provide either `wei` or `eth`. */
  wei?: string | bigint;
  /** already-decimal ETH float. */
  eth?: number;
  className?: string;
  unit?: string | null;
  /** Fixed, zero-padded decimal places (default 4 — mockup "0.4200 ETH"; portfolio values pass 2). */
  decimals?: number;
}) {
  const text =
    wei !== undefined
      ? formatEthFromWei(wei, { decimals })
      : eth !== undefined
        ? formatEthNumber(eth, { decimals })
        : "—";
  return (
    <span className={cn("tabular-nums", className)}>
      {text}
      {/* Unit inherits the number's color — mockup renders "0.4200 ETH" as ONE
          color in tape/table rows (docs/Robbed.html line 281). */}
      {unit ? <span className="ml-1">{unit}</span> : null}
    </span>
  );
}

export function TokenAmount({
  wei,
  className,
}: {
  wei: string | bigint;
  className?: string;
}) {
  return <span className={cn("tabular-nums", className)}>{formatTokenFromWei(wei)}</span>;
}
