import { describe, expect, it } from "bun:test";
import type { CandleTradeInput } from "../src/candles";
import { applyTradeToInterval, bucketStartFor } from "../src/candles";

function input(p: number, ts: number, block: number, log: number, vEth = 10n, vTok = 5n): CandleTradeInput {
  return {
    tokenAddress: "0xtoken",
    price: p,
    volumeEth: vEth,
    volumeToken: vTok,
    blockNumber: block,
    blockTimestamp: ts,
    logIndex: log,
  };
}

describe("bucketStartFor — floor(ts / secs) * secs per interval", () => {
  it("floors to each interval boundary", () => {
    expect(bucketStartFor(1000, "1s")).toBe(1000);
    expect(bucketStartFor(1000, "15s")).toBe(990);
    expect(bucketStartFor(1000, "1m")).toBe(960);
    expect(bucketStartFor(1000, "5m")).toBe(900);
    expect(bucketStartFor(1000, "15m")).toBe(900);
    expect(bucketStartFor(4000, "1h")).toBe(3600);
  });
});

describe("applyTradeToInterval — OHLC upsert", () => {
  it("opens/high/low/close on first trade in a bucket", () => {
    const c = applyTradeToInterval(undefined, "1m", input(5, 120, 10, 0));
    expect([c.open, c.high, c.low, c.close]).toEqual([5, 5, 5, 5]);
    expect(c.trade_count).toBe(1);
    expect(c.volume_eth).toBe("10");
    expect(c.bucket_start).toBe(120);
  });

  it("keeps open, moves high/low/close, accumulates volume on later trades", () => {
    let c = applyTradeToInterval(undefined, "1m", input(5, 120, 10, 0));
    c = applyTradeToInterval(c, "1m", input(8, 121, 10, 1));
    c = applyTradeToInterval(c, "1m", input(3, 122, 10, 2));
    c = applyTradeToInterval(c, "1m", input(6, 123, 10, 3));
    expect(c.open).toBe(5);
    expect(c.high).toBe(8);
    expect(c.low).toBe(3);
    expect(c.close).toBe(6);
    expect(c.trade_count).toBe(4);
    expect(c.volume_eth).toBe("40");
  });

  it("high-water guard: re-applying a seen position is a no-op (idempotent)", () => {
    let c = applyTradeToInterval(undefined, "1m", input(5, 120, 10, 0));
    c = applyTradeToInterval(c, "1m", input(8, 121, 10, 1));
    const before = { ...c };
    const reapplied = applyTradeToInterval(c, "1m", input(8, 121, 10, 1)); // same (block,log)
    expect(reapplied).toEqual(before);
    // an earlier position is also skipped
    const earlier = applyTradeToInterval(c, "1m", input(999, 120, 10, 0));
    expect(earlier).toEqual(before);
  });
});
