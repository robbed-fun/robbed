/**
 * Optimistic trade lifecycle reducer (M3-7 · web.md §4 · spec §2.1/§12.20).
 *
 * PURE, framework-agnostic core — no React, no viem runtime, no network. It is
 * the single state machine every trade surface (TradeWidget result, TradeFeed
 * rows, Launch stepper) runs on. The thin React binding lives in
 * `lib/use-optimistic-trades.tsx`; keeping this file pure means it is trivially
 * unit-testable (tests/trade-reducer.test.ts) and SSR-safe.
 *
 * The §4 state machine (node names preserved as `TradeDisplayState`):
 *
 *   submitted ──reject──▶ removed
 *      │ txHash
 *      ▼
 *   optimistic:pending ──receipt reverted──▶ failed
 *      │ receipt success (FCFS inclusion ⇒ soft-confirmed, sub-second)
 *      ▼
 *   optimistic:soft-confirmed        (values are still OUR estimate)
 *      │ WS/REST `trade` with matching txHash
 *      ▼
 *   indexed:soft-confirmed           (RECONCILED — amounts/price REPLACED by indexed truth)
 *      │ O(1) `confirmations` watermark broadcast (§12.20): blockNumber ≤ safeBlock ⇒ posted;
 *      │ ≤ finalizedBlock ⇒ finalized. Derived LOCALLY from the watermark + the trade's
 *      │ INDEXED block — never a per-row WS message.
 *      ▼
 *   indexed:posted-to-l1 ──▶ indexed:finalized
 *
 * The four invariants this file exists to guarantee (proven in trade-reducer.test.ts):
 *   1. Immediate render — `submit` inserts a row synchronously.
 *   2. Reconcile, never trust self — an indexed row REPLACES the optimistic
 *      amounts/price (`applyIndexedRow`); optimistic values are never promoted.
 *   3. Never final while soft-confirmed — the confirmation tier only ever
 *      advances past `soft_confirmed` for a RECONCILED entry (`deriveTier`
 *      guards on `reconciled`), and `tradeDisplayState` can only return
 *      `indexed:posted-to-l1`/`indexed:finalized` when `reconciled === true`.
 *   4. Never drop on contradiction — a contradicting indexed row UPDATES the
 *      row (with a `justUpdated` shimmer) and is never deleted; the only removal
 *      is an in-wallet reject (which never reached chain).
 *
 * DECISIONS (hoodpad-frontend; basis recorded inline — see report):
 * - Reconciliation key is `txHash` ONLY. The indexed `TradeRow`/`WsTradeData`
 *   carry NO `nonce` (packages/shared api-types.ts / ws-messages.ts), so the
 *   spec's "fallback sender+nonce" can never key a WS/REST reconcile — it is
 *   purely a client-side identity for the pre-hash `submitted` window. On chain
 *   4663 (single FCFS sequencer) the wallet returns the hash before inclusion,
 *   so `txHash` is effectively always available by the time an indexed row can
 *   exist. (Reported as a note, not a gap — txHash is sufficient.)
 * - The confirmation TIER is derived exclusively from the INDEXED block via the
 *   watermark. The RPC receipt's own `blockNumber` is self-reported and is kept
 *   only as informational `receiptBlockNumber`; it never feeds `deriveTier`.
 *   This is the strict reading of rule 2 ("never trust self") + rule 3 ("never
 *   final while soft-confirmed") — an optimistic entry can only ever sit at
 *   `soft_confirmed`, regardless of how far the watermark has advanced.
 * - Silence windows (web.md §4.5/§4.4): WS_SILENCE_MS = 10s (badge gains
 *   "awaiting index", REST poll starts), ABSENCE_ERROR_MS = 30s (escalate to
 *   `failed` ONLY after an indexer-confirmed empty `GET /v1/trades/:txHash`).
 *   The reducer only flips these flags on `tick`/`rest-heal`; the actual timer
 *   + polling live in the hook (injected, testable).
 */
