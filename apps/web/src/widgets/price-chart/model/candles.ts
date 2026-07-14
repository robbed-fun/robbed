import type { Candle, CandleInterval, TokenDetail, WsCandleData } from "@robbed/shared";
import { CANDLE_INTERVAL_SECONDS } from "@robbed/shared";
import { formatEther } from "viem";

import { getCandles } from "@/shared/api";

/**
 * Trailing REST backfill window for one interval. PURE + server-safe: it
 * lives here (not in the `"use client"` feed hook) so the server component
 * TokenDetailView can compute the SSR candle window without importing a client
 * module — invoking a client-marked export from the server is a hard error in
 * the App Router (Next 16, verified 2026-07-10). The hook re-exports it.
 *
 * `anchorSec` (unix seconds) moves the window's RIGHT edge off `now` onto a
 * token's last on-chain activity, so short intervals still cover an idle token's
 * real candles instead of a false-empty window (design-decisions D-72). Absent
 * (the live case) the window trails `now` exactly — behaviour is unchanged.
 */
const BARS_PER_WINDOW = 400;

export function candleWindow(
  interval: CandleInterval,
  opts?: { anchorSec?: number; now?: number },
) {
  const width = CANDLE_INTERVAL_SECONDS[interval];
  const span = width * BARS_PER_WINDOW;
  if (opts?.anchorSec !== undefined) {
    // Right edge = anchor + one bucket of headroom so the anchor's own bucket
    // sits inside the inclusive [from, to] range the candles API returns.
    const to = opts.anchorSec + width;
    return { from: to - span, to };
  }
  const to = Math.floor((opts?.now ?? Date.now()) / 1000);
  return { from: to - span, to };
}

/**
 * Right-edge anchor for the idle-token fallback window (D-72): a token's most
 * recent on-chain activity. `TokenDetail` carries no dedicated `lastActivityAt`
 * yet — GAP reported to robbed-shared / robbed-indexer (the indexer already has
 * the last-trade timestamp) — so this uses `graduatedAt ?? createdAt`, the best
 * last-activity proxy already on the wire. It is a FALLBACK anchor only: a live
 * token's now-window fetch wins first (see `loadCandles`), so this matters solely
 * when the now-window comes back empty. When shared adds `lastActivityAt`, only
 * this one function changes and the anchor becomes exact for a mid-life-then-idle
 * token (the residual case createdAt/graduatedAt cannot reach).
 */
export function lastActivityAnchor(
  token: Pick<TokenDetail, "createdAt" | "graduatedAt">,
): number {
  return token.graduatedAt ?? token.createdAt;
}

/**
 * Resumable REST truth for one interval, with a DATA-ANCHORED fallback (D-72).
 *
 * Phase 1 fetches the live (now-trailing) window — correct and unchanged for an
 * actively trading token. If Phase 1 is EMPTY *and* the token's last activity is
 * older than that window, Phase 2 re-fetches a window whose right edge is that
 * activity (`anchorSec`), so an idle token's short intervals surface its real
 * candles instead of a false-empty (DEXScreener / Pump.fun behaviour: clicking a
 * short interval on a long-idle token scrolls to the trade, it does not blank).
 *
 * Server-safe (no client-only imports) so the SSR seed and the client feed hook
 * share ONE implementation and cannot drift. The `now` opt is test-only.
 */
export async function loadCandles(
  address: string,
  interval: CandleInterval,
  opts?: {
    anchorSec?: number;
    now?: number;
    fetch?: { signal?: AbortSignal; revalidate?: number };
  },
): Promise<{ candles: Candle[] }> {
  const live = await getCandles(
    address,
    interval,
    candleWindow(interval, { now: opts?.now }),
    opts?.fetch,
  );
  if (live.candles.length > 0 || opts?.anchorSec === undefined) return live;

  // Skip Phase 2 when the anchor already sits inside the live window (nothing to
  // gain, e.g. a token that simply has not traded yet) — the empty Phase-1
  // result is the truth in that case.
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const liveFrom = nowSec - CANDLE_INTERVAL_SECONDS[interval] * BARS_PER_WINDOW;
  if (opts.anchorSec >= liveFrom) return live;

  return getCandles(
    address,
    interval,
    candleWindow(interval, { anchorSec: opts.anchorSec }),
    opts.fetch,
  );
}

/**
 * Pure candle transforms for the venue-continuous chart (web.md).
 *
 * The indexer already MERGES curve `Trade` and V3 `Swap` events into ONE candle
 * series (indexer.md), so the frontend renders exactly one `CandlestickSeries`
 * — no venue seam, no second series. These pure helpers (unit-tested in
 * tests/candle-merge.test.ts) guarantee the data fed to lightweight-charts is
 * strictly ascending + de-duplicated by bucket, which the library requires and
 * which is what keeps the single series continuous across graduation.
 */

/** lightweight-charts candlestick datum (time = unix seconds). */
export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** lightweight-charts histogram datum for the volume pane. */
export interface ChartVolume {
  time: number;
  value: number;
  color: string;
}

/** Map REST candles → chart data: ascending by bucket, unique (last wins). */
export function toChartCandles(candles: readonly Candle[]): ChartCandle[] {
  const byTime = new Map<number, ChartCandle>();
  for (const c of candles) {
    byTime.set(c.bucketStart, {
      time: c.bucketStart,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Map REST candles → volume histogram (up/down colored by close vs open). */
export function toChartVolumes(
  candles: readonly Candle[],
  palette: { volumeUp: string; volumeDown: string },
): ChartVolume[] {
  const byTime = new Map<number, ChartVolume>();
  for (const c of candles) {
    byTime.set(c.bucketStart, {
      time: c.bucketStart,
      value: weiToEth(c.volumeEth),
      color: c.close >= c.open ? palette.volumeUp : palette.volumeDown,
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Convert a live WS candle patch into a single bar for `series.update()`. The WS
 * payload is always for the current (or a brand-new) bucket, so `update()` either
 * rewrites the last bar or appends one — it never reorders history. Returns the
 * bar; the caller decides whether it is a monotonic advance.
 */
export function wsCandleToBar(ws: WsCandleData): {
  candle: ChartCandle;
  volume: number;
} {
  return {
    candle: {
      time: ws.bucketStart,
      open: ws.open,
      high: ws.high,
      low: ws.low,
      close: ws.close,
    },
    volume: weiToEth(ws.volumeEth),
  };
}

/** wei decimal string → ETH float (for the volume histogram scale). */
function weiToEth(wei: string): number {
  return Number(formatEther(BigInt(wei)));
}

/**
 * Guard: a WS bar may only be applied via `update()` if its time is >= the last
 * known bar time (lightweight-charts forbids updating an older bar). Older/stale
 * WS candles trigger a historical refetch instead (handled by the caller).
 */
export function isApplicableUpdate(bar: ChartCandle, lastTime: number | null): boolean {
  return lastTime === null || bar.time >= lastTime;
}
