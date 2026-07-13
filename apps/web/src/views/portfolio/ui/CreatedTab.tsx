"use client";

import { TokenCard } from "@/entities/token";
import { usePortfolioCreated } from "@/entities/portfolio";
import { CreatorEarningsPanel } from "@/widgets/creator-earnings";
import { Button, EmptyState, ErrorState, Skeleton } from "@/shared/ui";

/**
 * CREATED tab (mockup "2c" / §5.4, §7): tokens whose on-chain `creator` == this
 * address. The endpoint returns the SAME `TokenCard` projection as `/tokens`, so
 * we reuse the `entities/token` card verbatim (anti-drift) in a responsive grid.
 * Listing-gated server-side (§8.4) — the client renders whatever the API lists.
 *
 * §7/§12.63: for the connected user's OWN created tokens the Creator earnings
 * widget (claim creator fees) sits above the grid — self-gated + vault-gated
 * inside the widget, so it renders nothing for a treasury-only deployment or when
 * viewing someone else.
 */
export function CreatedTab({ address, isSelf = false }: { address: string; isSelf?: boolean }) {
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    usePortfolioCreated(address);

  const tokens = data?.pages.flatMap((p) => p.tokens) ?? [];

  // Own-earnings claim widget above the grid (self-/vault-gated inside the widget).
  const earnings = <CreatorEarningsPanel address={address} isSelf={isSelf} />;

  if (isLoading) {
    return (
      <>
        {earnings}
        <div className="grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-2 md:px-6 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      </>
    );
  }

  if (isError && tokens.length === 0) {
    return (
      <>
        {earnings}
        <div className="px-4 py-6 md:px-6">
          <ErrorState
            title="Couldn't load created tokens"
            description="The indexer didn't respond. Try again."
            onRetry={() => void refetch()}
          />
        </div>
      </>
    );
  }

  if (tokens.length === 0) {
    return (
      <>
        {earnings}
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
      </>
    );
  }

  return (
    <>
      {earnings}
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
    </>
  );
}
