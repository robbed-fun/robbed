import type { Candle, WsCandleData } from "@robbed/shared";
import { formatEther } from "viem";

/**
 * Pure candle transforms for the venue-continuous chart (§5.2, web.md §3.2).
 *
 * The indexer already MERGES curve `Trade` and V3 `Swap` events into ONE candle
 * series (indexer.md §8), so the frontend renders exactly one `CandlestickSeries`
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
