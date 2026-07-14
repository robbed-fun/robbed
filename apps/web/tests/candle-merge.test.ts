import type { Candle, WsCandleData } from "@robbed/shared";
import { describe, expect, it } from "vitest";

import {
  isApplicableUpdate,
  toChartCandles,
  wsCandleToBar,
} from "@/widgets/price-chart/model/candles";

/**
 * Venue-continuous chart data. ONE series across graduation → the frontend
 * only needs to keep the data ascending + unique (lightweight-charts requires it);
 * the merge of curve + V3 events already happened in the indexer.
 */

function candle(over: Partial<Candle> = {}): Candle {
  return {
    bucketStart: 100,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volumeEth: "1000000000000000000",
    volumeToken: "1000000000000000000000",
    tradeCount: 3,
    ...over,
  };
}

describe("toChartCandles — one ascending, de-duplicated series (no venue seam)", () => {
  it("sorts by bucket and keeps a single bar per bucket (last wins)", () => {
    const bars = toChartCandles([
      candle({ bucketStart: 300, close: 3 }),
      candle({ bucketStart: 100, close: 1 }),
      candle({ bucketStart: 200, close: 2 }),
      candle({ bucketStart: 200, close: 2.5 }), // duplicate bucket → last wins
    ]);
    expect(bars.map((b) => b.time)).toEqual([100, 200, 300]);
    expect(bars[1]!.close).toBe(2.5);
  });

  it("produces continuous data across a graduation timestamp (no gap/second series)", () => {
    // curve buckets then v3 buckets — merged by the indexer, rendered as one run.
    const bars = toChartCandles([
      candle({ bucketStart: 100 }),
      candle({ bucketStart: 160 }), // graduation happens here
      candle({ bucketStart: 220 }),
    ]);
    expect(bars).toHaveLength(3);
    expect(bars.map((b) => b.time)).toEqual([100, 160, 220]);
  });
});

describe("wsCandleToBar + isApplicableUpdate — realtime series.update()", () => {
  const ws: WsCandleData = {
    token: "0x00000000000000000000000000000000000000aa",
    interval: "1m",
    bucketStart: 400,
    open: 1,
    high: 2,
    low: 1,
    close: 1.8,
    volumeEth: "2000000000000000000",
    tradeCount: 5,
  };

  it("maps a WS candle to a single bar + volume", () => {
    const { candle: bar, volume } = wsCandleToBar(ws);
    expect(bar).toEqual({ time: 400, open: 1, high: 2, low: 1, close: 1.8 });
    expect(volume).toBe(2);
  });

  it("only applies forward/current updates; stale bars trigger a refetch instead", () => {
    const { candle: bar } = wsCandleToBar(ws);
    expect(isApplicableUpdate(bar, null)).toBe(true); // empty series
    expect(isApplicableUpdate(bar, 400)).toBe(true); // same bucket → update
    expect(isApplicableUpdate(bar, 350)).toBe(true); // newer bucket → append
    expect(isApplicableUpdate(bar, 500)).toBe(false); // older than last → refetch
  });
});
