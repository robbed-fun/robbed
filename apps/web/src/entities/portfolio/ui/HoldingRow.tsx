import type { PortfolioHolding } from "@robbed/shared";
import {
  type ColumnDef,
  type Row,
  type SortingFn,
  flexRender,
} from "@tanstack/react-table";
import Link from "next/link";
import { Fragment } from "react";

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
 * One HOLDINGS row (mockup "2c": TOKEN / BALANCE / PRICE / VALUE / PNL). Driven
 * by a headless `@tanstack/react-table` row model (v8, docs-first
 * tanstack.com/table 2026-07-10): `HoldingRow` receives the table `Row` and its
 * two layouts BOTH derive from it —
 *   - md+ : the exact mockup grid (`HOLDINGS_GRID`, reused by the table header),
 *           rendered by iterating `row.getVisibleCells()` + `flexRender` so the
 *           output is byte-identical to the pre-refactor DOM.
 *   - <md : a stacked card built from `row.original`, reusing the SAME cell
 *           components (per the redesign's "table → cards/scroll" mobile rule).
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
      <span className="truncate text-text">{token.name}</span>
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

/** Value sort — ETH notional (wei decimal string); unpriceable holdings sort last. */
const byValueEth: SortingFn<PortfolioHolding> = (a, b) => {
  const av = a.original.valueEth;
  const bv = b.original.valueEth;
  if (av === null && bv === null) return 0;
  if (av === null) return -1;
  if (bv === null) return 1;
  const d = BigInt(av) - BigInt(bv);
  return d > 0n ? 1 : d < 0n ? -1 : 0;
};

/**
 * Typed column model (TOKEN / BALANCE / PRICE / VALUE / PNL). Cells reproduce the
 * mockup's md-grid spans verbatim; the header is shared with `HoldingsTab`. VALUE
 * is sortable (spec-directed "holdings by value") — default order stays the
 * API's (balance-DESC cursor), so with no sort applied the DOM is unchanged.
 */
export const holdingColumns: ColumnDef<PortfolioHolding>[] = [
  {
    id: "token",
    header: () => <MonoLabel size="2xs">Token</MonoLabel>,
    cell: ({ row }) => <TokenCell token={row.original.token} />,
  },
  {
    id: "balance",
    header: () => (
      <MonoLabel size="2xs" className="text-right">
        Balance
      </MonoLabel>
    ),
    cell: ({ row }) => (
      <span className="text-right tabular-nums text-text-secondary">
        {formatBalance(row.original.balance)}
      </span>
    ),
  },
  {
    id: "price",
    header: () => (
      <MonoLabel size="2xs" className="text-right">
        Price
      </MonoLabel>
    ),
    cell: ({ row }) => (
      <span className="text-right tabular-nums text-muted">
        <PriceText priceEth={row.original.priceEth} />
      </span>
    ),
  },
  {
    id: "value",
    header: () => (
      <MonoLabel size="2xs" className="text-right">
        Value
      </MonoLabel>
    ),
    cell: ({ row }) => (
      <span className="text-right">
        <ValueCell valueEth={row.original.valueEth} value={row.original.value} />
      </span>
    ),
    enableSorting: true,
    sortingFn: byValueEth,
  },
  {
    id: "pnl",
    header: () => (
      <MonoLabel size="2xs" className="text-right">
        PnL
      </MonoLabel>
    ),
    cell: ({ row }) => (
      <span className="text-right">
        <PnlRange range={row.original.unrealizedPnl} />
      </span>
    ),
  },
];

export function HoldingRow({ row }: { row: Row<PortfolioHolding> }) {
  const { token, balance, priceEth, valueEth, value, unrealizedPnl } = row.original;
  const href = `/t/${token.address}`;

  return (
    <>
      {/* md+ — mockup grid row, iterated from the table row model */}
      <Link
        href={href}
        className={cn(
          HOLDINGS_GRID,
          "hidden border-b border-border-soft py-3 text-sm transition-colors last:border-b-0 hover:bg-surface md:grid",
        )}
      >
        {row.getVisibleCells().map((cell) => (
          <Fragment key={cell.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </Fragment>
        ))}
      </Link>

      {/* <md — stacked card, same cells from row.original */}
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
