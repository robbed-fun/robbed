/**
 * Postgres concrete for the address_pnl roll-up job. Kept OUT of `compute.ts` so
 * that module stays DB-free and fully unit-testable. Here live the two
 * side-effecting boundaries: reading the `pnl_*` views (0007_address_pnl_views
 * .sql) into a `PnlInput`, and writing the results into `address_pnl` (the
 * offchain, indexer-owned side table, -style / 0006).
 *
 * Writes are a TRUNCATE + re-insert inside one transaction: the table is DERIVED
 * and fully rebuildable from `trades`+`transfers`+`tokens`, so recomputing
 * the whole set each run is the boring, can't-silently-corrupt option (a stale
 * roll-up can never linger). This recompute IS the address_pnl rebuild path —
 * there is no incremental writer to drift from. Advisory / read-only — never
 * gates chain state.
 */
import { Pool, type PoolClient } from "pg";
import { ponderSearchPath } from "../dbSearchPath";
import type { AddressPnlComputed, PnlInput } from "./compute";

/** Load/write boundary (Pg impl below; faked in the unit suite). */
export interface PnlStore {
  loadInput(): Promise<PnlInput>;
  writeResults(rows: AddressPnlComputed[], nowIso: string): Promise<void>;
}

export function createPgPnlStore(pool: Pool, schema: string): PnlStore {
  const q = async (client: PoolClient, text: string) => (await client.query(text)).rows;
  return {
    async loadInput(): Promise<PnlInput> {
      const client = await pool.connect();
      try {
        // The pnl_* views reference the Ponder tables → live in the Ponder schema.
        await client.query(`SET search_path TO ${ponderSearchPath(schema)}`);
        const legs = await q(
          client,
          `SELECT address, token, eth_in_all, tokens_bought_all, eth_out_all, tokens_sold_all,
                  eth_in_curve, tokens_bought_curve, eth_out_curve, tokens_sold_curve, has_v3
             FROM pnl_trade_legs`,
        );
        const activity = await q(client, `SELECT address, trade_count, first_trade_at, last_trade_at FROM pnl_address_activity`);
        const seen = await q(client, `SELECT address, first_seen_at, last_seen_at FROM pnl_address_seen`);
        const created = await q(client, `SELECT address, tokens_created FROM pnl_tokens_created`);
        return {
          legs: legs.map((r) => ({
            address: r.address,
            token: r.token,
            ethInAll: BigInt(r.eth_in_all),
            tokensBoughtAll: BigInt(r.tokens_bought_all),
            ethOutAll: BigInt(r.eth_out_all),
            tokensSoldAll: BigInt(r.tokens_sold_all),
            ethInCurve: BigInt(r.eth_in_curve),
            tokensBoughtCurve: BigInt(r.tokens_bought_curve),
            ethOutCurve: BigInt(r.eth_out_curve),
            tokensSoldCurve: BigInt(r.tokens_sold_curve),
            hasV3: Boolean(r.has_v3),
          })),
          activity: activity.map((r) => ({
            address: r.address,
            tradeCount: Number(r.trade_count),
            firstTradeAt: Number(r.first_trade_at),
            lastTradeAt: Number(r.last_trade_at),
          })),
          seen: seen.map((r) => ({
            address: r.address,
            firstSeenAt: Number(r.first_seen_at),
            lastSeenAt: Number(r.last_seen_at),
          })),
          created: created.map((r) => ({
            address: r.address,
            tokensCreated: Number(r.tokens_created),
          })),
        };
      } finally {
        client.release();
      }
    },

    async writeResults(rows: AddressPnlComputed[], nowIso: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // address_pnl lives in stable `public` (search_path-independent).
        await client.query("TRUNCATE address_pnl");
        for (const r of rows) {
          await client.query(
            `INSERT INTO address_pnl
               (address, first_seen_at, last_active_at, trade_count, tokens_created,
                total_eth_in, total_eth_out, realized_pnl_low, realized_pnl_high,
                pnl_confidence, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)`,
            [
              r.address,
              r.first_seen_at,
              r.last_active_at,
              r.trade_count,
              r.tokens_created,
              r.total_eth_in,
              r.total_eth_out,
              r.realized_pnl_low,
              r.realized_pnl_high,
              r.pnl_confidence,
              nowIso,
            ],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