import {
  type ConfirmationState,
  type ConfirmationWatermarks,
  stateForBlock,
  upgradeConfirmationState,
} from "@robbed/shared";

// ── Tunables (web.md §4.4/§4.5) ─────────────────────────────────────────────

/** WS silence before a soft-confirmed row shows "awaiting index" + REST poll starts. */
export const WS_SILENCE_MS = 10_000;
/** Indexer-confirmed absence window before escalating a soft-confirmed row to `failed`. */
export const ABSENCE_ERROR_MS = 30_000;
/** How long the "updated" shimmer stays on after a contradiction reconcile. */
export const JUST_UPDATED_MS = 1_200;

// ── Public types ────────────────────────────────────────────────────────────

/** Coarse lifecycle (internal); the §4 display node is derived, see `tradeDisplayState`. */
export type TradeLifecycle =
  | "submitted" // sent to wallet, no txHash yet
  | "pending" // txHash known, awaiting RPC receipt
  | "onchain" // receipt success — soft-confirmed; `reconciled` + `confirmationState` refine it
  | "reverted" // receipt reverted
  | "rejected" // rejected in-wallet (never reached chain)
  | "absent"; // indexer-confirmed absent past ABSENCE_ERROR_MS

/** §4 node names, exactly. This is what the UI badge + tests key off. */
export type TradeDisplayState =
  | "submitted"
  | "optimistic:pending"
  | "optimistic:soft-confirmed"
  | "indexed:soft-confirmed"
  | "indexed:posted-to-l1"
  | "indexed:finalized"
  | "failed"
  | "removed";

/**
 * Structural shape of an indexed trade — satisfied by BOTH `TradeRow` (REST,
 * api-types.ts) and `WsTradeData` (WS, ws-messages.ts) so one reconcile path
 * handles either source without redeclaring a shape (anti-drift rule 2).
 */
export interface IndexedTradeLike {
  token: string;
  trader: string;
  isBuy: boolean;
  ethAmount: string;
  tokenAmount: string;
  priceEth: number;
  blockNumber: number;
  txHash: string;
  confirmationState: ConfirmationState;
}

export interface TrackedTrade {
  /** Stable identity / React key (caller-provided; independent of txHash). */
  readonly id: string;
  /** RECONCILIATION KEY. Null only in the pre-hash `submitted` window. */
  txHash: string | null;
  readonly sender: string;
  /** Fallback identity for the pre-hash window ONLY — never a reconcile key. */
  readonly nonce: number | null;
  readonly token: string;
  readonly isBuy: boolean;

  /** Displayed amount — OPTIMISTIC estimate until `reconciled`, then indexed truth (wei string). */
  ethAmount: string;
  tokenAmount: string;
  priceEth: number | null;

  lifecycle: TradeLifecycle;
  /** True once an indexed row has replaced the optimistic estimate. */
  reconciled: boolean;
  /** Tier — only ever advances past `soft_confirmed` when `reconciled` (invariant 3). */
  confirmationState: ConfirmationState;
  /** INDEXED block (drives watermark tiers). Null until reconciled. */
  blockNumber: number | null;
  /** RPC-receipt block — informational only, NEVER fed to `deriveTier` (never-trust-self). */
  receiptBlockNumber: number | null;

  /** Brief shimmer after a contradiction reconcile. */
  justUpdated: boolean;
  justUpdatedAt: number | null;
  /** WS silence ≥ WS_SILENCE_MS with no reconcile → "awaiting index". */
  awaitingIndex: boolean;
  /** An indexer-confirmed empty REST heal seen while receipt was success → "unverified — awaiting indexer". */
  unverified: boolean;
  /** Error message when lifecycle is `reverted`/`absent`. */
  error: string | null;

  readonly submittedAt: number;
  /** Entered optimistic:soft-confirmed (receipt success). Drives both silence timers. */
  softConfirmedAt: number | null;
}

export interface TradesState {
  readonly order: readonly string[];
  readonly byId: Readonly<Record<string, TrackedTrade>>;
  readonly watermarks: ConfirmationWatermarks;
}

