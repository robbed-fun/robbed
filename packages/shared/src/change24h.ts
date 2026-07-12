/**
 * 24h change anchor resolver (spec §12.40e; indexer.md §4.5).
 *
 *   change24hPct = (lastPrice − anchorPrice) / anchorPrice
 *     anchorPrice = close of the most-recent 1h candle at or before (now − 24h)
 *     token age < 24h  → anchorPrice = first-trade price (creation-anchored)
 *     no trades        → change24hPct = 0
 *
 * CANONICAL HOME (spec §12.40e + §12.29 anti-drift): this logic has
 * ≥2 consumers — the indexer's `volume_eth_24h` decay/materialization job AND the
 * API `card`/`detail` projections — so per the one-source-of-truth rule it lives
 * here in `packages/shared`, not duplicated in `apps/indexer/src/change24h.ts`.
 * Both services import from `@robbed/shared` so the value is identical across
 * `/tokens` list and `/tokens/:address` detail (§4.5). It is `tunable` like the
 * §12.22 ranking formulas (indexer-owned semantics; the frontend only renders).
 *
 * Pure + no write path: the anchor is a bucket lookup over the token's existing
 * 1h candle series (indexer.md §4.5 — "resolved at read time from the 1h
 * candles", the no-new-write-path option).
 *
 * Units: §12.40e's formula yields a RATIO. The wire field the API exposes
 * (`api-types.ts` `change24hPct`) is a display PERCENT (fixtures: `12.34`,
 * `-3.2`), so {@link computeChange24hPct} returns `ratio × 100`. This ×100 is the
 * established DTO convention, not part of the spec formula.
 */
import type { CandleRow } from "./db-rows";

const DAY_SECONDS = 86_400;

/** The only 1h-candle fields the anchor lookup needs (reuses the shared row). */
export type AnchorCandle = Pick<CandleRow, "bucket_start" | "close">;

export interface Change24hInput {
  /** Current time, unix seconds (query time / job tick). */
  nowSec: number;
  /** `tokens.last_price_eth`; null before the first trade. */
  lastPrice: number | null;
  /** Price of the token's earliest trade; null if it has never traded. */
  firstTradePrice: number | null;
  /** `tokens.created_at` (block timestamp, unix seconds). */
  createdAtSec: number;
  /** The token's 1h candles (any superset works; only `bucket_start ≤ cutoff` is read). */
  hourCandles: AnchorCandle[];
}

/**
 * The 24h-open anchor price per §12.40e. Returns null iff the token has never
 * traded (caller renders that as change 0 / null — see {@link computeChange24hPct}).
 */
export function selectAnchorPrice(input: Change24hInput): number | null {
  const { nowSec, firstTradePrice, createdAtSec, hourCandles } = input;
  if (firstTradePrice == null) return null; // no trades → no anchor

  const cutoff = nowSec - DAY_SECONDS;

  // Token younger than 24h → creation-anchored first-trade price (§12.40e).
  if (createdAtSec > cutoff) return firstTradePrice;

  // Else: close of the most-recent 1h candle whose bucket starts at or before
  // the 24h cutoff.
  let best: AnchorCandle | undefined;
  for (const c of hourCandles) {
    if (c.bucket_start <= cutoff && (best === undefined || c.bucket_start > best.bucket_start)) {
      best = c;
    }
  }

  // Fallback: token is ≥24h old but has no 1h candle at/before the cutoff (its
  // first trade landed inside the last 24h) → creation/first-trade anchor, so
  // the value is never fabricated from a missing bucket and never null-when-traded.
  return best ? best.close : firstTradePrice;
}

/**
 * `change24hPct` as a display percent (ratio × 100). `0` when the token has no
 * trades or no usable anchor (§12.40e). Never divides by zero (a real candle
 * close / first-trade price is > 0; a degenerate 0 anchor yields 0, not NaN).
 */
export function computeChange24hPct(input: Change24hInput): number {
  if (input.firstTradePrice == null || input.lastPrice == null) return 0; // no trades → 0
  const anchor = selectAnchorPrice(input);
  if (anchor == null || anchor === 0) return 0;
  return ((input.lastPrice - anchor) / anchor) * 100;
}
