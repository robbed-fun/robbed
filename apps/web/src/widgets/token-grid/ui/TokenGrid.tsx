"use client";

import type { WsMessage } from "@robbed/shared";
import { GLOBAL_LAUNCHES, GLOBAL_TRADES } from "@robbed/shared";
import {
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { type TokensPage, patchTradePrice } from "../model/live";
import { TokenGridSkeleton } from "./TokenGridSkeleton";
import { TokenCard, type TokenFilter, type TokenSort } from "@/entities/token";
import { Button, EmptyState, ErrorState } from "@/shared/ui";
import { getTokens } from "@/shared/api";
import { qk } from "@/shared/lib/query-keys";
import { useWsChannel } from "@/shared/lib/ws";

/**
 * Token grid (§5.1) — cursor-paginated `GET /v1/tokens?sort=&filter=`, seeded
 * with the server-rendered first page (no double-fetch flash), infinite-scrolled,
 * and LIVE-patched over WS.
 *
 * LIVE-PATCH DECISION (hoodpad-frontend; basis + gap recorded):
 * - On `global:trades` for a visible token we patch the card's `priceEth`
 *   straight from the indexer's trade payload (an indexer-computed value — NOT
 *   client price math, §2) and flash the card. We deliberately do NOT recompute
 *   mcap / progress / 24h Δ% from a trade: those are indexer AGGREGATES and the
 *   `wsTradeDataSchema` payload does not carry them, so deriving them client-side
 *   would be forbidden market math (§2). Aggregates refresh via TanStack Query's
 *   staleTime (5s) + the reconnect/seq-gap invalidation. → GAP reported: to
 *   push live mcap/progress/Δ% per web.md §3.1, the WS `trade` payload (or a
 *   token-summary message) must include the recomputed card aggregates.
 * - On `global:launches` we do NOT fabricate a card from `wsLaunchDataSchema`
 *   (it lacks mcap/progress/status/moderation) — we surface a "N new" pill; the
 *   user pulls fresh, complete cards via a scoped invalidation (never invented
 *   fields). New launches are also shown fully in the LaunchTicker.
 */

const PAGE_SIZE = 48;
const FLASH_MS = 1000;

export function TokenGrid({
  sort,
  filter,
  initialData,
}: {
  sort: TokenSort;
  filter: TokenFilter;
  /** SSR first page; undefined when the server fetch failed (client refetches). */
  initialData?: TokensPage;
}) {
  const queryClient = useQueryClient();
  const queryKey = qk.tokens({ sort, filter });

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      getTokens(
        { sort, filter, cursor: pageParam ?? undefined, limit: PAGE_SIZE },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: TokensPage) => last.nextCursor ?? undefined,
    initialData: initialData
      ? { pages: [initialData], pageParams: [undefined] }
      : undefined,
  });

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = query;

  const tokens = data?.pages.flatMap((p) => p.tokens) ?? [];

  // ── New-launch "N new" pill (never fabricates cards) ──────────────────────
  const [pendingNew, setPendingNew] = useState(0);

  // ── Trade flash ring, cleared after ~1s ───────────────────────────────────
  const [flashing, setFlashing] = useState<Set<string>>(() => new Set());
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const flash = useCallback((address: string) => {
    setFlashing((prev) => {
      const next = new Set(prev);
      next.add(address);
      return next;
    });
    const timers = flashTimers.current;
    const existing = timers.get(address);
    if (existing) clearTimeout(existing);
    timers.set(
      address,
      setTimeout(() => {
        setFlashing((prev) => {
          const next = new Set(prev);
          next.delete(address);
          return next;
        });
        timers.delete(address);
      }, FLASH_MS),
    );
  }, []);
  useEffect(() => {
    const timers = flashTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const onTrade = useCallback(
    (msg: WsMessage) => {
      if (msg.type !== "trade") return;
      const { token, priceEth } = msg.data;
      queryClient.setQueryData<InfiniteData<TokensPage>>(queryKey, (old) =>
        patchTradePrice(old, token, priceEth),
      );
      // Flash whether or not the card is currently in cache (best-effort cue).
      flash(token);
    },
    [queryClient, queryKey, flash],
  );

  const onLaunch = useCallback((msg: WsMessage) => {
    if (msg.type === "launch") setPendingNew((n) => n + 1);
  }, []);

  useWsChannel(GLOBAL_TRADES, onTrade);
  useWsChannel(GLOBAL_LAUNCHES, onLaunch);

  function refreshNew() {
    setPendingNew(0);
    void queryClient.invalidateQueries({ queryKey });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── Infinite scroll sentinel ──────────────────────────────────────────────
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading) return <TokenGridSkeleton count={12} />;

  if (isError && tokens.length === 0) {
    return (
      <ErrorState
        title="Couldn't load tokens"
        description="The indexer didn't respond. Try again."
        onRetry={() => void refetch()}
      />
    );
  }

  if (tokens.length === 0) {
    return filter === "all" ? (
      <EmptyState
        title="No tokens yet"
        description="Be the first to launch on ROBBED_."
        action={
          <Button asChild size="sm" className="mt-1">
            <a href="/create">Launch a token</a>
          </Button>
        }
      />
    ) : (
      <EmptyState
        title="No tokens match"
        description="No tokens match this filter."
        action={
          <Button asChild variant="outline" size="sm" className="mt-1">
            <a href="/">Clear filters</a>
          </Button>
        }
      />
    );
  }

  return (
    <div className="relative">
      {pendingNew > 0 && (
        <div className="pointer-events-none sticky top-2 z-30 flex justify-center">
          <Button
            size="sm"
            variant="secondary"
            className="pointer-events-auto shadow-md"
            onClick={refreshNew}
          >
            {pendingNew} new {pendingNew === 1 ? "launch" : "launches"} — refresh
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tokens.map((token) => (
          <TokenCard
            key={token.address}
            token={token}
            flashing={flashing.has(token.address)}
          />
        ))}
      </div>

      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && (
        <p className="py-3 text-center text-xs text-muted-foreground">Loading more…</p>
      )}
    </div>
  );
}
