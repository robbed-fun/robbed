/**
 * Startup assertions (indexer.md §2, §11 DoD): fail-closed on misconfiguration
 * so the indexer never silently indexes the wrong chain / a zero V3 address / a
 * DB without `pg_trgm`.
 *
 * Split into a PURE static check (env/const shape — unit-testable with no I/O)
 * and a RUNTIME check (DB extension + RPC chain id) that takes injected clients
 * so it too is testable and reusable by the migrate/bootstrap scripts.
 */
import { WETH_ADDRESS, CHAIN_ID } from "@robbed/shared";
import type { IndexerConfig } from "./config";
import { ZERO_ADDRESS } from "./config";

/**
 * Pure static assertions: WETH matches the canonical constant, chain id is
 * 4663, V3 factory + NPM are present & non-zero. Throws on the first violation.
 * (loadConfig already enforces most of these; this is the explicit, testable
 * gate the DoD names.)
 *
 * Curve constants are NO LONGER asserted here: they are read per-curve from each
 * `BondingCurve`'s immutables at `TokenCreated` (§12.40d, src/curveReader.ts),
 * not sourced from env, so there is no startup env shape to validate.
 */
export function assertStaticConfig(config: IndexerConfig): void {
  if (config.weth !== WETH_ADDRESS.toLowerCase()) {
    throw new Error(
      `[startup] WETH mismatch: configured ${config.weth} != canonical ${WETH_ADDRESS.toLowerCase()}`,
    );
  }
  if (config.chainId !== CHAIN_ID || config.chainId !== 4663) {
    throw new Error(`[startup] chain id must be 4663, got ${config.chainId}`);
  }
  for (const [name, addr] of [
    ["V3_FACTORY", config.v3Factory],
    ["V3_NPM", config.v3PositionManager],
    ["CURVE_FACTORY", config.curveFactory],
    ["MIGRATOR", config.migrator],
  ] as const) {
    if (!addr || addr === ZERO_ADDRESS) {
      throw new Error(`[startup] ${name} address must be present and non-zero (got ${addr})`);
    }
  }
}

/** Minimal shape of a pg client the runtime assertions need (node-postgres Pool/Client). */
export interface SqlQueryable {
  query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Minimal shape of a viem-like client for the chain-id read. */
export interface ChainIdReadable {
  getChainId(): Promise<number>;
}

/**
 * Runtime assertions: `pg_trgm` installed (search depends on it, §5.1) and the
 * RPC actually serves chain 4663 (never index the wrong chain). Throws on
 * failure. Called from the migrate/bootstrap step before `ponder start`.
 */
export async function assertRuntime(db: SqlQueryable, rpc: ChainIdReadable): Promise<void> {
  const ext = await db.query(`SELECT 1 AS ok FROM pg_extension WHERE extname = 'pg_trgm'`);
  if (ext.rows.length === 0) {
    throw new Error(`[startup] pg_trgm extension is not installed (required for §5.1 search)`);
  }
  const chainId = await rpc.getChainId();
  if (chainId !== 4663) {
    throw new Error(`[startup] RPC chain id is ${chainId}, expected 4663`);
  }
}