// ── Actions ─────────────────────────────────────────────────────────────────

export interface SubmitInput {
  id: string;
  sender: string;
  token: string;
  isBuy: boolean;
  /** Optimistic estimate to render immediately (wei strings). */
  ethAmount: string;
  tokenAmount: string;
  priceEth?: number;
  nonce?: number;
  /** Usually available immediately from `writeContractAsync`. */
  txHash?: string;
}

export type TradeAction =
  | { type: "submit"; trade: SubmitInput; now?: number }
  | { type: "attach-hash"; id: string; txHash: string }
  | { type: "reject"; id: string }
  | {
      type: "receipt";
      id: string;
      status: "success" | "reverted";
      blockNumber?: number | bigint;
      now?: number;
    }
  /** A WS or REST indexed trade — reconcile by txHash. Ignored if untracked. */
  | { type: "ws-trade"; row: IndexedTradeLike; now?: number }
  /** GET /v1/trades/:txHash result (REST-heal). Empty `rows` = indexer-confirmed absence. */
  | { type: "rest-heal"; txHash: string; rows: readonly IndexedTradeLike[]; now?: number }
  /** O(1) confirmations watermark broadcast (§12.20) — upgrade every held row locally. */
  | { type: "watermark"; watermarks: ConfirmationWatermarks }
  /** Drives the silence timers + shimmer expiry. */
  | { type: "tick"; now: number };

// ── Helpers ─────────────────────────────────────────────────────────────────

const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Tier derivation — the ONLY place a trade's confirmation tier is computed.
 * Guarded on `reconciled` + indexed `blockNumber`: an optimistic (self-reported)
 * entry is pinned at `soft_confirmed` no matter how far the watermark advanced
 * (invariant 3). Monotonic via `upgradeConfirmationState` (never downgrades).
 */
function deriveTier(t: TrackedTrade, w: ConfirmationWatermarks): ConfirmationState {
  if (!t.reconciled || t.blockNumber === null) return "soft_confirmed";
  return upgradeConfirmationState(t.confirmationState, stateForBlock(t.blockNumber, w));
}

/** Map internal lifecycle + tier → the §4 display node. */
export function tradeDisplayState(t: TrackedTrade): TradeDisplayState {
  switch (t.lifecycle) {
    case "submitted":
      return "submitted";
    case "pending":
      return "optimistic:pending";
    case "rejected":
      return "removed";
    case "reverted":
    case "absent":
      return "failed";
    case "onchain": {
      if (!t.reconciled) return "optimistic:soft-confirmed";
      switch (t.confirmationState) {
        case "soft_confirmed":
          return "indexed:soft-confirmed";
        case "posted_to_l1":
          return "indexed:posted-to-l1";
        case "finalized":
          return "indexed:finalized";
      }
    }
  }
}

/** True for any state that renders a settlement claim past soft-confirmed. */
export function isBeyondSoftConfirmed(t: TrackedTrade): boolean {
  const s = tradeDisplayState(t);
  return s === "indexed:posted-to-l1" || s === "indexed:finalized";
}

// ── Reducer ─────────────────────────────────────────────────────────────────

export function createInitialTradesState(
  watermarks: ConfirmationWatermarks = { safeBlock: 0, finalizedBlock: 0 },
): TradesState {
  return { order: [], byId: {}, watermarks };
}

function patch(state: TradesState, id: string, next: TrackedTrade): TradesState {
  return { ...state, byId: { ...state.byId, [id]: next } };
}

/** Find the tracked entry whose txHash matches a row (case-insensitive). */
function findByTxHash(state: TradesState, txHash: string): TrackedTrade | undefined {
  for (const id of state.order) {
    const t = state.byId[id];
    if (t && t.txHash && eq(t.txHash, txHash)) return t;
  }
  return undefined;
}

