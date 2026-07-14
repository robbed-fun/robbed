/**
 * Venue-continuity across a simulated graduation + rebuild byte-equality
 * (indexer.md, DoD). Exercises the SAME pure engines the handlers and
 * the `rebuild` script use, so the properties proven here hold in production.
 */
import { describe, expect, it } from "bun:test";
import { CandleStore } from "../src/candles";
import { BalanceLedger } from "../src/balances";
import { replay } from "../scripts/rebuild";

const TOKEN = "0xtoken";
const A = "0x" + "a1".repeat(20);
const B = "0x" + "b2".repeat(20);
const ZERO = "0x" + "00".repeat(20);

// Curve trades (venue=curve) then V3 swaps (venue=v3) — one price series.
const trades = [
  { token: TOKEN, trader: A, venue: "curve", isBuy: true, ethAmount: 100n, tokenAmount: 10n, feeEth: 1n, price: 1.0, block: 1, ts: 100, log: 0 },
  { token: TOKEN, trader: A, venue: "curve", isBuy: true, ethAmount: 200n, tokenAmount: 20n, feeEth: 2n, price: 2.0, block: 2, ts: 101, log: 0 },
  { token: TOKEN, trader: B, venue: "curve", isBuy: false, ethAmount: 150n, tokenAmount: 5n, feeEth: 1n, price: 3.0, block: 3, ts: 102, log: 0 },
  // ── graduation boundary (no candle) ──
  { token: TOKEN, trader: B, venue: "v3", isBuy: true, ethAmount: 90n, tokenAmount: 3n, feeEth: 0n, price: 3.1, block: 4, ts: 103, log: 0 },
  { token: TOKEN, trader: A, venue: "v3", isBuy: false, ethAmount: 120n, tokenAmount: 4n, feeEth: 0n, price: 3.5, block: 5, ts: 104, log: 0 },
];

// Transfers (sole balance truth): mint to curve-buyer A, then A→B, plus a burn.
const transfers = [
  { token: TOKEN, from: ZERO, to: A, value: 30n, block: 1, ts: 100, log: 1 },
  { token: TOKEN, from: A, to: B, value: 10n, block: 3, ts: 102, log: 1 },
  { token: TOKEN, from: B, to: ZERO, value: 2n, block: 6, ts: 105, log: 0 },
];

describe("venue-continuous candle series across graduation", () => {
  it("produces ONE unbroken 1s series spanning curve → v3, no gap/reset/null", () => {
    const store = new CandleStore();
    for (const t of trades) {
      store.apply({
        tokenAddress: t.token,
        price: t.price,
        volumeEth: t.ethAmount,
        volumeToken: t.tokenAmount,
        blockNumber: t.block,
        blockTimestamp: t.ts,
        logIndex: t.log,
      });
    }
    const series = store.series(TOKEN, "1s");
    // five 1s buckets (one per trade ts 100..104), strictly increasing, no nulls.
    expect(series.map((c) => c.bucket_start)).toEqual([100, 101, 102, 103, 104]);
    // last curve bucket closes at 3.0; first v3 bucket opens at 3.1 → continuous.
    expect(series[2]!.close).toBe(3.0); // ts 102, curve
    expect(series[3]!.open).toBe(3.1); // ts 103, v3 — no reset to 0/null
    // every bucket has a defined OHLC (no synthetic zero bucket at the boundary).
    for (const c of series) {
      expect(Number.isFinite(c.open)).toBe(true);
      expect(c.open).toBeGreaterThan(0);
    }
  });

  it("aggregates curve+v3 into the same 1h bucket (venue-agnostic)", () => {
    const store = new CandleStore();
    for (const t of trades) {
      store.apply({
        tokenAddress: t.token, price: t.price, volumeEth: t.ethAmount, volumeToken: t.tokenAmount,
        blockNumber: t.block, blockTimestamp: t.ts, logIndex: t.log,
      });
    }
    const h = store.series(TOKEN, "1h");
    expect(h).toHaveLength(1); // ts 100..104 all fall in one hour bucket
    expect(h[0]!.open).toBe(1.0); // first curve trade
    expect(h[0]!.close).toBe(3.5); // last v3 trade
    expect(h[0]!.high).toBe(3.5);
    expect(h[0]!.low).toBe(1.0);
    expect(h[0]!.trade_count).toBe(5);
    expect(h[0]!.volume_eth).toBe("660"); // 100+200+150+90+120
  });
});

describe("rebuild == incremental (byte-equal from raw events)", () => {
  it("candles + balances from `replay` match an in-order incremental pass", () => {
    // Incremental reference: apply merged events in (block,log) order.
    const merged = [
      ...trades.map((t) => ({ kind: "trade" as const, ...t })),
      ...transfers.map((t) => ({ kind: "transfer" as const, ...t })),
    ].sort((a, b) => (a.block !== b.block ? a.block - b.block : a.log - b.log));

    const incCandles = new CandleStore();
    const incLedger = new BalanceLedger();
    for (const ev of merged) {
      if (ev.kind === "trade") {
        incCandles.apply({
          tokenAddress: ev.token, price: ev.price, volumeEth: ev.ethAmount, volumeToken: ev.tokenAmount,
          blockNumber: ev.block, blockTimestamp: ev.ts, logIndex: ev.log,
        });
        if (ev.isBuy) incLedger.applyCostBasisBuy(ev.token, ev.trader, ev.tokenAmount, ev.ethAmount, ev.ts);
        else incLedger.applyCostBasisSell(ev.token, ev.trader, ev.tokenAmount, ev.ethAmount - ev.feeEth, ev.ts);
      } else {
        incLedger.applyTransfer(ev.token, ev.from, ev.to, ev.value, ev.ts);
      }
    }

    const rebuilt = replay(trades, transfers);

    expect(rebuilt.candles.rows()).toEqual(incCandles.rows());
    expect(rebuilt.ledger.entries()).toEqual(incLedger.entries());
  });

  it("duplicate raw events do not corrupt derived candles (high-water no-op)", () => {
    const once = replay(trades, transfers);
    const withDup = replay([...trades, trades[2]!], transfers); // replay a dup trade
    expect(withDup.candles.rows()).toEqual(once.candles.rows());
  });
});
