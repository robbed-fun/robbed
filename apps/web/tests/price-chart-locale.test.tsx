import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { tokenDetail } from "./fixtures";

const chartMocks = vi.hoisted(() => {
  const addSeries = vi.fn();
  const createSeriesMarkers = vi.fn();
  const createChart = vi.fn();
  const priceScaleApplyOptions = vi.fn();
  const setMarkers = vi.fn();
  const setData = vi.fn();
  const update = vi.fn();

  return {
    addSeries,
    createChart,
    createSeriesMarkers,
    priceScaleApplyOptions,
    setData,
    setMarkers,
    update,
  };
});

const feedMocks = vi.hoisted(() => ({
  useCandleFeed: vi.fn(),
}));

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: Symbol("CandlestickSeries"),
  ColorType: { Solid: "Solid" },
  HistogramSeries: Symbol("HistogramSeries"),
  createSeriesMarkers: chartMocks.createSeriesMarkers,
  createChart: chartMocks.createChart,
}));

vi.mock("@/shared/lib/ws", () => ({
  useWsChannel: vi.fn(),
}));

vi.mock("@/widgets/price-chart/model/use-candle-feed", () => ({
  useCandleFeed: feedMocks.useCandleFeed,
}));

import { PriceChart } from "@/widgets/price-chart";

function mockChartShell() {
  chartMocks.addSeries.mockReturnValue({
    setData: chartMocks.setData,
    update: chartMocks.update,
    priceScale: () => ({ applyOptions: chartMocks.priceScaleApplyOptions }),
  });
  chartMocks.createChart.mockReturnValue({
    addSeries: chartMocks.addSeries,
    remove: vi.fn(),
    timeScale: () => ({
      fitContent: vi.fn(),
      setVisibleRange: vi.fn(),
      setVisibleLogicalRange: vi.fn(),
    }),
  });
  chartMocks.createSeriesMarkers.mockReturnValue({
    detach: vi.fn(),
    markers: vi.fn(() => []),
    setMarkers: chartMocks.setMarkers,
  });
}

afterEach(() => {
  cleanup();
  chartMocks.addSeries.mockReset();
  chartMocks.createChart.mockReset();
  chartMocks.createSeriesMarkers.mockReset();
  chartMocks.priceScaleApplyOptions.mockReset();
  chartMocks.setData.mockReset();
  chartMocks.setMarkers.mockReset();
  chartMocks.update.mockReset();
  feedMocks.useCandleFeed.mockReset();
});

describe("<PriceChart> localization", () => {
  it("pins a valid chart locale instead of passing through navigator.language", async () => {
    feedMocks.useCandleFeed.mockReturnValue({
      data: {
        candles: [
          {
            bucketStart: 1_784_122_680,
            open: 2.1e-12,
            high: 2.1e-12,
            low: 2.1e-12,
            close: 2.1e-12,
            volumeEth: "100000000000000",
            volumeToken: "48876151567176353339611438",
            tradeCount: 1,
          },
        ],
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockChartShell();

    const token = tokenDetail();
    render(<PriceChart token={token} />);

    await waitFor(() => expect(chartMocks.createChart).toHaveBeenCalled());

    expect(chartMocks.createChart.mock.calls[0]?.[1]).toMatchObject({
      localization: { locale: "en-US" },
    });
    expect(chartMocks.addSeries.mock.calls[0]?.[1]).toMatchObject({
      lastValueVisible: false,
      priceLineVisible: false,
      priceFormat: { type: "volume" },
    });
    expect(chartMocks.addSeries.mock.calls[1]?.[1]).toMatchObject({
      priceFormat: {
        minMove: 0.000000000000000001,
        base: 1_000_000_000_000_000_000,
      },
    });
    expect(chartMocks.addSeries.mock.calls[1]?.[1].priceFormat.formatter(1.900887024e-9)).toBe(
      "0.0₈190089",
    );
    expect(chartMocks.createChart.mock.calls[0]?.[1].timeScale.tickMarkFormatter(1_784_190_144)).toBe(
      "08:22",
    );
    expect(chartMocks.priceScaleApplyOptions).toHaveBeenCalledWith({
      scaleMargins: { top: 0.85, bottom: 0 },
      visible: false,
    });
    expect(feedMocks.useCandleFeed.mock.calls[0]?.[2]).toMatchObject({
      anchorSec: token.createdAt,
    });
  });

  it("does not trust an empty SSR candle seed when a token already has a price", () => {
    feedMocks.useCandleFeed.mockReturnValue({
      data: { candles: [] },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockChartShell();

    const token = tokenDetail({ priceEth: 0.000000001 });
    render(
      <PriceChart
        token={token}
        initialCandles={{ candles: [] }}
        activityAnchorSec={1_784_157_865}
      />,
    );

    const options = feedMocks.useCandleFeed.mock.calls[0]?.[2];
    expect(options?.initialData).toBeUndefined();
    expect(options?.anchorSec).toBe(1_784_157_865);
  });

  it("keeps an empty SSR candle seed for a never-traded token", () => {
    feedMocks.useCandleFeed.mockReturnValue({
      data: { candles: [] },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockChartShell();

    const emptySeed = { candles: [] };
    const token = tokenDetail({ priceEth: null });
    render(<PriceChart token={token} initialCandles={emptySeed} />);

    expect(feedMocks.useCandleFeed.mock.calls[0]?.[2].initialData).toBe(emptySeed);
  });

  it("expands sparse flat buckets into visible candle bodies", async () => {
    feedMocks.useCandleFeed.mockReturnValue({
      data: {
        candles: [
          {
            bucketStart: 1_784_190_060,
            open: 1.899047701e-9,
            high: 1.899047701e-9,
            low: 1.899047701e-9,
            close: 1.899047701e-9,
            volumeEth: "1000000000000000",
            volumeToken: "526580667686309942591783",
            tradeCount: 1,
          },
          {
            bucketStart: 1_784_190_120,
            open: 1.900887024e-9,
            high: 1.900887024e-9,
            low: 1.900887024e-9,
            close: 1.900887024e-9,
            volumeEth: "1000000000000000",
            volumeToken: "526071187187119817425513",
            tradeCount: 1,
          },
        ],
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockChartShell();

    render(<PriceChart token={tokenDetail()} />);

    await waitFor(() => expect(chartMocks.setData).toHaveBeenCalledTimes(2));
    type CandleDatum = { open: number; high: number; low: number; close: number };
    const rawData = chartMocks.setData.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(rawData.some((point) => !("close" in point))).toBe(true);
    const candleData = rawData.filter((point): point is CandleDatum => "close" in point);
    expect(candleData).toHaveLength(2);
    const first = candleData[0];
    const second = candleData[1];
    if (!first || !second) throw new Error("expected two fulfilled candles");
    expect(first.close).toBe(1.899047701e-9);
    expect(first.open).toBeLessThan(first.close);
    expect(first.high).toBeGreaterThan(first.close);
    expect(first.low).toBeLessThan(first.open);
    expect(second.close).toBe(1.900887024e-9);
    expect(second.open).toBeLessThan(second.close);
    expect(second.high).toBeGreaterThan(second.close);
    expect(second.low).toBeLessThan(second.open);
  });
});