/**
 * Reconcile a tracked entry to an indexed row: REPLACE the displayed
 * amounts/price with indexed truth, mark reconciled, derive the tier from the
 * indexed block via the stored watermark. A change in amounts flags a shimmer
 * (contradiction / graduation-clamp partial fill) — the row is UPDATED, never
 * dropped (invariant 4).
 */
function reconcile(state: TradesState, t: TrackedTrade, row: IndexedTradeLike, now: number): TradesState {
  const changed = t.ethAmount !== row.ethAmount || t.tokenAmount !== row.tokenAmount;
  const merged: TrackedTrade = {
    ...t,
    lifecycle: "onchain",
    reconciled: true,
    ethAmount: row.ethAmount, // never trust self — indexed truth wins
    tokenAmount: row.tokenAmount,
    priceEth: row.priceEth,
    blockNumber: row.blockNumber,
    txHash: t.txHash ?? row.txHash,
    softConfirmedAt: t.softConfirmedAt ?? now,
    awaitingIndex: false,
    unverified: false,
    error: null,
    justUpdated: changed || t.justUpdated,
    justUpdatedAt: changed ? now : t.justUpdatedAt,
  };
  // Take the max of the row's own tier and the watermark-derived tier, monotonic.
  const withRowTier = upgradeConfirmationState(merged.confirmationState, row.confirmationState);
  merged.confirmationState = deriveTier({ ...merged, confirmationState: withRowTier }, state.watermarks);
  return patch(state, t.id, merged);
}

