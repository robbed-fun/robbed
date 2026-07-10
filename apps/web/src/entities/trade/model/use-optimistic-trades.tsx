"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { TradeRow } from "@robbed/shared";

import { getTxTrades } from "@/shared/api";
import { useConfirmationWatermarks } from "@/shared/lib/ws";
import {
  type IndexedTradeLike,
  type SubmitInput,
  type TradesState,
  type TrackedTrade,
  createInitialTradesState,
  selectActiveTrades,
  selectTradesNeedingHeal,
  tradesReducer,
} from "./trades";

/**
 * Thin React binding for the pure `tradesReducer` (lib/trades.ts). React-only
 * plumbing lives here so the reducer stays framework-agnostic + testable:
 *   - feeds `global:confirmations` watermark advances into the reducer (§12.20),
 *   - runs the silence `tick` on an interval,
 *   - drives REST-heal (`GET /v1/trades/:txHash`) for rows past WS silence.
 *
 * The consuming surfaces (TradeWidget/TradeFeed/Launch stepper, M3-5/M3-6) call
 * `submit`/`attachHash`/`applyReceipt`/`applyWsTrade`/`reject` and wire their WS
 * `trade` subscription into `applyWsTrade`. All timers/fetchers are injectable so
 * the hook is deterministic under test.
 */

const TICK_MS = 1_000;
/** Per-row REST-heal cadence once a row is awaiting index (avoids hammering). */
const HEAL_INTERVAL_MS = 5_000;

export interface UseOptimisticTradesOptions {
  fetchTxTrades?: (txHash: string) => Promise<{ trades: TradeRow[] }>;
  now?: () => number;
  tickMs?: number;
  healIntervalMs?: number;
}

export interface OptimisticTradesApi {
  trades: TrackedTrade[];
  state: TradesState;
  submit: (input: SubmitInput) => void;
  attachHash: (id: string, txHash: string) => void;
  applyReceipt: (
    id: string,
    status: "success" | "reverted",
    blockNumber?: number | bigint,
  ) => void;
  applyWsTrade: (row: IndexedTradeLike) => void;
  reject: (id: string) => void;
}

export function useOptimisticTrades(opts: UseOptimisticTradesOptions = {}): OptimisticTradesApi {
  const now = opts.now ?? (() => Date.now());
  const fetchTxTrades = opts.fetchTxTrades ?? getTxTrades;
  const tickMs = opts.tickMs ?? TICK_MS;
  const healIntervalMs = opts.healIntervalMs ?? HEAL_INTERVAL_MS;

  const watermarks = useConfirmationWatermarks();
  const [state, dispatch] = useReducer(tradesReducer, undefined, () =>
    createInitialTradesState(watermarks),
  );

  // Feed watermark advances into the reducer (§12.20 — O(1) local upgrade).
  useEffect(() => {
    dispatch({ type: "watermark", watermarks });
  }, [watermarks]);

  // Silence tick.
  useEffect(() => {
    const h = setInterval(() => dispatch({ type: "tick", now: now() }), tickMs);
    return () => clearInterval(h);
  }, [now, tickMs]);

  // REST-heal: poll GET /v1/trades/:txHash for rows past WS silence.
  const lastHealAt = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const needing = selectTradesNeedingHeal(state);
    if (needing.length === 0) return;
    let cancelled = false;
    const t = now();
    for (const trade of needing) {
      const key = trade.txHash as string;
      const last = lastHealAt.current.get(key) ?? 0;
      if (t - last < healIntervalMs) continue;
      lastHealAt.current.set(key, t);
      void fetchTxTrades(key)
        .then((res) => {
          if (cancelled) return;
          dispatch({ type: "rest-heal", txHash: key, rows: res.trades, now: now() });
        })
        .catch(() => {
          // Network/REST error is not indexer-confirmed absence — retry next cycle,
          // never escalate to `failed` on a fetch failure (web.md §4.4).
          lastHealAt.current.delete(key);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [state, fetchTxTrades, now, healIntervalMs]);

  const submit = useCallback((input: SubmitInput) => dispatch({ type: "submit", trade: input }), []);
  const attachHash = useCallback(
    (id: string, txHash: string) => dispatch({ type: "attach-hash", id, txHash }),
    [],
  );
  const applyReceipt = useCallback(
    (id: string, status: "success" | "reverted", blockNumber?: number | bigint) =>
      dispatch({ type: "receipt", id, status, blockNumber }),
    [],
  );
  const applyWsTrade = useCallback((row: IndexedTradeLike) => dispatch({ type: "ws-trade", row }), []);
  const reject = useCallback((id: string) => dispatch({ type: "reject", id }), []);

  const trades = useMemo(() => selectActiveTrades(state), [state]);

  return { trades, state, submit, attachHash, applyReceipt, applyWsTrade, reject };
}
