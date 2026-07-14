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

import { Tab, TabBar } from "@/shared/ui";
import { useWsChannel } from "@/shared/lib/ws";
import { formatPriceCompact } from "@/shared/lib/format-price";
import { readChartPalette } from "@/shared/lib/theme-colors";

import {
  isApplicableUpdate,
  lastActivityAnchor,
  toChartCandles,
  toChartVolumes,
  wsCandleToBar,
} from "../model/candles";
import { useCandleFeed } from "../model/use-candle-feed";

/**
 * Venue-continuous price chart. ONE `CandlestickSeries` across graduation:
 * the indexer merges curve + V3 events server-side, so there is no venue seam,
 * gap, or second series here. The only venue artifact is a single labeled marker
 * at the graduation timestamp ("Graduated to Uniswap V3") — an annotation, not
 * data (web.md).
 *
 * Docs-first (lightweight-charts v5, verified 2026-07-10): v5 uses
 * `chart.addSeries(CandlestickSeries, …)` (not the removed `addCandlestickSeries`)
 * and `createSeriesMarkers(series, …)` for markers. Realtime patches use
 * `series.update()` with the WS candle bucket; historical backfill is `setData`.
 */
/**
 * Normal-magnitude (≥ 1e-4) axis/crosshair label — an 8dp fixed with trailing
 * zeros trimmed, so ticks stay precise ("0.0312", "1.5") without exponential;
 * tiny prices are handled by the compact subscript path in `formatPriceCompact`.
 */
