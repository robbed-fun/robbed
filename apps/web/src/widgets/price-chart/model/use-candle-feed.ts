"use client";

import type { Candle, CandleInterval } from "@robbed/shared";
import { useQuery } from "@tanstack/react-query";

import { getCandles } from "@/shared/api";
import { qk } from "@/shared/lib/query-keys";

import { candleWindow } from "./candles";

/**
 * Historical candle backfill for one interval. The endpoint takes
 * `from`/`to` (unix seconds), not `limit` (api.md) — we compute a trailing window
 * sized to the interval so every interval shows a comparable span of history.
 *
 * Live updates are NOT in this hook: the chart subscribes to the WS candle
 * channel and patches the series imperatively via `series.update()` (the pure
 * transform lives in ./candles). This hook only owns resumable REST truth, which
 * is also what a WS reconnect/seq-gap re-serves (web.md).
 *
 * `candleWindow` moved to ./candles (pure, server-safe) so the SSR view can call
 * it without importing this client module; re-exported here for existing callers.
 */
export { candleWindow } from "./candles";

export function useCandleFeed(
  address: string,
  interval: CandleInterval,
  initialData?: { candles: Candle[] },
) {
  return useQuery({
    queryKey: qk.candles(address, interval),
    queryFn: ({ signal }) => {
      const win = candleWindow(interval);
      return getCandles(address, interval, win, { signal });
    },
    initialData,
    staleTime: 5_000,
  });
}
