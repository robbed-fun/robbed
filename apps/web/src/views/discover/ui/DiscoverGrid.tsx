"use client";

import Link from "next/link";
import { useState } from "react";

import { TokenCard } from "@/entities/token";
import {
  Button,
  ErrorState,
  LootMascot,
  Skeleton,
  Tab,
  TabBar,
} from "@/shared/ui";

import { useDiscoverMetricsSync } from "../model/use-discover-metrics";
import {
  DEFAULT_GRID_FILTER,
  DEFAULT_GRID_SORT,
  type GridFilter,
  type GridSort,
  useTokenGrid,
} from "../model/use-token-grid";
import type { TokensPage } from "../model/metrics";

/**
 * Re-added Discover token grid (D-70) — the primary browse surface, rendered
 * BELOW the TRENDING carousel + event tape (both unchanged). Responsive 1/2/3
 * columns, SSR-hydrated from `GET /v1/tokens`, cursor-paginated ("load more",
 * page 48). View-local sort/filter tabs (grid URL-state stays retired — only
 * `?q=` is a URL param, D-50); rendering is server-authoritative (the client
 * paints the API order verbatim, never re-ranks).
 *
 * Live: `useDiscoverMetricsSync()` mounts ONCE here and patches the whole
 * `tokens` cache family by reference on `global:metrics` — a swap live-updates
 * every card's mcap / vol / Δ% / progress / status (and the tape registry).
 */

const SORT_TABS: { value: GridSort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "newest", label: "Newest" },
  { value: "mcap", label: "Mcap" },
  { value: "volume24h", label: "Vol 24h" },
];

const FILTER_TABS: { value: GridFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pregrad", label: "Pre-grad" },
  { value: "graduated", label: "Graduated" },
];

export function DiscoverGrid({ initial }: { initial?: TokensPage }) {
  const [sort, setSort] = useState<GridSort>(DEFAULT_GRID_SORT);
  const [filter, setFilter] = useState<GridFilter>(DEFAULT_GRID_FILTER);

  // The SSR page seeds ONLY the default control key; a non-default control
  // fetches client-side (so switching back to default never re-seeds a stale page).
  const isDefault = sort === DEFAULT_GRID_SORT && filter === DEFAULT_GRID_FILTER;

  useDiscoverMetricsSync();

  const {
    tokens,
    isPending,
    isError,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useTokenGrid({ sort, filter, initial: isDefault ? initial : undefined });

  const isFiltered = !isDefault;

  return (
    <section aria-label="Token grid" className="mt-3 px-3 md:mt-4 md:px-0">
      {/* view-local controls — sort tabs + filter tabs */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <TabBar aria-label="Sort tokens">
          {SORT_TABS.map((t) => (
            <Tab key={t.value} active={sort === t.value} onClick={() => setSort(t.value)}>
              {t.label}
            </Tab>
          ))}
        </TabBar>
        <TabBar aria-label="Filter tokens">
          {FILTER_TABS.map((t) => (
            <Tab key={t.value} active={filter === t.value} onClick={() => setFilter(t.value)}>
              {t.label}
            </Tab>
          ))}
        </TabBar>
      </div>

      {isError ? (
        <ErrorState
          title="Couldn't load tokens"
          description="The token feed is unavailable right now."
          onRetry={() => void refetch()}
        />
      ) : isPending ? (
        <GridSkeleton />
      ) : tokens.length === 0 ? (
        <EmptyGrid
          filtered={isFiltered}
          onReset={() => {
            setSort(DEFAULT_GRID_SORT);
            setFilter(DEFAULT_GRID_FILTER);
          }}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tokens.map((token) => (
              <TokenCard key={token.address} token={token} />
            ))}
          </div>
          {hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-48 w-full rounded-lg" />
      ))}
    </div>
  );
}

/**
 * Discovery empty state (mascot.md — the design places LOOT_ here). The mascot
 * over the ratified empty-state line, then a contextual action: reset the
 * view-local filters when they hid everything, else launch the first token.
 */
function EmptyGrid({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface px-4 py-12 text-center">
      <LootMascot size={72} label="" />
      <p className="text-sm text-muted-foreground">nothing here — Loot got to it first</p>
      {filtered ? (
        <Button variant="outline" size="sm" onClick={onReset}>
          Clear filters
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm">
          <Link href="/create">Launch the first token</Link>
        </Button>
      )}
    </div>
  );
}
