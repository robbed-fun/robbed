"use client";

import { type TokenDetail, tokenEvents, tokenTrades } from "@robbed/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { getToken } from "@/shared/api";
import { qk } from "@/shared/lib/query-keys";
import { useWsChannel } from "@/shared/lib/ws";

import {
  applyGraduated,
  tradeImpliesGraduation,
  tradeMovesBondingProgress,
} from "./live";

/**
 * LIVE TokenDetail (TD-6; §5.2/§12.12/§2.1). The SSR token summary is a
 * snapshot — nothing re-engined the venue after a permissionless `graduate()`
 * until reload. This hook makes `status` (and everything derived from it: the
 * TradeWidget engine, the header status pill, the bonding cell, the V3 pool
 * link) live, with NO reload:
 *
 * - The SSR snapshot seeds a TanStack Query read (`qk.token`) — same
 *   SSR-seed + WS-patch pattern as the trades feed (setQueryData for pushes,
 *   REST as resumable truth; TanStack Query v5, docs re-verified 2026-07-12).
 * - `token:{addr}:events` `graduated` → optimistic cache flip via
 *   `applyGraduated` (instant venue switch) + invalidate → refetch replaces the
 *   patch with the indexed row. `metadata_verified` → invalidate (Trust panel
 *   verdict input).
 * - `token:{addr}:trades` carrying `venue: "v3"` while we still render a curve
 *   venue implies graduation (event raced/dropped) → reconcile to indexed truth.
 * - A NORMAL curve `trade` on that channel moves `real_eth_reserves`, so the
 *   bonding cell's `graduation.progressPct` + raised-ETH (`reserves.realEth`) go
 *   stale until refetch → throttled invalidate (≥5s) re-serves indexed truth.
 * - WS reconnect / seq-gap: the WsClient invalidates the whole `token` family
 *   (LIVE_QUERY_PREFIXES) → this active query refetches → the status flip is
 *   never lost across a disconnect (proven by tests/ws-reconnect.test.ts).
 */
export function useLiveTokenDetail(initial: TokenDetail): TokenDetail {
  const queryClient = useQueryClient();
  const address = initial.address.toLowerCase();
  const queryKey = qk.token(address);

  // Monotonic graduation latch (DECISION, recorded): graduation is single-fire
  // and irreversible (§12.12), so once the WS says `graduated` the UI must NEVER
  // regress to a curve venue — even if the immediate REST refetch races the
  // indexer's projection and briefly returns a pre-graduation row. The latch
  // overlays `applyGraduated` on any lagging snapshot; once the indexed row
  // catches up it wins verbatim (the overlay becomes a no-op). This mirrors the
  // trade rule "never render WS-contradicted state" (§2.1).
  const [gradPool, setGradPool] = useState<string | null>(null);

  const query = useQuery<TokenDetail>({
    queryKey,
    queryFn: ({ signal }) => getToken(address, { signal }),
    initialData: initial,
    staleTime: 5_000,
  });

  useWsChannel(tokenEvents(address), (msg) => {
    if (msg.type === "graduated") {
      setGradPool(msg.data.pool);
      // Optimistic cache flip so the venue re-engines the instant the signal
      // lands…
      queryClient.setQueryData<TokenDetail>(queryKey, (old) =>
        old ? applyGraduated(old, msg.data.pool) : old,
      );
      // …then re-serve the indexed row (graduatedAt, pool, progress) as truth.
      void queryClient.invalidateQueries({ queryKey });
    } else if (msg.type === "metadata_verified") {
      void queryClient.invalidateQueries({ queryKey });
    }
  });

  // Bonding-progress freshness: a normal buy/sell has no other trigger to
  // refresh the SSR-seeded `qk.token` query, so `progressPct` + raised-ETH would
  // sit stale between graduations. `invalidateQueries` refetches an active query
  // immediately, overriding `staleTime` (TanStack Query v5 — query-invalidation
  // docs, re-verified 2026-07-13), so an un-throttled invalidate per trade is a
  // refetch storm on a hot token. Throttle to ≥5s (matches `staleTime`), the
  // exact pattern the sibling HolderTable trade handler uses (DECISION recorded).
  const lastProgressRefetch = useRef(0);
  useWsChannel(tokenTrades(address), (msg) => {
    const current = queryClient.getQueryData<TokenDetail>(queryKey);
    // Venue reconciliation (a v3 trade before the `graduated` event) — critical,
    // never throttled: reconcile to indexed truth the instant it's implied.
    if (tradeImpliesGraduation(current, msg)) {
      void queryClient.invalidateQueries({ queryKey });
      return;
    }
    // Graduation is monotonic: once latched (`gradPool`) the venue is retired and
    // the bonding cell is terminal — never refetch-regress it (§12.12/§2.1).
    if (gradPool !== null || !tradeMovesBondingProgress(current, msg)) return;
    const now = Date.now();
    if (now - lastProgressRefetch.current < 5_000) return;
    lastProgressRefetch.current = now;
    void queryClient.invalidateQueries({ queryKey });
  });

  const data = query.data ?? initial;
  if (gradPool !== null && data.status !== "graduated") {
    return applyGraduated(data, gradPool);
  }
  return data;
}
