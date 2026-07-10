"use client";

import {
  CANDLE_INTERVALS,
  type Candle,
  type CandleInterval,
  type TokenDetail,
  tokenCandles,
} from "@robbed/shared";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  createChart,
  createSeriesMarkers,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

import { Card, MonoLabel, Tab, TabBar } from "@/shared/ui";
import { useWsChannel } from "@/shared/lib/ws";
import { readChartPalette } from "@/shared/lib/theme-colors";

import {
  isApplicableUpdate,
  toChartCandles,
  toChartVolumes,
  wsCandleToBar,
} from "../model/candles";
import { useCandleFeed } from "../model/use-candle-feed";

/**
 * Venue-continuous price chart (§5.2). ONE `CandlestickSeries` across graduation:
 * the indexer merges curve + V3 events server-side, so there is no venue seam,
 * gap, or second series here. The only venue artifact is a single labeled marker
 * at the graduation timestamp ("Graduated to Uniswap V3") — an annotation, not
 * data (web.md §3.2).
 *
 * Docs-first (lightweight-charts v5, verified 2026-07-10): v5 uses
 * `chart.addSeries(CandlestickSeries, …)` (not the removed `addCandlestickSeries`)
 * and `createSeriesMarkers(series, …)` for markers. Realtime patches use
 * `series.update()` with the WS candle bucket; historical backfill is `setData`.
 */
export function PriceChart({
  token,
  initialCandles,
}: {
  token: TokenDetail;
  initialCandles?: { candles: Candle[] };
}) {
  const [interval, setInterval] = useState<CandleInterval>(
    token.status === "graduated" ? "5m" : "1m",
  );

  const feed = useCandleFeed(token.address, interval, initialCandles);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const palette = useMemo(() => readChartPalette(), []);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: palette.text,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: {
        borderColor: palette.border,
        timeVisible: true,
        secondsVisible: interval === "1s" || interval === "15s",
      },
      crosshair: { mode: 0 },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      borderVisible: false,
      priceFormat: { type: "price", precision: 8, minMove: 0.00000001 },
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      lastTimeRef.current = null;
    };
    // Recreate only if the seconds-visible axis config changes with interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, interval === "1s" || interval === "15s"]);

  // Load historical data whenever the query data or interval changes → setData.
  useEffect(() => {
    const candle = candleRef.current;
    const volume = volumeRef.current;
    if (!candle || !volume) return;
    const candles = feed.data?.candles ?? [];
    const bars = toChartCandles(candles);
    candle.setData(bars.map((b) => ({ ...b, time: b.time as UTCTimestamp })));
    volume.setData(
      toChartVolumes(candles, palette).map((v) => ({ ...v, time: v.time as UTCTimestamp })),
    );
    lastTimeRef.current = bars.length ? bars[bars.length - 1]!.time : null;

    // Graduation annotation — one labeled marker at the graduation timestamp
    // (annotation, not a second series / not a data discontinuity).
    if (token.graduatedAt) {
      createSeriesMarkers(candle, [
        {
          time: token.graduatedAt as UTCTimestamp,
          position: "aboveBar",
          color: palette.graduation,
          shape: "arrowDown",
          text: "Graduated to Uniswap V3",
        },
      ]);
    }
    chartRef.current?.timeScale().fitContent();
  }, [feed.data, palette, token.graduatedAt]);

  // Live patch: WS candle for THIS interval → series.update() (never reorders).
  useWsChannel(tokenCandles(token.address, interval), (msg) => {
    if (msg.type !== "candle" || msg.data.interval !== interval) return;
    const candle = candleRef.current;
    const volume = volumeRef.current;
    if (!candle || !volume) return;
    const { candle: bar, volume: vol } = wsCandleToBar(msg.data);
    if (!isApplicableUpdate(bar, lastTimeRef.current)) {
      void feed.refetch(); // stale/out-of-order → resumable REST truth
      return;
    }
    candle.update({ ...bar, time: bar.time as UTCTimestamp });
    volume.update({
      time: bar.time as UTCTimestamp,
      value: vol,
      color: bar.close >= bar.open ? palette.volumeUp : palette.volumeDown,
    });
    lastTimeRef.current = bar.time;
  });

  const empty = !feed.isLoading && (feed.data?.candles.length ?? 0) === 0;

  return (
    // ROBBED_ terminal chart panel (docs/Robbed.html "2a"): interval TabBar +
    // "price / ETH" micro-label over one venue-continuous series.
    // DECISION (hoodpad-frontend): the mockup shows 1H/4H/1D/ALL, but the data
    // contract is INTERVAL-based (`CANDLE_INTERVALS` from @robbed/shared / the
    // candles API), not range-based — the buttons switch candle granularity. We
    // keep the real intervals (never redeclare the shared contract) styled as the
    // terminal tab strip; the mockup labels were illustrative.
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <TabBar>
          {CANDLE_INTERVALS.map((iv) => (
            <Tab
              key={iv}
              active={iv === interval}
              onClick={() => setInterval(iv)}
              className="tabular-nums"
            >
              {iv}
            </Tab>
          ))}
        </TabBar>
        <MonoLabel size="2xs">price / ETH</MonoLabel>
      </div>
      <div className="relative h-[280px] w-full sm:h-[340px]">
        <div ref={containerRef} className="h-full w-full" />
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">
            First trades incoming — the chart fills as the curve trades.
          </div>
        )}
      </div>
    </Card>
  );
}
