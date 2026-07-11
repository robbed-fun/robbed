"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  getPortfolioActivity,
  getPortfolioCreated,
  getPortfolioHoldings,
  getPortfolioSummary,
} from "../api/portfolio";

/**
 * Portfolio TanStack Query hooks (v5; pattern mirrors the app's other TanStack
 * Query slices + `shared/lib/query-keys`, verified 2026-07-10). Keys are portfolio-local (the
 * shared `qk` factory is a fenced data-layer module) and namespaced by address
 * so switching wallets / viewing another address swaps caches cleanly.
 *
 * These are ADVISORY reads (api.md §3.4a): no WS channel patches them, so they
 * rely on `staleTime` + refetch rather than the live-prefix invalidation the
 * trade/token families use.
 */

export const portfolioKeys = {
  summary: (address: string) => ["portfolio", address.toLowerCase(), "summary"] as const,
  holdings: (address: string) => ["portfolio", address.toLowerCase(), "holdings"] as const,
  activity: (address: string) => ["portfolio", address.toLowerCase(), "activity"] as const,
  created: (address: string) => ["portfolio", address.toLowerCase(), "created"] as const,
};

const STALE_MS = 15_000;
const PAGE_SIZE = 50;

export function usePortfolioSummary(address: string | undefined) {
  return useQuery({
    queryKey: portfolioKeys.summary(address ?? ""),
    queryFn: ({ signal }) => getPortfolioSummary(address!, { signal }),
    enabled: !!address,
    staleTime: STALE_MS,
  });
}

export function usePortfolioHoldings(address: string | undefined) {
  return useInfiniteQuery({
    queryKey: portfolioKeys.holdings(address ?? ""),
    queryFn: ({ pageParam, signal }) =>
      getPortfolioHoldings(address!, { cursor: pageParam ?? undefined, limit: PAGE_SIZE }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!address,
    staleTime: STALE_MS,
  });
}

export function usePortfolioActivity(address: string | undefined) {
  return useInfiniteQuery({
    queryKey: portfolioKeys.activity(address ?? ""),
    queryFn: ({ pageParam, signal }) =>
      getPortfolioActivity(address!, { cursor: pageParam ?? undefined, limit: PAGE_SIZE }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!address,
    staleTime: STALE_MS,
  });
}

export function usePortfolioCreated(address: string | undefined) {
  return useInfiniteQuery({
    queryKey: portfolioKeys.created(address ?? ""),
    queryFn: ({ pageParam, signal }) =>
      getPortfolioCreated(address!, { cursor: pageParam ?? undefined, limit: PAGE_SIZE }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!address,
    staleTime: STALE_MS,
  });
}
