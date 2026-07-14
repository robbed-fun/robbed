import type { ConfirmationWatermarks, TradeRow } from "@robbed/shared";
import { describe, expect, it } from "vitest";

import {
  ABSENCE_ERROR_MS,
  type IndexedTradeLike,
  type SubmitInput,
  type TradeAction,
  type TradesState,
  WS_SILENCE_MS,
  createInitialTradesState,
  isBeyondSoftConfirmed,
  selectActiveTrades,
  selectTradesNeedingHeal,
  tradeDisplayState,
  tradesReducer,
} from "@/entities/trade/model/trades";

/**
 * M3-7 · web.md trade-lifecycle state machine. Each block proves one of the
 * invariants against the PURE reducer (no React, no network, deterministic).
 */

const TOKEN = "0x00000000000000000000000000000000000000aa";
const TRADER = "0x00000000000000000000000000000000000000bb";
const TX = "0x" + "ab".repeat(32);

function submitInput(over: Partial<SubmitInput> = {}): SubmitInput {
  return {
    id: over.id ?? "trade-1",
    sender: TRADER,
    token: TOKEN,
    isBuy: true,
    ethAmount: "1000000000000000000", // our optimistic estimate: 1 ETH in
    tokenAmount: "5000000000000000000000", // ~5000 tokens estimated out
    priceEth: 0.0002,
    txHash: TX,
    ...over,
  };
}

/** An indexed row (REST/WS shape) that DISAGREES with the optimistic estimate. */
function indexedRow(over: Partial<IndexedTradeLike> = {}): IndexedTradeLike {
  return {
    token: TOKEN,
    trader: TRADER,
    isBuy: true,
    ethAmount: "1000000000000000000",
    tokenAmount: "4800000000000000000000", // indexer says fewer tokens (fee/slippage/clamp)
    priceEth: 0.000208,
    blockNumber: 100,
    txHash: TX,
    confirmationState: "soft_confirmed",
    ...over,
  };
}

/** Full TradeRow (adds id/feeEth/logIndex/blockTimestamp) — proves REST rows fit IndexedTradeLike. */
function tradeRow(over: Partial<TradeRow> = {}): TradeRow {
  return {
    id: `${TX}-0`,
    token: TOKEN,
    trader: TRADER,
    venue: "curve",
    isBuy: true,
    ethAmount: "1000000000000000000",
    tokenAmount: "4800000000000000000000",
    feeEth: "10000000000000000",
    priceEth: 0.000208,
    blockNumber: 100,
    blockTimestamp: 1_700_000_000,
    txHash: TX,
    logIndex: 0,
    confirmationState: "soft_confirmed",
    ...over,
  };
}

const WM = (safeBlock: number, finalizedBlock: number): ConfirmationWatermarks => ({
  safeBlock,
  finalizedBlock,
});

/** Drive a list of actions from an initial state. */
function run(actions: TradeAction[], init?: TradesState): TradesState {
  return actions.reduce((s, a) => tradesReducer(s, a), init ?? createInitialTradesState());
}

function only(s: TradesState) {
  const t = selectActiveTrades(s)[0];
  if (!t) throw new Error("expected exactly one active trade");
  return t;
}

function byId(s: TradesState, id: string) {
  const t = s.byId[id];
  if (!t) throw new Error(`expected trade ${id}`);
  return t;
}

// ── Invariant 1: immediate render ───────────────────────────────────────────

describe(" invariant 1 — immediate render", () => {
  it("submit with a txHash inserts a pending optimistic row synchronously", () => {
    const s = run([{ type: "submit", trade: submitInput(), now: 0 }]);
    const t = only(s);
    expect(t).toBeDefined();
    expect(tradeDisplayState(t)).toBe("optimistic:pending");
    expect(t.ethAmount).toBe("1000000000000000000");
    expect(t.reconciled).toBe(false);
  });

  it("submit without a txHash renders `submitted`, then attach-hash → pending", () => {
    const s = run([
      { type: "submit", trade: submitInput({ txHash: undefined, nonce: 7 }), now: 0 },
    ]);
    expect(tradeDisplayState(only(s))).toBe("submitted");
    const s2 = tradesReducer(s, { type: "attach-hash", id: "trade-1", txHash: TX });
    expect(tradeDisplayState(only(s2))).toBe("optimistic:pending");
    expect(only(s2).txHash).toBe(TX);
  });

  it("submit is idempotent — a duplicate id never double-inserts", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "submit", trade: submitInput({ ethAmount: "999" }), now: 1 },
    ]);
    expect(selectActiveTrades(s)).toHaveLength(1);
    expect(only(s).ethAmount).toBe("1000000000000000000");
  });
});

