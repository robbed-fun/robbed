"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { getTokens } from "@/shared/api";
import { qk } from "@/shared/lib/query-keys";

import type { TokensPage } from "./metrics";

/**
 * View-local control vocabulary (D-70). A deliberate SUBSET of the API's
 * `tokenSortSchema` ({…,"progress"}) / `tokenFilterSchema` — the tabs the grid
 * offers, kept value-identical to the contract so `getTokens` passes them
 * straight through. NOT a redeclaration of the API enum: these are the local tab
 * options, and grid URL-state stays retired (only `?q=` is a URL param — D-50).
 */
export type GridSort = "trending" | "newest" | "mcap" | "volume24h";
export type GridFilter = "all" | "pregrad" | "graduated";

/** Grid page size (D-70 "load more", page 48). */
export const GRID_PAGE_SIZE = 48;

/** View-local default control state (D-70): sort=trending, filter=all. */
export const DEFAULT_GRID_SORT: GridSort = "trending";
export const DEFAULT_GRID_FILTER: GridFilter = "all";

/**
 * The re-added Discover token grid data source (D-70). A cursor-paginated
 * `useInfiniteQuery` over `GET /v1/tokens?sort=&filter=` — SERVER-AUTHORITATIVE:
 * the client paints the API's returned order verbatim and never re-ranks.
 *
 * Docs-first (TanStack Query v5, verified 2026-07-14): `initialPageParam` is
 * REQUIRED and `getNextPageParam(lastPage)` returns the next cursor (or
 * undefined to stop). The default sort/filter query is SSR-seeded via
 * `initialData` (`{ pages, pageParams }` shape) so it paints with content and
 * never double-fetches; a non-default control fetches client-side on first use.
 * The key lives in the shared `tokens` family so `global:metrics` patches
 * (`useDiscoverMetricsSync`) and the reconnect invalidation both reach it.
 */
export function useTokenGrid({
  sort,
  filter,
  initial,
}: {
  sort: GridSort;
  filter: GridFilter;
  /** SSR first page — seeds ONLY the default sort/filter key (else undefined). */
  initial?: TokensPage;
}) {
  const query = useInfiniteQuery({
    queryKey: qk.tokens({ scope: "discover-grid", sort, filter }),
    queryFn: ({ pageParam }) =>
      getTokens({
        sort,
        filter,
        cursor: pageParam ?? undefined,
        limit: GRID_PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: TokensPage) => lastPage.nextCursor ?? undefined,
    initialData: initial ? { pages: [initial], pageParams: [undefined] } : undefined,
    staleTime: 5_000,
  });

  const tokens = query.data?.pages.flatMap((p) => p.tokens) ?? [];

  return {
    tokens,
    isPending: query.isPending,
    isError: query.isError,
    refetch: query.refetch,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  };
}
