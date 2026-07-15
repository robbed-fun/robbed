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
import type { Address, GraduatedLpPosition, ReadyCurve, TreasuryFeeCurve } from "./types";

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

/**
 * Curves that can accrue the treasury ETH-leg trade fee. Include graduated rows:
 * `graduate()` deliberately leaves unswept `accruedFees` on the curve, and the
 * permissionless `sweepFees()` path remains valid after graduation.
 */
export const TREASURY_FEE_CURVES_SQL = `
  SELECT address, curve_address
  FROM tokens
  WHERE trade_fee_bps > 0
  ORDER BY block_number ASC
`;

/**
 * Graduated LP positions owned by LPFeeVault. The keeper uses this as a hint set:
 * it simulates `LPFeeVault.collect(lp_token_id)` before sending, so stale or
 * already-collected rows only cost an RPC call.
 */
export const GRADUATED_LP_POSITIONS_SQL = `
  SELECT token_address, pool_address, lp_token_id, token_is_token0
  FROM graduations
  ORDER BY block_number ASC
`;

interface ReadyRow {
  address: string;
  curve_address: string;
}

interface GraduatedLpRow {
  token_address: string;
  pool_address: string;
  lp_token_id: string | number | bigint;
  token_is_token0: boolean;
}

/** Map raw rows → lowercased `{ token, curve }` (addresses are lowercase everywhere). */
export function mapReadyRows(rows: ReadyRow[]): ReadyCurve[] {
  return rows.map((r) => ({
    token: r.address.toLowerCase() as Address,
    curve: r.curve_address.toLowerCase() as Address,
  }));
}

/** Map raw rows → lowercased `{ token, curve }` for treasury fee sweeps. */
export function mapTreasuryFeeRows(rows: ReadyRow[]): TreasuryFeeCurve[] {
  return rows.map((r) => ({
    token: r.address.toLowerCase() as Address,
    curve: r.curve_address.toLowerCase() as Address,
  }));
}

/** Map raw graduation rows → lowercased LP-position collect candidates. */
export function mapGraduatedLpRows(rows: GraduatedLpRow[]): GraduatedLpPosition[] {
  return rows.map((r) => ({
    token: r.token_address.toLowerCase() as Address,
    pool: r.pool_address.toLowerCase() as Address,
    lpTokenId: BigInt(r.lp_token_id),
    tokenIsToken0: r.token_is_token0,
  }));
}

/** Run the sweep query against any QueryClient and map the result. */
export async function queryReadyCurves(client: QueryClient): Promise<ReadyCurve[]> {
  const { rows } = await client.query<ReadyRow>(READY_CURVES_SQL);
  return mapReadyRows(rows);
}

/** Run the treasury-fee candidate query against any QueryClient and map the result. */
export async function queryTreasuryFeeCurves(client: QueryClient): Promise<TreasuryFeeCurve[]> {
  const { rows } = await client.query<ReadyRow>(TREASURY_FEE_CURVES_SQL);
  return mapTreasuryFeeRows(rows);
}

/** Run the graduated-LP query against any QueryClient and map the result. */
export async function queryGraduatedLpPositions(
  client: QueryClient,
): Promise<GraduatedLpPosition[]> {
  const { rows } = await client.query<GraduatedLpRow>(GRADUATED_LP_POSITIONS_SQL);
  return mapGraduatedLpRows(rows);
}