// ── receipt paths ───────────────────────────────────────────────────────────

describe(" receipt paths", () => {
  it("receipt success ⇒ optimistic:soft-confirmed (values still OUR estimate)", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 10 },
    ]);
    const t = only(s);
    expect(tradeDisplayState(t)).toBe("optimistic:soft-confirmed");
    expect(t.reconciled).toBe(false);
    expect(t.tokenAmount).toBe("5000000000000000000000"); // unchanged estimate
    // receipt block is informational, NOT the tier source
    expect(t.receiptBlockNumber).toBe(100);
    expect(t.blockNumber).toBeNull();
  });

  it("receipt reverted ⇒ failed (row kept as error, not dropped)", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "reverted", now: 10 },
    ]);
    const t = only(s);
    expect(tradeDisplayState(t)).toBe("failed");
    expect(t.error).toBe("Transaction reverted");
    expect(selectActiveTrades(s)).toHaveLength(1);
  });

  it("wallet reject ⇒ removed (toast) and filtered from the active feed", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "reject", id: "trade-1" },
    ]);
    expect(selectActiveTrades(s)).toHaveLength(0);
    expect(tradeDisplayState(byId(s, "trade-1"))).toBe("removed");
  });
});

// ── Invariant 2: reconcile, never trust self ────────────────────────────────

describe(" invariant 2 — reconcile REPLACES optimistic values with indexed truth", () => {
  it("WS trade replaces amounts/price with indexed values", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 10 },
      { type: "ws-trade", row: indexedRow(), now: 20 },
    ]);
    const t = only(s);
    expect(t.reconciled).toBe(true);
    expect(tradeDisplayState(t)).toBe("indexed:soft-confirmed");
    // optimistic 5000e18 REPLACED by indexed 4800e18
    expect(t.tokenAmount).toBe("4800000000000000000000");
    expect(t.priceEth).toBe(0.000208);
  });

  it("a REST TradeRow reconciles identically (shape parity)", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 10 },
      { type: "rest-heal", txHash: TX, rows: [tradeRow()], now: 20 },
    ]);
    expect(only(s).tokenAmount).toBe("4800000000000000000000");
    expect(only(s).reconciled).toBe(true);
  });

  it("a WS trade for an untracked/foreign txHash is a no-op (referentially)", () => {
    const s0 = run([{ type: "submit", trade: submitInput(), now: 0 }]);
    const s1 = tradesReducer(s0, {
      type: "ws-trade",
      row: indexedRow({ txHash: "0x" + "cd".repeat(32) }),
      now: 5,
    });
    expect(s1).toBe(s0);
  });

  it("a same-tx opposite-side row does not cross-reconcile", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 10 },
      { type: "ws-trade", row: indexedRow({ isBuy: false }), now: 20 },
    ]);
    expect(only(s).reconciled).toBe(false);
  });
});

// ── Invariant 3: never final while soft-confirmed ───────────────────────────

