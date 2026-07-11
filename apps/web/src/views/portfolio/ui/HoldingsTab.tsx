"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Fragment } from "react";

import {
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
} from "@/shared/ui";
import {
  HOLDINGS_GRID,
  HoldingRow,
  holdingColumns,
  usePortfolioHoldings,
} from "@/entities/portfolio";
import { cn } from "@/shared/lib/utils";

/**
 * HOLDINGS tab (mockup "2c"): the TOKEN / BALANCE / PRICE / VALUE / PNL table,
 * read through the `usePortfolioHoldings` TanStack Query hook and rendered from a
 * headless `@tanstack/react-table` row model (typed `holdingColumns`; v8,
 * docs-first 2026-07-10). The column header (md+) is rendered from the SAME table
 * model as every `HoldingRow`, so they stay column-aligned by construction; on
 * mobile the header is hidden and rows become stacked cards. VALUE is sortable
 * (getSortedRowModel) — default order stays the API's balance-DESC cursor.
 */
export function HoldingsTab({ address }: { address: string }) {
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    usePortfolioHoldings(address);

  const holdings = data?.pages.flatMap((p) => p.holdings) ?? [];

  const table = useReactTable({
    data: holdings,
    columns: holdingColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.token.address,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 px-4 py-4 md:px-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (isError && holdings.length === 0) {
    return (
      <div className="px-4 py-6 md:px-6">
        <ErrorState
          title="Couldn't load holdings"
          description="The indexer didn't respond. Try again."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (holdings.length === 0) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          title="No holdings yet"
          description="Buy a token and it shows up here."
          action={
            <Button asChild size="sm" variant="outline" className="mt-1">
              <a href="/">Discover tokens</a>
            </Button>
          }
        />
      </div>
    );
  }

  const headerCells = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    // Mockup container padding `4px 24px 24px` (template.html:516).
    <div className="px-4 pt-1 pb-6 md:px-6">
      {/* Column header — md+ only (mobile rows are self-labelled cards). */}
      <div
        className={cn(
          HOLDINGS_GRID,
          "hidden border-b border-border py-2.5 md:grid",
        )}
      >
        {headerCells.map((header) => (
          <Fragment key={header.id}>
            {flexRender(header.column.columnDef.header, header.getContext())}
          </Fragment>
        ))}
      </div>

      <div className="flex flex-col">
        {table.getRowModel().rows.map((row) => (
          <HoldingRow key={row.id} row={row} />
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
