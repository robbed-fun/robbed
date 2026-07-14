"use client";

import type { Candle, CandleInterval } from "@robbed/shared";
import { useQuery } from "@tanstack/react-query";

import { qk } from "@/shared/lib/query-keys";

import { loadCandles } from "./candles";

/**
 * Historical candle backfill for one interval. The endpoint takes
 * `from`/`to` (unix seconds), not `limit` (api.md) — `loadCandles` computes a
 * trailing window sized to the interval, with a data-anchored fallback so an
 * idle token's short intervals still surface real candles (D-72).
 *
 * Live updates are NOT in this hook: the chart subscribes to the WS candle
 * channel and patches the series imperatively via `series.update()` (the pure
 * transform lives in ./candles). This hook only owns resumable REST truth, which
 * is also what a WS reconnect/seq-gap re-serves (web.md).
 *
 * `candleWindow`/`loadCandles`/`lastActivityAnchor` live in ./candles (pure,
 * server-safe) so the SSR view can call them without importing this client
 * module; re-exported here for existing callers.
 */
export { candleWindow, lastActivityAnchor, loadCandles } from "./candles";

export function useCandleFeed(
  address: string,
  interval: CandleInterval,
  opts: {
    /**
     * The interval the SSR `initialData` was actually fetched for (PriceChart's
     * mount interval). Bug fix (docs-first — TanStack Query v5 "Initial Query
     * Data", verified 2026-07-14): `initialData` is persisted to the cache PER
     * queryKey and treated as fresh (subject to `staleTime`), which SUPPRESSES
     * the mount fetch. The SSR seed was fetched for ONE interval, so passing it
     * into EVERY interval's query froze each inactive interval on the wrong
     * (often empty) seed and no `/candles` request ever fired on tab-switch.
     * Seed ONLY the interval it belongs to; every other interval gets
     * `undefined`, so React Query fetches on mount.
     */
    initialInterval: CandleInterval;
    initialData?: { candles: Candle[] };
    /** Right-edge anchor for the idle-token fallback window (D-72). */
    anchorSec?: number;
  },
) {
  const seed = interval === opts.initialInterval ? opts.initialData : undefined;
  return useQuery({
    queryKey: qk.candles(address, interval),
    queryFn: ({ signal }) =>
      loadCandles(address, interval, { anchorSec: opts.anchorSec, fetch: { signal } }),
    initialData: seed,
    staleTime: 5_000,
  });
}