describe(" invariant 3 — never final (or posted) while only soft-confirmed", () => {
  it("watermark past the block does NOT upgrade an UN-reconciled optimistic row", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 10 },
      // watermark says block 100 is finalized — but the row is not reconciled yet
      { type: "watermark", watermarks: WM(100, 100) },
    ]);
    const t = only(s);
    expect(t.confirmationState).toBe("soft_confirmed");
    expect(tradeDisplayState(t)).toBe("optimistic:soft-confirmed");
    expect(isBeyondSoftConfirmed(t)).toBe(false);
  });

  it("no action sequence yields posted/finalized from an optimistic (un-reconciled) state", () => {
    // Exhaustive-ish fuzz: reorderings of receipt + watermark WITHOUT a reconcile.
    const wms: ConfirmationWatermarks[] = [WM(0, 0), WM(100, 0), WM(100, 100), WM(200, 200)];
    for (const wm of wms) {
      const s = run([
        { type: "submit", trade: submitInput(), now: 0 },
        { type: "watermark", watermarks: wm },
        { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 10 },
        { type: "watermark", watermarks: wm },
        { type: "tick", now: 60_000 },
      ]);
      const display = tradeDisplayState(only(s));
      expect(display).not.toBe("indexed:posted-to-l1");
      expect(display).not.toBe("indexed:finalized");
    }
  });

  it("after reconcile, the SAME watermark then upgrades the row (posted → finalized)", () => {
    const base = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 10 },
      { type: "ws-trade", row: indexedRow({ blockNumber: 100 }), now: 20 },
    ]);
    expect(tradeDisplayState(only(base))).toBe("indexed:soft-confirmed");

    const posted = tradesReducer(base, { type: "watermark", watermarks: WM(100, 50) });
    expect(tradeDisplayState(only(posted))).toBe("indexed:posted-to-l1");

    const finalized = tradesReducer(posted, { type: "watermark", watermarks: WM(150, 100) });
    expect(tradeDisplayState(only(finalized))).toBe("indexed:finalized");
  });

  it("tiers are monotonic — a regressing watermark never downgrades a finalized row", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 10 },
      { type: "ws-trade", row: indexedRow({ blockNumber: 100 }), now: 20 },
      { type: "watermark", watermarks: WM(150, 100) }, // finalized
      { type: "watermark", watermarks: WM(0, 0) }, // regression (should not downgrade)
    ]);
    expect(tradeDisplayState(only(s))).toBe("indexed:finalized");
  });

  it("reconcile derives the tier from the stored watermark immediately (arrival after advance)", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 10 },
      { type: "watermark", watermarks: WM(200, 200) }, // watermark already ahead
      { type: "ws-trade", row: indexedRow({ blockNumber: 100 }), now: 20 }, // now reconcile
    ]);
    // block 100 ≤ finalizedBlock 200 ⇒ finalized on the reconcile itself
    expect(tradeDisplayState(only(s))).toBe("indexed:finalized");
  });
});

// ── Invariant 4: never drop on contradiction ────────────────────────────────

describe(" invariant 4 — contradiction UPDATES, never drops", () => {
  it("a contradicting indexed row updates values + shimmers, keeps the row", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 10 },
      // graduation-clamp partial fill: far fewer tokens than estimated
      { type: "ws-trade", row: indexedRow({ tokenAmount: "1000000000000000000000" }), now: 20 },
    ]);
    expect(selectActiveTrades(s)).toHaveLength(1);
    const t = only(s);
    expect(t.tokenAmount).toBe("1000000000000000000000");
    expect(t.justUpdated).toBe(true); // shimmer flag set on a contradiction
  });

  it("shimmer clears after JUST_UPDATED_MS on tick; row persists", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 10 },
      { type: "ws-trade", row: indexedRow({ tokenAmount: "1000000000000000000000" }), now: 20 },
      { type: "tick", now: 20 + 5_000 },
    ]);
    const t = only(s);
    expect(t.justUpdated).toBe(false);
    expect(selectActiveTrades(s)).toHaveLength(1);
  });

  it("a reconcile with identical amounts does NOT shimmer", () => {
    const s = run([
      { type: "submit", trade: submitInput({ tokenAmount: "4800000000000000000000" }), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 10 },
      { type: "ws-trade", row: indexedRow(), now: 20 }, // same 4800e18
    ]);
    expect(only(s).justUpdated).toBe(false);
    expect(only(s).reconciled).toBe(true);
  });
});

// ── WS silence → REST-heal ─────────────────────────────────────────────

