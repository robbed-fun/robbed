import type { Candle } from "@robbed/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Data-window anchoring for the price chart (design-decisions D-72). Two bugs on
 * the interval buttons were fixed:
 *   • the REST backfill window trailed `now`, so short intervals showed a
 *     false-empty chart for an idle token whose last trade is older than the
 *     window — even though `5m/15m/1h` rendered it;
 * these units pin the pure window math + the two-phase `loadCandles` fallback.
 * (Bug 1 — the SSR seed suppressing per-interval fetches — is pinned in
 * use-candle-feed.test.tsx.)
 */

// Mock ONLY `getCandles` — the single `@/shared/api` symbol `candles.ts` imports.
const { getCandles } = vi.hoisted(() => ({ getCandles: vi.fn() }));
vi.mock("@/shared/api", () => ({ getCandles }));

import {
  candleWindow,
  lastActivityAnchor,
  loadCandles,
} from "@/widgets/price-chart/model/candles";

function candle(bucketStart: number): Candle {
  return {
    bucketStart,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volumeEth: "1000000000000000000",
    volumeToken: "1000000000000000000000",
    tradeCount: 1,
  };
}

const ADDR = "0x00000000000000000000000000000000000000aa";
const NOW_MS = 1_800_000_000_000; // → nowSec 1_800_000_000
const NOW_SEC = 1_800_000_000;

beforeEach(() => getCandles.mockReset());

describe("candleWindow — trailing vs data-anchored (D-72)", () => {
  it("now-anchored: 400 bars ending exactly at now", () => {
    const w = candleWindow("1m", { now: NOW_MS });
    expect(w.to).toBe(NOW_SEC);
    expect(w.to - w.from).toBe(60 * 400);
  });

  it("data-anchored: right edge = anchor + one bucket, still 400 bars, covers the anchor bucket", () => {
    const anchorSec = 1_783_987_520; // CNRY's only trade
    const w = candleWindow("1s", { anchorSec });
    expect(w.to).toBe(anchorSec + 1); // one bucket of headroom
    expect(w.to - w.from).toBe(1 * 400);
    // the trade's bucket sits inside the inclusive [from, to] range the API returns
    expect(anchorSec).toBeGreaterThanOrEqual(w.from);
    expect(anchorSec).toBeLessThanOrEqual(w.to);
  });

  it("data-anchored on a wider interval keeps the 400-bar span", () => {
    const w = candleWindow("1h", { anchorSec: 1_783_987_520 });
    expect(w.to - w.from).toBe(3600 * 400);
  });
});

describe("lastActivityAnchor — best last-activity proxy on the wire (D-72)", () => {
  it("prefers graduatedAt when present", () => {
    expect(lastActivityAnchor({ createdAt: 100, graduatedAt: 900 })).toBe(900);
  });
  it("falls back to createdAt for a pre-grad token", () => {
    expect(lastActivityAnchor({ createdAt: 100, graduatedAt: undefined })).toBe(100);
  });
});

describe("loadCandles — two-phase data-anchored fallback (D-72)", () => {
  it("live window non-empty → returns it, no fallback fetch (active token unchanged)", async () => {
    getCandles.mockResolvedValueOnce({ candles: [candle(NOW_SEC - 30)] });
    const res = await loadCandles(ADDR, "1m", { anchorSec: 1_783_987_520, now: NOW_MS });
    expect(res.candles).toHaveLength(1);
    expect(getCandles).toHaveBeenCalledTimes(1);
    // Phase 1 fetched the NOW-trailing window.
    expect(getCandles.mock.calls[0]![2]).toEqual({ to: NOW_SEC, from: NOW_SEC - 60 * 400 });
  });

  it("live window empty + anchor behind it → Phase 2 re-fetches the anchored window", async () => {
    const anchorSec = 1_783_987_520; // ~16h before now — the idle-token case
    getCandles
      .mockResolvedValueOnce({ candles: [] }) // Phase 1 (now) — false-empty
      .mockResolvedValueOnce({ candles: [candle(anchorSec)] }); // Phase 2 (anchored) — the real candle
    const res = await loadCandles(ADDR, "1s", { anchorSec, now: NOW_MS });
    expect(res.candles).toHaveLength(1);
    expect(res.candles[0]!.bucketStart).toBe(anchorSec);
    expect(getCandles).toHaveBeenCalledTimes(2);
    expect(getCandles.mock.calls[1]![2]).toEqual({ to: anchorSec + 1, from: anchorSec + 1 - 400 });
  });

  it("live window empty + no anchor → returns empty with a single fetch", async () => {
    getCandles.mockResolvedValueOnce({ candles: [] });
    const res = await loadCandles(ADDR, "1m", { now: NOW_MS });
    expect(res.candles).toHaveLength(0);
    expect(getCandles).toHaveBeenCalledTimes(1);
  });

  it("live window empty but anchor already inside it (never-traded token) → no fallback", async () => {
    getCandles.mockResolvedValueOnce({ candles: [] });
    const res = await loadCandles(ADDR, "1m", { anchorSec: NOW_SEC - 100, now: NOW_MS });
    expect(res.candles).toHaveLength(0);
    expect(getCandles).toHaveBeenCalledTimes(1);
  });
});
