"use client";

import {
  type TokenDetail,
  type TradeRow,
  type WsTradeData,
  tokenTrades,
} from "@robbed/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Fragment, useMemo } from "react";

import { ConfirmationBadge, useOptimisticTradesContext } from "@/entities/trade";
import {
  AddressLink,
  EthAmount,
  MonoLabel,
  MonoText,
  RelativeTime,
  SideBadge,
} from "@/shared/ui";
import { getTrades } from "@/shared/api";
import { qk } from "@/shared/lib/query-keys";
import { useWsChannel } from "@/shared/lib/ws";
import { shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

import { type FeedRow, buildFeedRows, prependTrade } from "../model/merge";

/**
 * Live trade feed (§5.2/§2.1) — ROBBED_ terminal TRADES TABLE (docs/Robbed.html
 * "2a": AGE · SIDE · TRADER · AMOUNT · PRICE). Now driven by a headless
 * `@tanstack/react-table` model (v8, docs-first tanstack.com/table 2026-07-10):
 * typed `ColumnDef<FeedRow>[]` supply the header + cell renderers, and BOTH the
 * header row and each body row iterate the same table row model. The library is
 * headless — the mockup's CSS-grid container/classes are preserved verbatim
 * (`flexRender` emits the exact same cell spans as before → byte-identical DOM,
 * zero visual regression).
 *
 * DATA LAYER (§4, web.md §2.5): the indexed feed is a TanStack Query read
 * (`qk.trades`) seeded by the SSR `GET /trades` page (`initialData`, no
 * double-fetch flash) and LIVE-patched by writing WS `trade` messages into the
 * query cache with `setQueryData`. The user's own optimistic trades are merged
 * from the shared store — a buy placed in the widget appears here instantly as
 * soft-confirmed and reconciles in place. Every row shows the `ConfirmationBadge`;
 * a soft-confirmed row never renders as unqualified-final. On WS reconnect the
 * `trades` family is invalidated (LIVE_QUERY_PREFIXES) → resumable indexed truth.
 */

type TradesPage = { trades: TradeRow[]; nextCursor: string | null };

/** Column model (AGE · SIDE · TRADER · AMOUNT · PRICE). Cells reproduce the exact
 *  mockup spans so `flexRender` output is byte-identical to the pre-refactor DOM. */
const tradeColumns: ColumnDef<FeedRow>[] = [
  {
    id: "age",
    header: () => <MonoLabel size="2xs">Age</MonoLabel>,
    cell: ({ row }) => <AgeCell row={row.original} />,
  },
  {
    id: "side",
    header: () => <MonoLabel size="2xs">Side</MonoLabel>,
    cell: ({ row }) => <SideBadge side={row.original.isBuy ? "buy" : "sell"} />,
  },
  {
    id: "trader",
    header: () => <MonoLabel size="2xs">Trader</MonoLabel>,
    cell: ({ row }) => <TraderCell row={row.original} />,
  },
  {
    id: "amount",
    header: () => (
      <MonoLabel size="2xs" className="text-right">
        Amount
      </MonoLabel>
    ),
    cell: ({ row }) => <AmountCell row={row.original} />,
  },
  {
    id: "price",
    header: () => (
      <MonoLabel size="2xs" className="hidden text-right sm:block">
        Price
      </MonoLabel>
    ),
    cell: ({ row }) => <PriceCell row={row.original} />,
  },
];

export function TradeFeed({
  token,
  initialTrades = [],
}: {
  token: TokenDetail;
  initialTrades?: TradeRow[];
}) {
  const queryClient = useQueryClient();
  const optimistic = useOptimisticTradesContext();
  const queryKey = qk.trades(token.address);

  // Indexed feed as a TanStack Query read, SSR-seeded so there is no double-fetch
  // flash; WS trade messages patch this same cache below.
  const query = useQuery<TradesPage>({
    queryKey,
    queryFn: ({ signal }) => getTrades(token.address, { limit: 50 }, { signal }),
    initialData: initialTrades ? { trades: initialTrades, nextCursor: null } : undefined,
    staleTime: 5_000,
  });
  const indexed = query.data?.trades ?? [];

  useWsChannel(tokenTrades(token.address), (msg) => {
    if (msg.type !== "trade") return;
    queryClient.setQueryData<TradesPage>(queryKey, (old) => ({
      trades: prependTrade(old?.trades ?? [], wsTradeToRow(msg.data)),
      nextCursor: old?.nextCursor ?? null,
    }));
    // Reconcile any matching optimistic row to indexed truth (§4).
    optimistic.applyWsTrade(msg.data);
  });

  const rows = useMemo(
    () =>
      buildFeedRows({
        optimistic: optimistic.trades,
        indexed,
        creator: token.creator.address,
      }),
    [optimistic.trades, indexed, token.creator.address],
  );

  const table = useReactTable({
    data: rows,
    columns: tradeColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.key,
  });

  const headerCells = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    // FLAT region (fidelity audit fix 1): no Card — the mockup tape sits under
    // the chart inside the same column, delimited by a single `border-t` and
    // 12px top padding (template 2a line 382).
    <div className="flex flex-col border-t border-border pt-3">
      {/* Column header — mockup grid: 70px 70px 1fr 130px 140px, gap 14px */}
      <div className="grid grid-cols-[52px_52px_1fr_auto] items-center gap-3.5 border-b border-border-soft pb-2 sm:grid-cols-[70px_70px_minmax(0,1fr)_130px_140px]">
        {headerCells.map((header) => (
          <Fragment key={header.id}>
            {flexRender(header.column.columnDef.header, header.getContext())}
          </Fragment>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">No trades yet — be the first.</p>
      ) : (
        <div className="flex flex-col">
          {table.getRowModel().rows.map((row) => (
            <div
              key={row.id}
              className={cn(
                // Data rows: 12px (`text-sm`), mockup grid 70/70/1fr/130/140 gap 14px.
                "grid grid-cols-[52px_52px_1fr_auto] items-center gap-3.5 border-b border-border-soft py-[7px] text-sm last:border-b-0 sm:grid-cols-[70px_70px_minmax(0,1fr)_130px_140px]",
                row.original.isOptimistic && "opacity-90",
                row.original.justUpdated && "animate-pulse",
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <Fragment key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </Fragment>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgeCell({ row }: { row: FeedRow }) {
  const ageUnix =
    row.blockTimestamp ??
    (row.submittedAtMs !== null ? Math.floor(row.submittedAtMs / 1000) : null);
  return (
    <span className="text-faint tabular-nums">
      {ageUnix !== null ? <RelativeTime unixSeconds={ageUnix} /> : "—"}
    </span>
  );
}

function TraderCell({ row }: { row: FeedRow }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {row.txHash ? (
        <AddressLink
          address={row.txHash}
          kind="tx"
          label={shortAddress(row.trader)}
          className="text-muted"
        />
      ) : (
        <MonoText tone="muted" className="truncate">
          {shortAddress(row.trader)}
        </MonoText>
      )}
      {row.isCreator && (
        <MonoLabel tone="green" size="2xs">
          dev
        </MonoLabel>
      )}
      <ConfirmationBadge state={row.displayState} awaitingIndex={row.awaitingIndex} />
    </span>
  );
}

function AmountCell({ row }: { row: FeedRow }) {
  // Shared EthAmount: 4-dec zero-padded and the unit INHERITS the row color
  // (mockup "0.4200 ETH" is one color) — no local unit-color override.
  return (
    <span className="text-right text-text-secondary">
      <EthAmount wei={row.ethAmount} />
    </span>
  );
}

function PriceCell({ row }: { row: FeedRow }) {
  return (
    <span className="hidden text-right tabular-nums text-muted sm:block">
      {row.priceEth === null ? "—" : row.priceEth.toPrecision(2)}
    </span>
  );
}

function wsTradeToRow(d: WsTradeData): TradeRow {
  return {
    id: `${d.txHash}-${d.logIndex}`,
    token: d.token,
    trader: d.trader,
    venue: d.venue,
    isBuy: d.isBuy,
    ethAmount: d.ethAmount,
    tokenAmount: d.tokenAmount,
    feeEth: d.feeEth,
    priceEth: d.priceEth,
    blockNumber: d.blockNumber,
    blockTimestamp: d.blockTimestamp,
    txHash: d.txHash,
    logIndex: d.logIndex,
    confirmationState: d.confirmationState,
  };
}