describe(" WS silence — keep the row, REST-heal, escalate only on confirmed absence", () => {
  it("no WS within WS_SILENCE_MS → awaitingIndex, row kept, flagged for heal", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 0 },
      { type: "tick", now: WS_SILENCE_MS + 1 },
    ]);
    const t = only(s);
    expect(t.awaitingIndex).toBe(true);
    expect(tradeDisplayState(t)).toBe("optimistic:soft-confirmed"); // still soft, not failed
    expect(selectTradesNeedingHeal(s)).toHaveLength(1);
  });

  it("REST-heal that finds the trade reconciles it and clears awaitingIndex", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 0 },
      { type: "tick", now: WS_SILENCE_MS + 1 },
      { type: "rest-heal", txHash: TX, rows: [tradeRow()], now: WS_SILENCE_MS + 2 },
    ]);
    const t = only(s);
    expect(t.reconciled).toBe(true);
    expect(t.awaitingIndex).toBe(false);
    expect(selectTradesNeedingHeal(s)).toHaveLength(0);
  });

  it("indexer-confirmed absence keeps the row (unverified) until ABSENCE_ERROR_MS, then fails", () => {
    // Empty REST heal = indexer says the tx is absent.
    const s1 = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 0 },
      { type: "tick", now: WS_SILENCE_MS + 1 },
      { type: "rest-heal", txHash: TX, rows: [], now: WS_SILENCE_MS + 2 },
    ]);
    expect(only(s1).unverified).toBe(true);
    expect(tradeDisplayState(only(s1))).toBe("optimistic:soft-confirmed"); // NOT failed yet

    // Before the 30s window: still not failed.
    const sMid = tradesReducer(s1, { type: "tick", now: ABSENCE_ERROR_MS - 1 });
    expect(tradeDisplayState(only(sMid))).toBe("optimistic:soft-confirmed");

    // Past the window: escalate to failed.
    const sLate = tradesReducer(s1, { type: "tick", now: ABSENCE_ERROR_MS + 1 });
    expect(tradeDisplayState(only(sLate))).toBe("failed");
    expect(only(sLate).error).toBe("Trade not found by indexer");
    expect(selectActiveTrades(sLate)).toHaveLength(1); // still shown, never dropped
  });

  it("a late WS trade after an absence heal still reconciles (recovers, never final-from-absence)", () => {
    const s = run([
      { type: "submit", trade: submitInput(), now: 0 },
      { type: "receipt", id: "trade-1", status: "success", blockNumber: 100n, now: 0 },
      { type: "tick", now: WS_SILENCE_MS + 1 },
      { type: "rest-heal", txHash: TX, rows: [], now: WS_SILENCE_MS + 2 },
      { type: "ws-trade", row: indexedRow(), now: WS_SILENCE_MS + 3 },
    ]);
    const t = only(s);
    expect(t.reconciled).toBe(true);
    expect(t.unverified).toBe(false);
    expect(tradeDisplayState(t)).toBe("indexed:soft-confirmed");
  });
});

// ── watermark upgrade of multiple held rows (O(1) broadcast) ──────────

describe(" watermark broadcast upgrades every held row locally", () => {
  it("one watermark advance posts/finalizes all reconciled rows at once", () => {
    const s = run([
      { type: "submit", trade: submitInput({ id: "a" }), now: 0 },
      { type: "receipt", id: "a", status: "success", blockNumber: 100n, now: 1 },
      { type: "ws-trade", row: indexedRow({ blockNumber: 100 }), now: 2 },
      {
        type: "submit",
        trade: submitInput({ id: "b", txHash: "0x" + "ef".repeat(32) }),
        now: 3,
      },
      { type: "receipt", id: "b", status: "success", blockNumber: 90n, now: 4 },
      {
        type: "ws-trade",
        row: indexedRow({ txHash: "0x" + "ef".repeat(32), blockNumber: 90 }),
        now: 5,
      },
      { type: "watermark", watermarks: WM(150, 95) },
    ]);
    // block 90 ≤ finalizedBlock 95 ⇒ finalized; block 100 ≤ safeBlock 150 ⇒ posted
    expect(tradeDisplayState(byId(s, "a"))).toBe("indexed:posted-to-l1");
    expect(tradeDisplayState(byId(s, "b"))).toBe("indexed:finalized");
  });
});
