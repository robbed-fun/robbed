"use client";

import { TokenCard } from "@/entities/token";
import { usePortfolioCreated } from "@/entities/portfolio";
import { Button, EmptyState, ErrorState, Skeleton } from "@/shared/ui";

/**
 * CREATED tab (mockup "2c" / §5.4, §7): tokens whose on-chain `creator` == this
 * address. The endpoint returns the SAME `TokenCard` projection as `/tokens`, so
 * we reuse the `entities/token` card verbatim (anti-drift) in a responsive grid.
 * Listing-gated server-side (§8.4) — the client renders whatever the API lists.
 */
export function CreatedTab({ address }: { address: string }) {
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    usePortfolioCreated(address);

  const tokens = data?.pages.flatMap((p) => p.tokens) ?? [];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-2 md:px-6 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36 w-full" />
        ))}
      </div>
    );
  }

  if (isError && tokens.length === 0) {
    return (
      <div className="px-4 py-6 md:px-6">
        <ErrorState
          title="Couldn't load created tokens"
          description="The indexer didn't respond. Try again."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          title="No tokens created"
          description="Launch a token and it shows up here."
          action={
            <Button asChild size="sm" variant="outline" className="mt-1">
              <a href="/create">Launch a token</a>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="px-4 pb-6 md:px-6">
      <div className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {tokens.map((token) => (
          <TokenCard key={token.address} token={token} />
        ))}
      </div>

      {hasNextPage && (
        <div className="flex justify-center pt-2">
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
