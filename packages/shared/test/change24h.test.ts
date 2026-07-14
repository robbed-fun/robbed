/**
 * 24h change anchor selection (indexer.md).
 *
 * anchorPrice = close of the most-recent 1h candle at/before now−24h;
 * token age < 24h → first-trade price; no trades → change 0.
 */
import { describe, expect, it } from "bun:test";
import { computeChange24hPct, selectAnchorPrice, type AnchorCandle } from "../src/change24h";

const HOUR = 3_600;
const DAY = 86_400;
const NOW = 1_000_000_000; // fixed "now" for deterministic buckets
const CUTOFF = NOW - DAY;

/** Build a 1h candle at a given bucket start with a given close. */
function candle(bucketStart: number, close: number): AnchorCandle {
  return { bucket_start: bucketStart, close };
}

describe("selectAnchorPrice ", () => {
  it("picks the CLOSE of the most-recent 1h candle at or before now−24h", () => {
    const candles = [
      candle(CUTOFF - 2 * HOUR, 1.0),
      candle(CUTOFF - 1 * HOUR, 2.0), // most-recent at/before cutoff → anchor
      candle(CUTOFF + 1 * HOUR, 9.0), // inside last 24h → ignored
    ];
    const anchor = selectAnchorPrice({
      nowSec: NOW,
      lastPrice: 3.0,
      firstTradePrice: 0.5,
      createdAtSec: NOW - 5 * DAY, // old token → candle branch
      hourCandles: candles,
    });
    expect(anchor).toBe(2.0);
  });

  it("includes a candle whose bucket starts exactly at the cutoff", () => {
    const anchor = selectAnchorPrice({
      nowSec: NOW,
      lastPrice: 3.0,
      firstTradePrice: 0.5,
      createdAtSec: NOW - 5 * DAY,
      hourCandles: [candle(CUTOFF, 7.0), candle(CUTOFF + HOUR, 8.0)],
    });
    expect(anchor).toBe(7.0);
  });

  it("uses the first-trade price when the token is younger than 24h", () => {
    const anchor = selectAnchorPrice({
      nowSec: NOW,
      lastPrice: 3.0,
      firstTradePrice: 0.5,
      createdAtSec: NOW - 6 * HOUR, // < 24h old
      hourCandles: [candle(NOW - 5 * HOUR, 2.0)], // no candle before cutoff anyway
    });
    expect(anchor).toBe(0.5);
  });

  it("falls back to first-trade price for a ≥24h token with no candle before the cutoff", () => {
    // Created 30h ago but first traded 10h ago → no 1h bucket at/before cutoff.
    const anchor = selectAnchorPrice({
      nowSec: NOW,
      lastPrice: 3.0,
      firstTradePrice: 1.5,
      createdAtSec: NOW - 30 * HOUR,
      hourCandles: [candle(NOW - 10 * HOUR, 2.0), candle(NOW - 2 * HOUR, 2.5)],
    });
    expect(anchor).toBe(1.5);
  });

  it("returns null when the token has never traded", () => {
    const anchor = selectAnchorPrice({
      nowSec: NOW,
      lastPrice: null,
      firstTradePrice: null,
      createdAtSec: NOW - 5 * DAY,
      hourCandles: [],
    });
    expect(anchor).toBeNull();
  });
});

describe("computeChange24hPct (display percent)", () => {
  it("computes (last − anchor)/anchor × 100 against the 24h candle close", () => {
    const pct = computeChange24hPct({
      nowSec: NOW,
      lastPrice: 3.0,
      firstTradePrice: 0.5,
      createdAtSec: NOW - 5 * DAY,
      hourCandles: [candle(CUTOFF - HOUR, 2.0)],
    });
    // (3 − 2) / 2 = 0.5 → +50%
    expect(pct).toBeCloseTo(50, 9);
  });

  it("is negative when price fell", () => {
    const pct = computeChange24hPct({
      nowSec: NOW,
      lastPrice: 1.5,
      firstTradePrice: 0.5,
      createdAtSec: NOW - 5 * DAY,
      hourCandles: [candle(CUTOFF - HOUR, 2.0)],
    });
    // (1.5 − 2) / 2 = −0.25 → −25%
    expect(pct).toBeCloseTo(-25, 9);
  });

  it("anchors to first-trade price for a young token", () => {
    const pct = computeChange24hPct({
      nowSec: NOW,
      lastPrice: 2.0,
      firstTradePrice: 1.0,
      createdAtSec: NOW - 3 * HOUR,
      hourCandles: [],
    });
    // (2 − 1) / 1 = 1 → +100%
    expect(pct).toBeCloseTo(100, 9);
  });

  it("returns 0 when the token has never traded (no-trades rule)", () => {
    const pct = computeChange24hPct({
      nowSec: NOW,
      lastPrice: null,
      firstTradePrice: null,
      createdAtSec: NOW - 5 * DAY,
      hourCandles: [],
    });
    expect(pct).toBe(0);
  });
});
