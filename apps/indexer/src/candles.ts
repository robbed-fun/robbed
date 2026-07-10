/**
 * Venue-continuous candle pipeline (indexer.md §3.7, §4; spec §5.2/§12.17).
 *
 * Curve `Trade` and V3 `Swap` both insert into the unified `trades` table with a
 * uniform `price_eth`; candles aggregate `trades` WITHOUT reference to `venue`,
 * so the series is continuous across graduation by construction — the last curve
 * trade closes its bucket, the first V3 swap continues from the migrator's
 * arbitraged pool price, no gap/reset/null bucket at the boundary (§4.3).
 *
 * These functions are PURE (no DB): the Ponder handler applies them via
 * `db.insert(...).onConflictDoUpdate(...)` and the `rebuild` script replays them
 * into an in-memory store — same math, so `rebuild` is byte-equal to incremental
 * (§4.4). Idempotency: the high-water guard `(block,log) <= (last_block,
 * last_log)` makes a re-applied trade a no-op (§4.2).
 */
import type { CandleRow } from "@robbed/shared";
import { CANDLE_INTERVALS, CANDLE_INTERVAL_SECONDS, type CandleInterval } from "@robbed/shared";
import { positionLte } from "./ids";

/** Floor a unix-seconds timestamp to the start of its interval bucket. */
export function bucketStartFor(blockTimestamp: number, interval: CandleInterval): number {
  const secs = CANDLE_INTERVAL_SECONDS[interval];
  return Math.floor(blockTimestamp / secs) * secs;
}

/** One trade's contribution to the candle pipeline (curve or v3 — uniform). */
export interface CandleTradeInput {
  tokenAddress: string;
  price: number; // ETH per token (curvePriceEth / v3PriceEth)
  volumeEth: bigint; // ETH leg, wei
  volumeToken: bigint;
  blockNumber: number;
  blockTimestamp: number;
  logIndex: number;
}

/**
 * Fold one trade into one interval's bucket. `existing` MUST be the row for
 * `(tokenAddress, interval, bucketStartFor(ts, interval))` or undefined.
 * Returns the new row; returns `existing` unchanged when the trade's position is
 * at/behind the bucket's high-water mark (idempotent re-apply).
 */
export function applyTradeToInterval(
  existing: CandleRow | undefined,
  interval: CandleInterval,
  input: CandleTradeInput,
): CandleRow {
  const bucketStart = bucketStartFor(input.blockTimestamp, interval);

  if (!existing) {
    return {
      token_address: input.tokenAddress,
      interval,
      bucket_start: bucketStart,
      open: input.price,
      high: input.price,
      low: input.price,
      close: input.price,
      volume_eth: input.volumeEth.toString(),
      volume_token: input.volumeToken.toString(),
      trade_count: 1,
      last_block_number: input.blockNumber,
      last_log_index: input.logIndex,
    };
  }

  // High-water idempotency guard (§4.2): skip re-apply of a seen position.
  if (positionLte(input.blockNumber, input.logIndex, existing.last_block_number, existing.last_log_index)) {
    return existing;
  }

  return {
    ...existing,
    high: Math.max(existing.high, input.price),
    low: Math.min(existing.low, input.price),
    close: input.price, // in-order processing → last write wins (§4.2)
    volume_eth: (BigInt(existing.volume_eth) + input.volumeEth).toString(),
    volume_token: (BigInt(existing.volume_token) + input.volumeToken).toString(),
    trade_count: existing.trade_count + 1,
    last_block_number: input.blockNumber,
    last_log_index: input.logIndex,
    // `open` is intentionally NOT changed — set only on first insert (§4.2).
  };
}

/** The six `(interval, bucketStart)` buckets a single trade touches. */
export function candleBucketsForTrade(
  blockTimestamp: number,
): Array<{ interval: CandleInterval; bucketStart: number }> {
  return CANDLE_INTERVALS.map((interval) => ({
    interval,
    bucketStart: bucketStartFor(blockTimestamp, interval),
  }));
}

/**
 * In-memory candle store keyed `token|interval|bucketStart` — the shared engine
 * the `rebuild` script and the continuity tests drive. The Ponder handler uses
 * the DB equivalent (`onConflictDoUpdate`) but the fold math is identical.
 */
export class CandleStore {
  private readonly map = new Map<string, CandleRow>();

  private key(token: string, interval: CandleInterval, bucketStart: number): string {
    return `${token}|${interval}|${bucketStart}`;
  }

  apply(input: CandleTradeInput): void {
    for (const interval of CANDLE_INTERVALS) {
      const bucketStart = bucketStartFor(input.blockTimestamp, interval);
      const k = this.key(input.tokenAddress, interval, bucketStart);
      this.map.set(k, applyTradeToInterval(this.map.get(k), interval, input));
    }
  }

  /** All rows sorted deterministically — enables byte-equal rebuild comparison. */
  rows(): CandleRow[] {
    return [...this.map.values()].sort(
      (a, b) =>
        a.token_address.localeCompare(b.token_address) ||
        a.interval.localeCompare(b.interval) ||
        a.bucket_start - b.bucket_start,
    );
  }

  /** Rows for one token+interval in time order (chart series shape). */
  series(token: string, interval: CandleInterval): CandleRow[] {
    return this.rows().filter((r) => r.token_address === token && r.interval === interval);
  }
}
