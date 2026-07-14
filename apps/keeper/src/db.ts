/**
 * Fallback-sweep query shape (pure — no pg import here; see db.pg.ts for the
 * live adapter).
 *
 * DESIGN NOTE (decide-it-yourself, recorded per the research→decide→record loop):
 *   The indexer schema (apps/indexer/ponder.schema.ts) has NO explicit
 *   "ReadyToGraduate" column — it tracks `graduated` (bool) plus the live
 *   `real_eth_reserves` and the per-token immutable `graduation_eth`. The
 *   BondingCurve flips to Phase.ReadyToGraduate exactly when a buy pushes
 *   net-of-fee real reserves to `GRADUATION_ETH` (contracts/src/BondingCurve.sol,
 * the final buy is CLAMPED to land on the threshold —), so
 *   `graduated = false AND real_eth_reserves >= graduation_eth` IS the
 *   ReadyToGraduate-not-yet-graduated set, derived from existing indexed columns
 *   with ZERO schema change. The composite index `progressIdx (graduated,
 *   real_eth_reserves)` already covers this predicate.
 *
 *   This is a HINT set: the keeper re-reads on-chain `phase()` before ever
 *   sending (idempotency + guards against a stale/lagging row), so a false
 *   positive here is a cheap read, never a bad tx.
 */
import type { Address, ReadyCurve } from "./types";

/**
 * Minimal node-postgres-shaped client — lets db.pg.ts (Pool) AND unit tests
 * (a fake returning canned rows) share the same query path.
 */
export interface QueryClient {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/**
 * ReadyToGraduate-not-yet-graduated tokens. `real_eth_reserves >=
 * graduation_eth` (the clamp lands exactly on it; `>=` is defensive). Ordered
 * oldest-crossing-first via block_number so a backlog after downtime drains in
 * arrival order.
 */
export const READY_CURVES_SQL = `
  SELECT address, curve_address
  FROM tokens
  WHERE graduated = false
    AND real_eth_reserves >= graduation_eth
  ORDER BY block_number ASC
`;

interface ReadyRow {
  address: string;
  curve_address: string;
}

/** Map raw rows → lowercased `{ token, curve }` (addresses are lowercase everywhere). */
export function mapReadyRows(rows: ReadyRow[]): ReadyCurve[] {
  return rows.map((r) => ({
    token: r.address.toLowerCase() as Address,
    curve: r.curve_address.toLowerCase() as Address,
  }));
}

/** Run the sweep query against any QueryClient and map the result. */
export async function queryReadyCurves(client: QueryClient): Promise<ReadyCurve[]> {
  const { rows } = await client.query<ReadyRow>(READY_CURVES_SQL);
  return mapReadyRows(rows);
}
