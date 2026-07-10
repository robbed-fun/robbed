import type { PortfolioHolding } from "@robbed/shared";
import Link from "next/link";

import {
  EthAmount,
  MonoLabel,
  TokenAvatar,
  UsdAmount,
} from "@/shared/ui";
import { formatEthNumber } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

import { formatBalance } from "../lib/format";
import { PnlRange } from "./PnlRange";

/**
 * One HOLDINGS row (mockup "2c": TOKEN / BALANCE / PRICE / VALUE / PNL). Two
 * layouts share the SAME data cells:
 *   - md+ : the exact mockup grid (`HOLDINGS_GRID`, reused by the table header).
 *   - <md : a stacked card (token line + labelled BALANCE/PRICE/VALUE cells),
 *           per the redesign's "table → cards/scroll" mobile rule.
 *
 * Every metric is a SUPPLIED indexer value; `priceEth`/`valueEth`/`value`/
 * `unrealizedPnl` render their nullable/range forms honestly (§2, §5.2) — an
 * unpriceable holding shows an em-dash, never a fabricated number. USD, when
 * present, is surfaced via `UsdAmount` (live source + timestamp, §2).
 */

/** Shared grid template so the row and the table header stay column-aligned. */
export const HOLDINGS_GRID =
  "grid grid-cols-[minmax(0,1fr)_96px_88px_120px_92px] items-center gap-3 sm:gap-4";

function TokenCell({ token }: { token: PortfolioHolding["token"] }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <TokenAvatar
        imageUrl={token.imageUrl}
        name={token.name}
        ticker={token.ticker}
        size={22}
      />
      <span className="truncate text-text">{token.ticker}</span>
      {token.graduated && (
        <MonoLabel tone="purple" size="2xs" className="shrink-0">
          AMM
        </MonoLabel>
      )}
    </span>
  );
}

function PriceText({ priceEth }: { priceEth: number | null }) {
  return (
    <>{priceEth === null ? <span className="text-faint">—</span> : formatEthNumber(priceEth)}</>
  );
}

function ValueCell({
  valueEth,
  value,
  align = "right",
}: {
  valueEth: PortfolioHolding["valueEth"];
  value: PortfolioHolding["value"];
  align?: "right" | "left";
}) {
  if (valueEth === null) return <span className="text-faint">—</span>;
  return (
    <span className={cn("flex flex-col", align === "right" ? "items-end" : "items-start")}>
      <EthAmount wei={valueEth} unit="ETH" className="text-text" />
      {value ? <UsdAmount value={value} className="text-2xs text-muted" /> : null}
    </span>
  );
}

export function HoldingRow({ holding }: { holding: PortfolioHolding }) {
  const { token, balance, priceEth, valueEth, value, unrealizedPnl } = holding;
  const href = `/t/${token.address}`;

  return (
    <>
      {/* md+ — mockup grid row */}
      <Link
        href={href}
        className={cn(
          HOLDINGS_GRID,
          "hidden border-b border-border-soft py-3 text-sm transition-colors last:border-b-0 hover:bg-surface md:grid",
        )}
      >
        <TokenCell token={token} />
        <span className="text-right tabular-nums text-text-secondary">
          {formatBalance(balance)}
        </span>
        <span className="text-right tabular-nums text-muted">
          <PriceText priceEth={priceEth} />
        </span>
        <span className="text-right">
          <ValueCell valueEth={valueEth} value={value} />
        </span>
        <span className="text-right">
          <PnlRange range={unrealizedPnl} />
        </span>
      </Link>

      {/* <md — stacked card */}
      <Link
        href={href}
        className="flex flex-col gap-2.5 border-b border-border-soft py-3 last:border-b-0 md:hidden"
      >
        <span className="flex items-center gap-2.5">
          <TokenCell token={token} />
          <PnlRange range={unrealizedPnl} className="ml-auto text-sm" />
        </span>
        <div className="grid grid-cols-3 gap-3">
          <span className="flex flex-col gap-0.5">
            <MonoLabel size="2xs">Balance</MonoLabel>
            <span className="tabular-nums text-text-secondary">{formatBalance(balance)}</span>
          </span>
          <span className="flex flex-col gap-0.5">
            <MonoLabel size="2xs">Price</MonoLabel>
            <span className="tabular-nums text-muted">
              <PriceText priceEth={priceEth} />
            </span>
          </span>
          <span className="flex flex-col items-start gap-0.5">
            <MonoLabel size="2xs">Value</MonoLabel>
            <ValueCell valueEth={valueEth} value={value} align="left" />
          </span>
        </div>
      </Link>
    </>
  );
}
