/**
 * Sparkline candle window (web.md §6, X-7 fix). The candles endpoint takes
 * `from`/`to` (unix seconds), NOT a `limit` param — the OG route computes the
 * window from the current time. Default: the trailing 12h at 15m buckets (~48
 * candles) — a dense-enough sparkline without over-fetching.
 */
export const OG_CANDLE_INTERVAL = "15m" as const;
const WINDOW_SECONDS = 12 * 60 * 60; // 12h

export function ogCandleWindow(now = Date.now()): {
  interval: typeof OG_CANDLE_INTERVAL;
  from: number;
  to: number;
} {
  const to = Math.floor(now / 1000);
  return { interval: OG_CANDLE_INTERVAL, from: to - WINDOW_SECONDS, to };
}