function chartAxisPrice(abs: number): string {
  if (abs === 0) return "0";
  const fixed = abs.toFixed(8);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/**
 * Time-scale LAYOUT constants (D-71). Pure canvas geometry — bar-slot counts and
 * pixel spacings, NOT market metrics (no price/TVL/volume threshold), so they are
 * clear of `.claude/rules/no-market-metrics.md`. They govern only how the
 * venue-continuous series (web.md "Chart — venue-continuous candles") is anchored
 * left→right, Pump.fun / DEXScreener style, and how a fresh token renders before
 * it has enough bars to fill the pane.
 */
/** Empty bars kept to the right of the newest candle — realtime-append headroom. */
const CHART_RIGHT_OFFSET = 3;
/** Resting candle width (px); fitContent()/setVisibleLogicalRange override on load. */
const CHART_BAR_SPACING = 8;
/**
 * Below this many bars a fresh token uses the SPARSE presentation: the few bars
 * anchor left at a natural width inside a fixed slot window (below), with room on
 * the right to fill — instead of fitContent() over-stretching a handful of bars.
 */
const CHART_SPARSE_MIN_BARS = 8;
/** Slot window the sparse variant fills: bars flush left, whitespace to the right. */
const CHART_SPARSE_SLOTS = 24;

export function PriceChart({
  token,
  initialCandles,
}: {
  token: TokenDetail;
  initialCandles?: { candles: Candle[] };
}) {
  // Mount interval. Also the ONLY interval the SSR `initialCandles` seed is valid
  // for (it was fetched for exactly this interval) — threaded into the feed so the
  // seed never suppresses the fetch of a DIFFERENT interval's query.
  const initialInterval: CandleInterval = token.status === "graduated" ? "5m" : "1m";
  const [interval, setInterval] = useState<CandleInterval>(initialInterval);

  const feed = useCandleFeed(token.address, interval, {
    initialInterval,
    initialData: initialCandles,
    // Right-edge anchor for the idle-token fallback window (D-72): only used when
    // the live now-window comes back empty.
    anchorSec: lastActivityAnchor(token),
  });
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
        // Left→right anchoring (Pump.fun / Bonk / DEXScreener). Docs-first
        // (lightweight-charts 5.0 TimeScaleOptions, verified 2026-07-14):
        //  • fixLeftEdge — pins the OLDEST bar to the left edge (no scroll past
        //    it) so history reads left→right instead of hugging the price axis.
        //  • lockVisibleTimeRangeOnResize — the ROOT-CAUSE fix for "chart starts
        //    from the right": the default (false) keeps barSpacing fixed while
        //    `autoSize`'s ResizeObserver grows the pane after first paint, which
        //    re-anchors the bars to the right and leaves dead space on the LEFT.
        //    Locking preserves the fitted logical range across that growth and
        //    recomputes barSpacing, so the fill stays left-anchored.
        //  • rightOffset — a few empty bars so the newest candle isn't glued to
        //    the axis and realtime appends have somewhere to grow (shift-on-new-
        //    bar stays on, the library default — anchoring left ≠ freezing).
        //  • barSpacing — resting width; fitContent()/setVisibleLogicalRange
        //    (below, after data loads) override it.
        fixLeftEdge: true,
        lockVisibleTimeRangeOnResize: true,
        rightOffset: CHART_RIGHT_OFFSET,
        barSpacing: CHART_BAR_SPACING,
      },
      crosshair: { mode: 0 },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      borderVisible: false,
      // Compact tiny-price axis + crosshair labels (DexScreener subscript, e.g.
      // 0.0₁₀63) for the sub-1e-4 prices curve memecoins live at. Docs-first
      // (lightweight-charts 5.0.9 typings — PriceFormatCustom.formatter overrides
      // "the price scale tick marks, labels and crosshair labels"): a SERIES-level
      // `type:"custom"` formatter is scoped to THIS series' price scale, so the
      // volume overlay's `type:"volume"` axis stays a plain volume — the reason we
      // chose it over the chart-wide `localization.priceFormatter` (which would
      // also reformat the volume scale). Canvas is text-only → unicode subscripts;
      // normal magnitudes keep 8dp precision (`chartAxisPrice`) so distinct ticks
      // don't collapse.
      priceFormat: {
        type: "custom",
        minMove: 0.00000001,
        formatter: (price: number) =>
          formatPriceCompact(price, { subscript: "unicode", plain: chartAxisPrice }),
      },
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
    // Anchor left→right after (re)loading history. Docs-first (lightweight-charts
    // 5.0 ITimeScaleApi, verified 2026-07-14):
    //  • enough bars → fitContent() fills the pane from the OLDEST bar; combined
    //    with lockVisibleTimeRangeOnResize it stays filled across autoSize growth.
    //  • sparse (fresh token, few trades) → setVisibleLogicalRange pins the bars
    //    flush left at a natural width inside a fixed slot window with room on the
    //    right to fill, instead of fitContent() over-stretching a handful of bars
    //    into giant candles. `from:-0.5` is clamped by fixLeftEdge so the first
    //    bar sits at the left edge; `to` past the data shows right-side whitespace.
    const ts = chartRef.current?.timeScale();
    if (ts && bars.length > 0) {
      if (bars.length < CHART_SPARSE_MIN_BARS) {
        ts.setVisibleLogicalRange({ from: -0.5, to: CHART_SPARSE_SLOTS });
      } else {
        ts.fitContent();
      }
    }
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

  // Show the "first trades incoming" copy ONLY when the token has genuinely never
  // traded (no candles exist at ANY interval) — never merely because a short
  // interval's window missed old trades (D-72). `priceEth === null` is the wire's
  // "before first trade" signal (api-types: priceEth is null before the first
  // trade); once a token has traded, the anchored fallback surfaces its candles
  // and this copy stays hidden even if a given interval momentarily draws empty.
  const empty =
    !feed.isLoading && (feed.data?.candles.length ?? 0) === 0 && token.priceEth === null;

  return (

    <div className="flex w-full h-full min-h-0 flex-col gap-3.5 border p-4">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <TabBar>
          {CANDLE_INTERVALS.map((iv) => (
            <Tab
              key={iv}
              active={iv === interval}
              onClick={() => setInterval(iv)}
              className="px-2 py-1 tabular-nums"
            >
              {iv.toUpperCase()}
            </Tab>
          ))}
        </TabBar>
        {/* Mockup (template 2a): lowercase `price / ETH`, 11px, faint — NOT the
            uppercased MonoLabel micro-label. */}
        <span className="text-xs text-faint">price / ETH</span>
      </div>
      <div className="relative w-full flex-1 min-h-0">
        {/* `absolute inset-0` decouples the chart element's size from percentage-
            height resolution — it fills the flex-sized wrapper exactly, and
            `autoSize` (ResizeObserver) drives the canvas to match. */}
        <div ref={containerRef} className="absolute inset-0" />
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">
            First trades incoming — the chart fills as the curve trades.
          </div>
        )}
      </div>
    </div>
  );
}
