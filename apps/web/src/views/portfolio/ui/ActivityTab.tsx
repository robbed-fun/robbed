"use client";

import type { TradeRow } from "@robbed/shared";
import Link from "next/link";

import { ConfirmationBadge, displayStateForIndexed } from "@/entities/trade";
import { usePortfolioActivity } from "@/entities/portfolio";
import {
  Button,
  EmptyState,
  ErrorState,
  MonoLabel,
  RelativeTime,
  SideBadge,
  Skeleton,
} from "@/shared/ui";
import { formatEthFromWei, shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * ACTIVITY tab (mockup "2c" / §5.4): the per-address slice of the unified trade
 * feed — `GET /v1/portfolio/:address/activity` returns the shared `TradeRow`
 * shape (no parallel model). Columns adapt the token-detail trades table to a
 * cross-token view: AGE · SIDE · TOKEN · AMOUNT · PRICE, each row carrying its
 * `ConfirmationBadge` so an as-yet-unposted trade is never shown as final
 * (§2.1). This is a historical read, not the live optimistic feed — rows arrive
 * already reconciled to indexed truth.
 */

const ROW_GRID =
  "grid grid-cols-[56px_48px_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[64px_52px_minmax(0,1fr)_112px_84px]";

export function ActivityTab({ address }: { address: string }) {
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    usePortfolioActivity(address);

  const rows = data?.pages.flatMap((p) => p.activity) ?? [];

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

  return (
    <div className="px-4 pb-6 md:px-6">
      <div className={cn(ROW_GRID, "border-b border-border py-2.5")}>
        <MonoLabel size="2xs">Age</MonoLabel>
        <MonoLabel size="2xs">Side</MonoLabel>
        <MonoLabel size="2xs">Token</MonoLabel>
        <MonoLabel size="2xs" className="text-right">
          Amount
        </MonoLabel>
        <MonoLabel size="2xs" className="hidden text-right sm:block">
          Price
        </MonoLabel>
      </div>

      <div className="flex flex-col">
        {rows.map((row) => (
          <ActivityRow key={row.id} row={row} />
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

function ActivityRow({ row }: { row: TradeRow }) {
  return (
    <div className={cn(ROW_GRID, "border-b border-border-soft py-[7px] text-xs last:border-b-0")}>
      <span className="tabular-nums text-faint">
        {row.blockTimestamp !== null ? (
          <RelativeTime unixSeconds={row.blockTimestamp} />
        ) : (
          "—"
        )}
      </span>

      <SideBadge side={row.isBuy ? "buy" : "sell"} />

      <span className="flex min-w-0 items-center gap-1.5">
        <Link
          href={`/t/${row.token}`}
          className="truncate tabular-nums text-muted transition-colors hover:text-text"
        >
          {shortAddress(row.token)}
        </Link>
        <ConfirmationBadge state={displayStateForIndexed(row.confirmationState)} />
      </span>

      <span className="text-right tabular-nums text-text-secondary">
        {formatEthFromWei(row.ethAmount)}
        <span className="ml-1 text-faint">ETH</span>
      </span>

      <span className="hidden text-right tabular-nums text-muted sm:block">
        {row.priceEth === null ? "—" : row.priceEth.toPrecision(2)}
      </span>
    </div>
  );
}
