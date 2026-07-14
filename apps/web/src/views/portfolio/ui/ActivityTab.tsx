"use client";

import type { TradeRow } from "@robbed/shared";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import Link from "next/link";
import { Fragment } from "react";

import { ConfirmationBadge, displayStateForIndexed } from "@/entities/trade";
import { usePortfolioActivity } from "@/entities/portfolio";
import {
  Button,
  EmptyState,
  ErrorState,
  MonoLabel,
  PriceEth,
  RelativeTime,
  SideBadge,
  Skeleton,
} from "@/shared/ui";
import { formatEthFromWei, shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * ACTIVITY tab (mockup "2c" /) the per-address slice of the unified trade
 * feed — `GET /v1/portfolio/:address/activity` returns the shared `TradeRow`
 * shape (no parallel model), read through the `usePortfolioActivity` TanStack
 * Query hook. Columns adapt the token-detail trades table to a cross-token view:
 * AGE · SIDE · TOKEN · AMOUNT · PRICE, driven by a headless
 * `@tanstack/react-table` model (typed `ColumnDef<TradeRow>[]`; v8, docs-first
 * 2026-07-10) — the header + body rows iterate the SAME row model, and the cell
 * renderers reproduce the mockup spans verbatim (byte-identical DOM). Each row
 * carries its `ConfirmationBadge` so an as-yet-unposted trade is never shown as
 * final. This is a historical read, not the live optimistic feed — rows
 * arrive already reconciled to indexed truth.
 */

const ROW_GRID =
  "grid grid-cols-[56px_48px_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[64px_52px_minmax(0,1fr)_112px_84px]";

const activityColumns: ColumnDef<TradeRow>[] = [
  {
    id: "age",
    header: () => <MonoLabel size="2xs">Age</MonoLabel>,
    cell: ({ row }) => (
      <span className="tabular-nums text-faint">
        {row.original.blockTimestamp !== null ? (
          <RelativeTime unixSeconds={row.original.blockTimestamp} />
        ) : (
          "—"
        )}
      </span>
    ),
  },
  {
    id: "side",
    header: () => <MonoLabel size="2xs">Side</MonoLabel>,
    cell: ({ row }) => <SideBadge side={row.original.isBuy ? "buy" : "sell"} />,
  },
  {
    id: "token",
    header: () => <MonoLabel size="2xs">Token</MonoLabel>,
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-1.5">
        <Link
          href={`/t/${row.original.token}`}
          className="truncate tabular-nums text-muted transition-colors hover:text-text"
        >
          {shortAddress(row.original.token)}
        </Link>
        <ConfirmationBadge state={displayStateForIndexed(row.original.confirmationState)} />
      </span>
    ),
  },
  {
    id: "amount",
    header: () => (
      <MonoLabel size="2xs" className="text-right">
        Amount
      </MonoLabel>
    ),
    cell: ({ row }) => (
      <span className="text-right tabular-nums text-text-secondary">
        {formatEthFromWei(row.original.ethAmount)}
        <span className="ml-1 text-faint">ETH</span>
      </span>
    ),
  },
  {
    id: "price",
    header: () => (
      <MonoLabel size="2xs" className="hidden text-right sm:block">
        Price
      </MonoLabel>
    ),
    cell: ({ row }) => (
      <span className="hidden text-right text-muted sm:block">
        {/* Compact subscript for tiny curve prices, plain 2-sig decimal at normal
            magnitude — shared PriceEth (never e-notation, format-price.ts). */}
        <PriceEth value={row.original.priceEth} />
      </span>
    ),
  },
];

export function ActivityTab({ address }: { address: string }) {
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    usePortfolioActivity(address);

  const rows = data?.pages.flatMap((p) => p.activity) ?? [];

  const table = useReactTable({
    data: rows,
    columns: activityColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 px-4 py-4 md:px-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (isError && rows.length === 0) {
    return (
      <div className="px-4 py-6 md:px-6">
        <ErrorState
          title="Couldn't load activity"
          description="The indexer didn't respond. Try again."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState title="No trades yet" description="Buys and sells will appear here." />
      </div>
    );
  }

  const headerCells = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <div className="px-4 pb-6 md:px-6">
      <div className={cn(ROW_GRID, "border-b border-border py-2.5")}>
        {headerCells.map((header) => (
          <Fragment key={header.id}>
            {flexRender(header.column.columnDef.header, header.getContext())}
          </Fragment>
        ))}
      </div>

      <div className="flex flex-col">
        {table.getRowModel().rows.map((row) => (
          <div
            key={row.id}
            className={cn(ROW_GRID, "border-b border-border-soft py-[7px] text-xs last:border-b-0")}
          >
            {row.getVisibleCells().map((cell) => (
              <Fragment key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </Fragment>
            ))}
          </div>
        ))}
      </div>

      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