export function tradesReducer(state: TradesState, action: TradeAction): TradesState {
  switch (action.type) {
    case "submit": {
      const { trade } = action;
      if (state.byId[trade.id]) return state; // idempotent — never double-insert
      const now = action.now ?? Date.now();
      const entry: TrackedTrade = {
        id: trade.id,
        txHash: trade.txHash ?? null,
        sender: trade.sender,
        nonce: trade.nonce ?? null,
        token: trade.token,
        isBuy: trade.isBuy,
        ethAmount: trade.ethAmount,
        tokenAmount: trade.tokenAmount,
        priceEth: trade.priceEth ?? null,
        lifecycle: trade.txHash ? "pending" : "submitted",
        reconciled: false,
        confirmationState: "soft_confirmed",
        blockNumber: null,
        receiptBlockNumber: null,
        justUpdated: false,
        justUpdatedAt: null,
        awaitingIndex: false,
        unverified: false,
        error: null,
        submittedAt: now,
        softConfirmedAt: null,
      };
      // Newest first.
      return { ...state, order: [trade.id, ...state.order], byId: { ...state.byId, [trade.id]: entry } };
    }

    case "attach-hash": {
      const t = state.byId[action.id];
      if (!t || t.txHash) return state;
      return patch(state, t.id, {
        ...t,
        txHash: action.txHash,
        lifecycle: t.lifecycle === "submitted" ? "pending" : t.lifecycle,
      });
    }

    case "reject": {
      const t = state.byId[action.id];
      if (!t) return state;
      // Removed (toast). Never reached chain — safe to mark rejected (invariant 4
      // only protects rows that DID reach chain / the indexer).
      return patch(state, t.id, { ...t, lifecycle: "rejected" });
    }

    case "receipt": {
      const t = state.byId[action.id];
      if (!t) return state;
      const now = action.now ?? Date.now();
      const receiptBlockNumber =
        action.blockNumber === undefined ? null : Number(action.blockNumber);
      if (action.status === "reverted") {
        return patch(state, t.id, {
          ...t,
          lifecycle: "reverted",
          receiptBlockNumber,
          error: "Transaction reverted",
        });
      }
      // Success ⇒ optimistic:soft-confirmed. Values remain OUR estimate; tier
      // stays soft_confirmed (receipt block is informational only).
      return patch(state, t.id, {
        ...t,
        lifecycle: "onchain",
        reconciled: false,
        confirmationState: "soft_confirmed",
        receiptBlockNumber,
        softConfirmedAt: t.softConfirmedAt ?? now,
      });
    }

    case "ws-trade": {
      const now = action.now ?? Date.now();
      const t = findByTxHash(state, action.row.txHash);
      // Match token + side too, so a multi-log tx can't cross-reconcile.
      if (!t || !eq(t.token, action.row.token) || t.isBuy !== action.row.isBuy) return state;
      return reconcile(state, t, action.row, now);
    }

    case "rest-heal": {
      const now = action.now ?? Date.now();
      const t = findByTxHash(state, action.txHash);
      if (!t) return state;
      const match = action.rows.find(
        (r) => eq(r.token, t.token) && r.isBuy === t.isBuy && eq(r.txHash, action.txHash),
      );
      if (match) return reconcile(state, t, match, now);
      // Indexer-confirmed absence: keep the row (never drop), mark unverified.
      // Escalation to `failed` happens in `tick` after ABSENCE_ERROR_MS.
      if (t.reconciled) return state; // already reconciled — a stale empty heal is ignored
      return patch(state, t.id, { ...t, unverified: true });
    }

    case "watermark": {
      // O(1) upgrade of every held row (§12.20). Only reconciled rows move.
      let mutated = false;
      const byId: Record<string, TrackedTrade> = { ...state.byId };
      const next = { ...state, watermarks: action.watermarks };
      for (const id of state.order) {
        const t = state.byId[id];
        if (!t) continue;
        const tier = deriveTier(t, action.watermarks);
        if (tier !== t.confirmationState) {
          byId[id] = { ...t, confirmationState: tier };
          mutated = true;
        }
      }
      return mutated ? { ...next, byId } : next;
    }

    case "tick": {
      const now = action.now;
      let mutated = false;
      const byId: Record<string, TrackedTrade> = { ...state.byId };
      for (const id of state.order) {
        const t = state.byId[id];
        if (!t) continue;
        let n = t;

        // Shimmer expiry.
        if (n.justUpdated && n.justUpdatedAt !== null && now - n.justUpdatedAt >= JUST_UPDATED_MS) {
          n = { ...n, justUpdated: false, justUpdatedAt: null };
        }

        // Silence timers only apply to an un-reconciled, on-chain (soft-confirmed) row.
        if (n.lifecycle === "onchain" && !n.reconciled && n.softConfirmedAt !== null) {
          const elapsed = now - n.softConfirmedAt;
          if (!n.awaitingIndex && elapsed >= WS_SILENCE_MS) {
            n = { ...n, awaitingIndex: true };
          }
          // Escalate to failed ONLY on indexer-confirmed absence past the window.
          if (n.unverified && elapsed >= ABSENCE_ERROR_MS) {
            n = { ...n, lifecycle: "absent", error: "Trade not found by indexer" };
          }
        }

        if (n !== t) {
          byId[id] = n;
          mutated = true;
        }
      }
      return mutated ? { ...state, byId } : state;
    }

    default:
      return state;
  }
}

// ── Selectors ───────────────────────────────────────────────────────────────

/** All tracked trades, newest first (includes rejected — filter with `selectActiveTrades`). */
export function selectTrades(state: TradesState): TrackedTrade[] {
  const out: TrackedTrade[] = [];
  for (const id of state.order) {
    const t = state.byId[id];
    if (t) out.push(t);
  }
  return out;
}

/** Trades to render in the feed: everything except in-wallet rejects (those are a toast). */
export function selectActiveTrades(state: TradesState): TrackedTrade[] {
  return selectTrades(state).filter((t) => t.lifecycle !== "rejected");
}

export function selectTradeById(state: TradesState, id: string): TrackedTrade | undefined {
  return state.byId[id];
}

/**
 * Rows the hook should REST-heal: on-chain, un-reconciled, past WS silence,
 * with a txHash to query. Escalated (`absent`) rows are dropped from polling.
 */
export function selectTradesNeedingHeal(state: TradesState): TrackedTrade[] {
  return selectTrades(state).filter(
    (t) => t.lifecycle === "onchain" && !t.reconciled && t.awaitingIndex && t.txHash !== null,
  );
}
