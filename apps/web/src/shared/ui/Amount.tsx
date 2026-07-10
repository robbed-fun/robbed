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
}: {
  /** wei decimal string. Provide either `wei` or `eth`. */
  wei?: string | bigint;
  /** already-decimal ETH float. */
  eth?: number;
  className?: string;
  unit?: string | null;
}) {
  const text =
    wei !== undefined
      ? formatEthFromWei(wei)
      : eth !== undefined
        ? formatEthNumber(eth)
        : "—";
  return (
    <span className={cn("tabular-nums", className)}>
      {text}
      {unit ? <span className="ml-1 text-muted-foreground">{unit}</span> : null}
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
