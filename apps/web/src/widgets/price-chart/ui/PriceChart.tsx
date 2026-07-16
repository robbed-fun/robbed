"use client";

import {
  CANDLE_INTERVAL_SECONDS,
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
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
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
/** Resting candle width (px); fitContent()/setVisibleRange override on load. */
const CHART_BAR_SPACING = 8;
/**
 * Below this many bars a fresh token uses the SPARSE presentation: explicit
 * interval whitespace + a real visible time range, instead of fitContent()
 * over-stretching a handful of bars or collapsing labels into one timestamp.
 */
const CHART_SPARSE_MIN_BARS = 8;
/**
 * Sparse intervals often have only 1-2 real trade buckets. Include neighboring
 * whitespace buckets so the horizontal axis represents real interval time, not
 * two adjacent logical bars stretched across the full pane.
 */
const CHART_SPARSE_INTERVAL_LEFT_PADDING_BUCKETS = 2;
const CHART_SPARSE_INTERVAL_RIGHT_PADDING_BUCKETS = 6;
const CHART_1S_VISIBLE_LEFT_BUCKETS = 45;
const CHART_1S_VISIBLE_RIGHT_BUCKETS = 5;
const CHART_15S_VISIBLE_LEFT_BUCKETS = 8;
const CHART_15S_VISIBLE_RIGHT_BUCKETS = 3;
const CHART_1M_VISIBLE_LEFT_BUCKETS = 8;
const CHART_1M_VISIBLE_RIGHT_BUCKETS = 3;
const CHART_5M_VISIBLE_LEFT_BUCKETS = 8;
const CHART_5M_VISIBLE_RIGHT_BUCKETS = 3;
const CHART_15M_VISIBLE_LEFT_BUCKETS = 8;
const CHART_15M_VISIBLE_RIGHT_BUCKETS = 3;
const CHART_1H_VISIBLE_LEFT_BUCKETS = 8;
const CHART_1H_VISIBLE_RIGHT_BUCKETS = 3;
/** Minimum display body/range as a fraction of the visible price span. */
const CHART_MIN_VISIBLE_CANDLE_BODY_RATIO = 0.04;
const CHART_MIN_VISIBLE_CANDLE_RANGE_RATIO = 0.075;

type TimedDatum = { time: UTCTimestamp };
type VisibleChartCandle = TimedDatum & {
  open: number;
  high: number;
  low: number;
  close: number;
};

function isShortInterval(interval: CandleInterval): boolean {
  return interval === "1s" || interval === "15s";
}

function shouldUseSparseTimeGrid(barCount: number): boolean {
  return barCount > 0 && barCount < CHART_SPARSE_MIN_BARS;
}

function sparseVisibleBuckets(interval: CandleInterval): { left: number; right: number } {
  switch (interval) {
    case "1s":
      return { left: CHART_1S_VISIBLE_LEFT_BUCKETS, right: CHART_1S_VISIBLE_RIGHT_BUCKETS };
    case "15s":
      return { left: CHART_15S_VISIBLE_LEFT_BUCKETS, right: CHART_15S_VISIBLE_RIGHT_BUCKETS };
    case "1m":
      return { left: CHART_1M_VISIBLE_LEFT_BUCKETS, right: CHART_1M_VISIBLE_RIGHT_BUCKETS };
    case "5m":
      return { left: CHART_5M_VISIBLE_LEFT_BUCKETS, right: CHART_5M_VISIBLE_RIGHT_BUCKETS };
    case "15m":
      return { left: CHART_15M_VISIBLE_LEFT_BUCKETS, right: CHART_15M_VISIBLE_RIGHT_BUCKETS };
    case "1h":
      return { left: CHART_1H_VISIBLE_LEFT_BUCKETS, right: CHART_1H_VISIBLE_RIGHT_BUCKETS };
  }
}

function withSparseTimeWhitespace<T extends TimedDatum>(
  points: T[],
  interval: CandleInterval,
): Array<T | TimedDatum> {
  if (!shouldUseSparseTimeGrid(points.length)) return points;
  const width = CANDLE_INTERVAL_SECONDS[interval];
  const first = points[0]!.time;
  const last = points[points.length - 1]!.time;
  const visible = sparseVisibleBuckets(interval);
  const byTime = new Map<number, T>(points.map((point) => [point.time, point]));
  const from = Math.min(
    first - width * CHART_SPARSE_INTERVAL_LEFT_PADDING_BUCKETS,
    last - width * visible.left,
  );
  const to = Math.max(
    last + width * CHART_SPARSE_INTERVAL_RIGHT_PADDING_BUCKETS,
    last + width * visible.right,
  );
  const filled: Array<T | TimedDatum> = [];

  for (let time = from; time <= to; time += width) {
    filled.push(byTime.get(time) ?? { time: time as UTCTimestamp });
  }

  return filled;
}

function formatUtcTime(time: number): { date: string; minute: string; second: string } {
  const iso = new Date(time * 1000).toISOString();
  return {
    date: `${iso.slice(5, 7)}-${iso.slice(8, 10)}`,
    minute: iso.slice(11, 16),
    second: iso.slice(11, 19),
  };
}

function formatTimeAxisTick(interval: CandleInterval, time: Time): string | null {
  if (typeof time !== "number") return null;
  const formatted = formatUtcTime(time);
  switch (interval) {
    case "1s":
    case "15s":
      return formatted.second;
    case "1m":
    case "5m":
    case "15m":
      return formatted.minute;
    case "1h":
      return `${formatted.date} ${formatted.minute}`;
  }
}

function sparseVisibleRange(
  interval: CandleInterval,
  bars: Array<{ time: number }>,
): { from: UTCTimestamp; to: UTCTimestamp } | null {
  if (!shouldUseSparseTimeGrid(bars.length)) return null;
  const last = bars[bars.length - 1]!.time;
  const width = CANDLE_INTERVAL_SECONDS[interval];
  const visible = sparseVisibleBuckets(interval);

  return {
    from: (last - width * visible.left) as UTCTimestamp,
    to: (last + width * visible.right) as UTCTimestamp,
  };
}

function visiblePriceSpan(candles: VisibleChartCandle[]): number {
  const prices = candles.flatMap((c) => [c.open, c.high, c.low, c.close]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const maxAbs = Math.max(...prices.map((price) => Math.abs(price)), Number.EPSILON);
  return Math.max(max - min, maxAbs * 0.001, Number.EPSILON);
}

function makeCandlesVisible(candles: VisibleChartCandle[]): VisibleChartCandle[] {
  if (candles.length === 0) return candles;
  const span = visiblePriceSpan(candles);
  const minBody = span * CHART_MIN_VISIBLE_CANDLE_BODY_RATIO;
  const minRange = span * CHART_MIN_VISIBLE_CANDLE_RANGE_RATIO;

  return candles.map((c, index) => {
    let open = c.open;
    const close = c.close;
    let high = c.high;
    let low = c.low;
    const prevClose = candles[index - 1]?.close ?? c.open;
    const up = close >= prevClose;
    const body = Math.abs(close - open);

    if (body < minBody) {
      open = up ? close - minBody : close + minBody;
    }

    const bodyHigh = Math.max(open, close);
    const bodyLow = Math.min(open, close);
    if (high - low < minRange) {
      high = Math.max(high, bodyHigh + minRange * 0.2);
      low = Math.min(low, bodyLow - minRange * 0.2);
    }

    return {
      ...c,
      open,
      close,
      high,
      low: Math.max(0, low),
    };
  });
}

export function PriceChart({
  token,
  initialCandles,
  activityAnchorSec,
}: {
  token: TokenDetail;
  initialCandles?: { candles: Candle[] };
  activityAnchorSec?: number;
}) {
  // Mount interval. Also the ONLY interval the SSR `initialCandles` seed is valid
  // for (it was fetched for exactly this interval) — threaded into the feed so the
  // seed never suppresses the fetch of a DIFFERENT interval's query.
  const initialInterval: CandleInterval = token.status === "graduated" ? "5m" : "1m";
  const [interval, setInterval] = useState<CandleInterval>(initialInterval);
  // Empty SSR candles are only authoritative for never-traded tokens. If a token
  // has a price, an empty seed is probably a stale/early fallback window and the
  // client must fetch immediately using `activityAnchorSec`.
  const seededCandles =
    initialCandles && (initialCandles.candles.length > 0 || token.priceEth === null)
      ? initialCandles
      : undefined;

  const feed = useCandleFeed(token.address, interval, {
    initialInterval,
    initialData: seededCandles,
    // Right-edge anchor for the idle-token fallback window (D-72): only used when
    // the live now-window comes back empty. Token detail may pass the latest SSR
    // trade timestamp (D-76) to cover launch bursts after createdAt.
    anchorSec: activityAnchorSec ?? lastActivityAnchor(token),
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
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
      // lightweight-charts defaults to `navigator.language` for date tick labels.
      // Some Chromium/Linux environments expose `en-US@posix`, which Intl rejects
      // and aborts canvas painting; use the product's existing valid locale.
      localization: { locale: "en-US" },
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
        //  • barSpacing — resting width; fitContent()/setVisibleRange
        //    (below, after data loads) override it.
        fixLeftEdge: true,
        lockVisibleTimeRangeOnResize: true,
        rightOffset: CHART_RIGHT_OFFSET,
        barSpacing: CHART_BAR_SPACING,
        tickMarkFormatter: (time: Time) => formatTimeAxisTick(interval, time),
      },
      crosshair: { mode: 0 },
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    // Volume is a contextual histogram, not a second right-axis value. Hide its
    // dedicated scale labels so the chart does not render a confusing `0` beside
    // the ETH price axis. It is added before candles so candle bodies/wicks paint
    // above volume bars when a low-price candle sits near the histogram.
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
      visible: false,
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
        // ETH price values can be far below 1e-8 on fresh curve launches. If
        // minMove is coarser than the token price, lightweight-charts collapses
        // the price-scale tick generation around 0 and leaves only the last-price
        // label. Use ETH's wei-level step so tiny-price axes still get ticks.
        minMove: 0.000000000000000001,
        base: 1_000_000_000_000_000_000,
        formatter: (price: number) =>
          formatPriceCompact(price, {
            sigDigits: 6,
            subscript: "unicode",
            plain: chartAxisPrice,
          }),
      },
    });
    markersRef.current = createSeriesMarkers(candle, [], { zOrder: "top" });

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
      lastTimeRef.current = null;
    };
    // Recreate on interval changes so the tick formatter and seconds-visible
    // setting always match the active time scale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, interval]);

  // Load historical data whenever the query data or interval changes → setData.
  useEffect(() => {
    const candle = candleRef.current;
    const volume = volumeRef.current;
    if (!candle || !volume) return;
    const candles = feed.data?.candles ?? [];
    const bars = toChartCandles(candles);
    const candleData = makeCandlesVisible(
      bars.map((b) => ({ ...b, time: b.time as UTCTimestamp })),
    );
    candle.setData(withSparseTimeWhitespace(candleData, interval));
    const volumeData = toChartVolumes(candles, palette).map((v) => ({
      ...v,
      time: v.time as UTCTimestamp,
    }));
    volume.setData(withSparseTimeWhitespace(volumeData, interval));
    lastTimeRef.current = bars.length ? bars[bars.length - 1]!.time : null;

    // Graduation annotation — one labeled marker at the graduation timestamp
    // (annotation, not a second series / not a data discontinuity).
    const markers: SeriesMarker<Time>[] = [];
    if (token.graduatedAt) {
      markers.push({
        time: token.graduatedAt as UTCTimestamp,
        position: "aboveBar",
        color: palette.graduation,
        shape: "arrowDown",
        text: "Graduated to Uniswap V3",
      });
    }
    markersRef.current?.setMarkers(markers);
    // Anchor left→right after (re)loading history. Docs-first (lightweight-charts
    // 5.0 ITimeScaleApi, verified 2026-07-14):
    //  • enough bars → fitContent() fills the pane from the OLDEST bar; combined
    //    with lockVisibleTimeRangeOnResize it stays filled across autoSize growth.
    //  • sparse (fresh token, few trades) → setVisibleRange pins a real time
    //    window around the latest bucket, backed by explicit interval whitespace,
    //    so the axis labels stay meaningful for every interval.
    const ts = chartRef.current?.timeScale();
    if (ts && bars.length > 0) {
      const visibleRange = sparseVisibleRange(interval, bars);
      if (visibleRange) {
        ts.setVisibleRange(visibleRange);
      } else {
        ts.fitContent();
      }
    }
  }, [feed.data, interval, palette, token.graduatedAt]);

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
