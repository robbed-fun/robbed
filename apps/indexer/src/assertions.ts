/**
 * Startup assertions (indexer.md §2, §11 DoD; spec §12.55): fail-closed on
 * misconfiguration so the indexer never silently indexes the wrong chain / a
 * zero address / a DB without `pg_trgm`.
 *
 * Split into a PURE static check (env/registry shape — unit-testable with no
 * I/O) and a RUNTIME check (DB extension + live RPC chain id) that takes
 * injected clients so it too is testable and reusable by the migrate/bootstrap
 * scripts.
 *
 * §12.55(b) double fail-closed gate: the STATIC half (selected chain id must
 * resolve in the shared deployment registry — also enforced at loadConfig, so
 * a config object cannot even be constructed for an unknown chain) plus the
 * LIVE half (`eth_chainId` must equal the selected id — `assertRuntime`, which
 * takes the expected id as an argument: NO default chain id exists anywhere).
 */
import { getDeployment } from "@robbed/shared/addresses";
import type { IndexerConfig } from "./config";
import { ZERO_ADDRESS } from "./config";

/**
 * Pure static assertions (§12.55(b) static half + address shape): the selected
 * chain id has a shared-registry entry; WETH, V3 factory/NPM, curve factory and
 * migrator are present & non-zero. Throws on the first violation. (loadConfig
 * already enforces these while resolving; this is the explicit, testable gate
 * the DoD names.)
 *
 * Curve constants are NO LONGER asserted here: they are read per-curve from each
 * `BondingCurve`'s immutables at `TokenCreated` (§12.40d, src/curveReader.ts),
 * not sourced from env, so there is no startup env shape to validate.
 */
export function assertStaticConfig(config: IndexerConfig): void {
  if (!getDeployment(config.chainId)) {
    throw new Error(
      `[startup] chain id ${config.chainId} has no entry in the shared deployment registry (§12.55(b) — the chain id selects, it never defines)`,
    );
  }
  for (const [name, addr] of [
    ["WETH", config.weth],
    ["V3_FACTORY", config.v3Factory],
    ["V3_NPM", config.v3PositionManager],
    ["SWAP_ROUTER02", config.swapRouter02],
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
 * live RPC actually serves the SELECTED chain (§12.55(b) live half — never
 * index the wrong chain; `expectedChainId` is the registry-validated
 * `config.chainId`, passed explicitly because no default chain id exists).
 * Throws on failure. Called from the migrate/bootstrap step before
 * `ponder start`; the compose indexer commands run under `set -e` (§12.55(d))
 * so a throw here kills the container instead of being swallowed.
 */
export async function assertRuntime(
  db: SqlQueryable,
  rpc: ChainIdReadable,
  expectedChainId: number,
): Promise<void> {
  const ext = await db.query(`SELECT 1 AS ok FROM pg_extension WHERE extname = 'pg_trgm'`);
  if (ext.rows.length === 0) {
    throw new Error(`[startup] pg_trgm extension is not installed (required for §5.1 search)`);
  }
  const chainId = await rpc.getChainId();
  if (chainId !== expectedChainId) {
    throw new Error(
      `[startup] RPC chain id is ${chainId}, expected INDEXER_CHAIN_ID=${expectedChainId} (§12.55(b) live half)`,
    );
  }
}
