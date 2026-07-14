"use client";

import {
  type Paginated,
  type TokenDetail,
  type TradeRow,
  type TradeSortField,
  type WsTradeData,
  tokenTrades,
} from "@robbed/shared";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, HeaderContext } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";

import { ConfirmationBadge, useOptimisticTradesContext } from "@/entities/trade";
import {
  AddressLink,
  DataTable,
  EthAmount,
  MonoLabel,
  MonoText,
  RelativeTime,
  SideBadge,
  SortHeader,
} from "@/shared/ui";
import { getTrades } from "@/shared/api";
import { TRADES_PAGE_SIZE } from "@/shared/config/tables";
import { qk } from "@/shared/lib/query-keys";
import {
  type SortState,
  type TableSortMeta,
  isDefaultSort,
  nextSort,
  useCursorStack,
} from "@/shared/lib/table";
import { useWsChannel } from "@/shared/lib/ws";
import { formatPriceEth, shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

import { type FeedRow, buildFeedRows, prependTrade } from "../model/merge";

/**
 * Live trade feed — ROBBED_ terminal TRADES TABLE (AGE · SIDE ·
 * TRADER · AMOUNT · PRICE), now the common `DataTable` with SERVER-SIDE
 * sort + keyset pagination. Column headers dispatch `?sort=&dir=` and the
 * browser NEVER re-ranks (`manualSorting`); the opaque forward cursor is a
 * `useCursorStack`.
 *
 * LIVE HEAD vs REST SNAPSHOT : the DEFAULT window (age DESC, page 1) is
 * the WS-live, SSR-seeded view — WS `trade` messages prepend into it and the
 * user's optimistic trades merge + reconcile in place (unchanged). Sorting or
 * paging away makes it a plain REST snapshot (no WS prepend, no optimistic merge)
 * — "sort/paginate beyond the live head is a REST query".
 *
 * : the soft-confirmed chip is gone — a fresh (soft-confirmed) row shows NO
 * settlement badge; `ConfirmationBadge` surfaces only once it upgrades to
 * posted-to-L1 / finalized as the watermark advances.
 */

/** Default order = age DESC (newest first) — the WS-live, SSR-seeded window. */
const DEFAULT_TRADE_SORT: SortState<TradeSortField> = { field: "age", dir: "desc" };

const metaOf = (ctx: HeaderContext<FeedRow, unknown>): TableSortMeta<string> =>
  (ctx.table.options.meta ?? {}) as TableSortMeta<string>;

/** Shared grid for the header + every row (byte-identical alignment). */
const GRID =
  "grid grid-cols-[52px_52px_1fr_auto] items-center gap-3.5 sm:grid-cols-[70px_70px_minmax(0,1fr)_130px_140px]";

const tradeColumns: ColumnDef<FeedRow>[] = [
  {
    id: "age",
    header: (ctx) => <SortHeader label="Age" field="age" meta={metaOf(ctx)} />,
    cell: ({ row }) => <AgeCell row={row.original} />,
  },
  {
    id: "side",
    header: (ctx) => <SortHeader label="Side" field="side" meta={metaOf(ctx)} />,
    cell: ({ row }) => <SideBadge side={row.original.isBuy ? "buy" : "sell"} />,
  },
  {
    id: "trader",
    header: (ctx) => <SortHeader label="Trader" field="trader" meta={metaOf(ctx)} />,
    cell: ({ row }) => <TraderCell row={row.original} />,
  },
  {
    id: "amount",
    header: (ctx) => (
      <SortHeader label="Amount" field="amount" align="right" meta={metaOf(ctx)} />
    ),
    cell: ({ row }) => <AmountCell row={row.original} />,
  },
  {
    id: "price",
    header: (ctx) => (
      <SortHeader
        label="Price"
        field="price"
        align="right"
        meta={metaOf(ctx)}
        className="hidden sm:inline-flex"
      />
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
  const [sort, setSort] = useState<SortState<TradeSortField>>(DEFAULT_TRADE_SORT);
  const cursors = useCursorStack();
  const isDefaultView =
    isDefaultSort(sort, DEFAULT_TRADE_SORT) && cursors.cursor === null;

  // Bare key = WS-live default head; params key = a REST snapshot.
  const canonicalKey = qk.trades(token.address);
  const queryKey = isDefaultView
    ? canonicalKey
    : qk.trades(token.address, {
        sort: sort.field,
        dir: sort.dir,
        cursor: cursors.cursor,
      });

  const query = useQuery<Paginated<TradeRow>>({
    queryKey,
    queryFn: ({ signal }) =>
      getTrades(
        token.address,
        {
          sort: sort.field,
          dir: sort.dir,
          cursor: cursors.cursor ?? undefined,
          limit: TRADES_PAGE_SIZE,
        },
        { signal },
      ),
    initialData:
      isDefaultView && initialTrades.length
        ? { items: initialTrades, nextCursor: null }
        : undefined,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
  const indexed = query.data?.items ?? [];

  useWsChannel(tokenTrades(token.address), (msg) => {
    if (msg.type !== "trade") return;
    // Patch ONLY the live default head; a sorted/paged REST snapshot is untouched.
    queryClient.setQueryData<Paginated<TradeRow>>(canonicalKey, (old) => ({
      items: prependTrade(old?.items ?? [], wsTradeToRow(msg.data), TRADES_PAGE_SIZE),
      nextCursor: old?.nextCursor ?? null,
    }));
    // Reconcile any matching optimistic row to indexed truth regardless of view.
    optimistic.applyWsTrade(msg.data);
  });

  const rows = useMemo(
    () =>
      buildFeedRows({
        // Optimistic rows merge only into the live head.
        optimistic: isDefaultView ? optimistic.trades : [],
        indexed,
        creator: token.creator.address,
      }),
    [isDefaultView, optimistic.trades, indexed, token.creator.address],
  );

  const onSort = useCallback(
    (field: string) => {
      setSort((cur) =>
        nextSort(cur, field as TradeSortField, field === "trader" ? "asc" : "desc"),
      );
      cursors.reset();
    },
    [cursors],
  );

  const meta: TableSortMeta<string> = { sort, onSort };

  const pagination = {
    hasPrev: cursors.hasPrev,
    hasNext: query.data?.nextCursor != null,
    onPrev: cursors.prev,
    onNext: () => {
      const nc = query.data?.nextCursor;
      if (nc) cursors.next(nc);
    },
    isFetching: query.isFetching,
    pageIndex: cursors.pageIndex,
  };

  return (
    // FLAT region (fidelity audit fix 1): the DataTable's TableLabel titles the
    // feed; the mockup grid tracks are preserved on the header + each row.
    <div className="border-t border-border pt-3">
      <DataTable<FeedRow>
        data={rows}
        columns={tradeColumns}
        getRowId={(row) => row.key}
        aria-label="Trades"
        meta={meta}
        tableLabel={{
          title: <MonoLabel size="2xs" className="text-text-tertiary">Trades</MonoLabel>,
        }}
        renderHeader={(cells) => (
          <div className={`${GRID} border-b border-border-soft pb-2`}>{cells}</div>
        )}
        renderRow={({ row, cells }) => (
          <div
            className={cn(
              `${GRID} border-b border-border-soft py-[7px] text-sm last:border-b-0`,
              row.original.isOptimistic && "opacity-90",
              row.original.justUpdated && "animate-pulse",
            )}
          >
            {cells}
          </div>
        )}
        empty={
          <p className="py-6 text-center text-xs text-muted">No trades yet — be the first.</p>
        }
        pagination={pagination}
      />
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
  return (
    <span className="text-right text-text-secondary">
      <EthAmount wei={row.ethAmount} />
    </span>
  );
}

function PriceCell({ row }: { row: FeedRow }) {
  return (
    <span className="hidden text-right tabular-nums text-muted sm:block">
      {formatPriceEth(row.priceEth)}
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
