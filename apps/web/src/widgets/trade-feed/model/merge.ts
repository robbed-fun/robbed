import type { TradeRow } from "@robbed/shared";

import {
  type TrackedTrade,
  type TradeDisplayState,
  displayStateForIndexed,
  tradeDisplayState,
} from "@/entities/trade";

/**
 * Normalized trade-feed row (optimistic OR indexed), for one uniform renderer.
 */
export interface FeedRow {
  key: string;
  isBuy: boolean;
  /** wei */
  ethAmount: string;
  tokenAmount: string;
  priceEth: number | null;
  trader: string;
  txHash: string | null;
  /** unix seconds (indexed rows) — null for a not-yet-reconciled optimistic row. */
  blockTimestamp: number | null;
  /** ms (optimistic rows) — for age before an indexed timestamp exists. */
  submittedAtMs: number | null;
  displayState: TradeDisplayState;
  awaitingIndex: boolean;
  justUpdated: boolean;
  isCreator: boolean;
  isOptimistic: boolean;
}

/**
 * Merge the user's optimistic trades with the indexed WS/REST feed.
 *
 * De-dup rule: an indexed row whose `txHash` matches an optimistic row is DROPPED
 * from the indexed list — the optimistic row already carries the reconciled
 * indexed values (the reducer replaced them), so showing both would double-count.
 * Optimistic rows render on top (newest activity), then the remaining indexed
 * rows in feed order. Nothing is ever dropped on contradiction (that is the
 * reducer's job); this only prevents a visual duplicate.
 */
export function buildFeedRows(args: {
  optimistic: readonly TrackedTrade[];
  indexed: readonly TradeRow[];
  creator: string;
}): FeedRow[] {
  const { optimistic, indexed, creator } = args;
  const creatorLc = creator.toLowerCase();
  const claimed = new Set(
    optimistic
      .map((t) => t.txHash?.toLowerCase())
      .filter((h): h is string => !!h),
  );

  const optimisticRows: FeedRow[] = optimistic
    .filter((t) => tradeDisplayState(t) !== "removed")
    .map((t) => ({
      key: t.id,
      isBuy: t.isBuy,
      ethAmount: t.ethAmount,
      tokenAmount: t.tokenAmount,
      priceEth: t.priceEth,
      trader: t.sender,
      txHash: t.txHash,
      blockTimestamp: null,
      submittedAtMs: t.submittedAt,
      displayState: tradeDisplayState(t),
      awaitingIndex: t.awaitingIndex,
      justUpdated: t.justUpdated,
      isCreator: t.sender.toLowerCase() === creatorLc,
      isOptimistic: true,
    }));

  const indexedRows: FeedRow[] = indexed
    .filter((r) => !claimed.has(r.txHash.toLowerCase()))
    .map((r) => ({
      key: r.id,
      isBuy: r.isBuy,
      ethAmount: r.ethAmount,
      tokenAmount: r.tokenAmount,
      priceEth: r.priceEth,
      trader: r.trader,
      txHash: r.txHash,
      blockTimestamp: r.blockTimestamp,
      submittedAtMs: null,
      displayState: displayStateForIndexed(r.confirmationState),
      awaitingIndex: false,
      justUpdated: false,
      isCreator: r.trader.toLowerCase() === creatorLc,
      isOptimistic: false,
    }));

  return [...optimisticRows, ...indexedRows];
}

/** Prepend a WS/indexed trade to a capped feed list, de-duping by row id. */
export function prependTrade(
  rows: readonly TradeRow[],
  next: TradeRow,
  cap = 50,
): TradeRow[] {
  if (rows.some((r) => r.id === next.id)) return rows as TradeRow[];
  return [next, ...rows].slice(0, cap);
}
