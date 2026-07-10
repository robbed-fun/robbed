/**
 * DB glue for the candle pipeline (indexer.md §4.2). Thin wrapper that reads the
 * current bucket, folds the trade in with the TESTED pure `applyTradeToInterval`
 * math (single source of truth — the same function the rebuild script and the
 * continuity tests use), and upserts. Six intervals per trade (§4.1); the
 * high-water guard inside `applyTradeToInterval` makes re-delivery a no-op.
 *
 * Curve `Trade` and V3 `Swap` both call this with a uniform `price` → the series
 * is venue-continuous by construction (§4.3).
 */
import { candles } from "ponder:schema";
import type { Context } from "ponder:registry";
import type { CandleRow, CandleInterval } from "@robbed/shared";
import { CANDLE_INTERVALS } from "@robbed/shared";
import { applyTradeToInterval, bucketStartFor, type CandleTradeInput } from "../candles";

// The real Ponder store type for `context.db`, derived from the generated
// `ponder:registry` Context (= `Db<schema>`). A hand-rolled structural interface
// mis-typed `insert().values()` (took `Record<string, unknown>`, which is wider
// than the strict per-table insert model Ponder infers), so the real `context.db`
// was not assignable to it. Sourcing the type from the codegen registry keeps it
// exactly in sync with the schema and Ponder's version-specific write API.
// Verified against Ponder 0.16.6 db.d.ts (`Db<schema>`) + ponder/virtual Context.
type CandleStoreDb = Context["db"];

function dbToCandleRow(db: Record<string, unknown>): CandleRow {
  return {
    token_address: db.tokenAddress as string,
    interval: db.interval as CandleInterval,
    bucket_start: Number(db.bucketStart),
    open: db.open as number,
    high: db.high as number,
    low: db.low as number,
    close: db.close as number,
    volume_eth: String(db.volumeEth),
    volume_token: String(db.volumeToken),
    trade_count: db.tradeCount as number,
    last_block_number: Number(db.lastBlockNumber),
    last_log_index: db.lastLogIndex as number,
  };
}

function candleRowToDbValues(r: CandleRow) {
  return {
    tokenAddress: r.token_address,
    interval: r.interval,
    bucketStart: BigInt(r.bucket_start),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volumeEth: BigInt(r.volume_eth),
    volumeToken: BigInt(r.volume_token),
    tradeCount: r.trade_count,
    lastBlockNumber: BigInt(r.last_block_number),
    lastLogIndex: r.last_log_index,
  };
}

/**
 * Fold one trade into all six interval candles for its token. Returns the six
 * resulting rows (post-fold) so the handler can publish the live candle updates
 * to `token:{addr}:candles:{interval}` (§8.1) WITHOUT re-reading the DB in the
 * publish path — the values are already in hand from the upsert (§8.3 hot-path
 * rule: no per-message DB read).
 */
export async function upsertCandlesForTrade(db: CandleStoreDb, input: CandleTradeInput): Promise<CandleRow[]> {
  const rows: CandleRow[] = [];
  for (const interval of CANDLE_INTERVALS) {
    const bucketStart = bucketStartFor(input.blockTimestamp, interval);
    const existingDb = await db.find(candles, {
      tokenAddress: input.tokenAddress,
      interval,
      bucketStart: BigInt(bucketStart),
    });
    const existing = existingDb ? dbToCandleRow(existingDb) : undefined;
    const next = applyTradeToInterval(existing, interval, input);
    const values = candleRowToDbValues(next);
    // `open`, `tokenAddress`, `interval`, `bucketStart` are immutable on update.
    const { tokenAddress: _t, interval: _i, bucketStart: _b, open: _o, ...mutable } = values;
    await db.insert(candles).values(values).onConflictDoUpdate(mutable);
    rows.push(next);
  }
  return rows;
}
