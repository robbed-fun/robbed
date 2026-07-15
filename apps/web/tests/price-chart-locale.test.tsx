import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { tokenDetail } from "./fixtures";

const chartMocks = vi.hoisted(() => {
  const addSeries = vi.fn();
  const createChart = vi.fn();
  const setData = vi.fn();
  const update = vi.fn();

  return { addSeries, createChart, setData, update };
});

const feedMocks = vi.hoisted(() => ({
  useCandleFeed: vi.fn(),
}));

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: Symbol("CandlestickSeries"),
  ColorType: { Solid: "Solid" },
  HistogramSeries: Symbol("HistogramSeries"),
  createSeriesMarkers: vi.fn(),
  createChart: chartMocks.createChart,
}));

vi.mock("@/shared/lib/ws", () => ({
  useWsChannel: vi.fn(),
}));

vi.mock("@/widgets/price-chart/model/use-candle-feed", () => ({
  useCandleFeed: feedMocks.useCandleFeed,
}));

import { PriceChart } from "@/widgets/price-chart";

afterEach(() => {
  cleanup();
  chartMocks.addSeries.mockReset();
  chartMocks.createChart.mockReset();
  chartMocks.setData.mockReset();
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
    chartMocks.addSeries.mockReturnValue({
      setData: chartMocks.setData,
      update: chartMocks.update,
      priceScale: () => ({ applyOptions: vi.fn() }),
    });
    chartMocks.createChart.mockReturnValue({
      addSeries: chartMocks.addSeries,
      remove: vi.fn(),
      timeScale: () => ({
        fitContent: vi.fn(),
        setVisibleLogicalRange: vi.fn(),
      }),
    });

    const token = tokenDetail();
    render(<PriceChart token={token} />);

    await waitFor(() => expect(chartMocks.createChart).toHaveBeenCalled());

    expect(chartMocks.createChart.mock.calls[0]?.[1]).toMatchObject({
      localization: { locale: "en-US" },
    });
    expect(chartMocks.addSeries.mock.calls[0]?.[1]).toMatchObject({
      priceFormat: {
        minMove: 0.000000000000000001,
        base: 1_000_000_000_000_000_000,
      },
    });
    expect(feedMocks.useCandleFeed.mock.calls[0]?.[2]).toMatchObject({
      anchorSec: token.createdAt,
    });
  });
});
