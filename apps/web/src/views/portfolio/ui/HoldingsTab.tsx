"use client";

import {
  Button,
  EmptyState,
  ErrorState,
  MonoLabel,
  Skeleton,
} from "@/shared/ui";
import {
  HOLDINGS_GRID,
  HoldingRow,
  usePortfolioHoldings,
} from "@/entities/portfolio";
import { cn } from "@/shared/lib/utils";

/**
 * HOLDINGS tab (mockup "2c"): the TOKEN / BALANCE / PRICE / VALUE / PNL table.
 * The column header (md+) reuses `HOLDINGS_GRID` so it stays aligned with every
 * `HoldingRow`; on mobile the header is hidden and rows become stacked cards.
 */
export function HoldingsTab({ address }: { address: string }) {
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    usePortfolioHoldings(address);

  const holdings = data?.pages.flatMap((p) => p.holdings) ?? [];

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

  return (
    <div className="px-4 pb-6 md:px-6">
      {/* Column header — md+ only (mobile rows are self-labelled cards). */}
      <div
        className={cn(
          HOLDINGS_GRID,
          "hidden border-b border-border py-2.5 md:grid",
        )}
      >
        <MonoLabel size="2xs">Token</MonoLabel>
        <MonoLabel size="2xs" className="text-right">
          Balance
        </MonoLabel>
        <MonoLabel size="2xs" className="text-right">
          Price
        </MonoLabel>
        <MonoLabel size="2xs" className="text-right">
          Value
        </MonoLabel>
        <MonoLabel size="2xs" className="text-right">
          PnL
        </MonoLabel>
      </div>

      <div className="flex flex-col">
        {holdings.map((h) => (
          <HoldingRow key={h.token.address} holding={h} />
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
