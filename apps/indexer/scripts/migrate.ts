/**
 * Offchain migration runner + runtime startup assertions (indexer.md §2, §7.3).
 *
 * Thin CLI over the SINGLE migration implementation in
 * `src/offchainMigrations.ts` (also applied at indexer sidecar boot — the
 * first-class home of the "re-run after ponder start" phase-2 pass; see that
 * module's design note):
 *  - phase 1 (0001 extensions, 0002 offchain core, 0004 flow tables, 0006
 *    address_pnl, 0008 metadata display) → schema `public` (stable; survive
 *    Ponder schema redeploys, so they never FK Ponder tables);
 *  - phase 2 (0003 pg_trgm GIN indexes, 0005 flow views, 0007 address_pnl
 *    views) → the Ponder schema (DATABASE_SCHEMA, default `public`), ONLY if
 *    the Ponder `tokens` table already exists. When it doesn't (fresh DB,
 *    pre-`ponder start`), the skip is graceful — the sidecar boot applies
 *    phase 2 automatically once Ponder has built its tables. Manual re-runs
 *    remain useful for ops (e.g. after a zero-downtime deploy creates a new
 *    versioned Ponder schema — 0003 header caveat). All statements idempotent.
 *
 * Then runs the RUNTIME assertions (pg_trgm installed, RPC chain id == 4663) —
 * the fail-closed gate that complements the static assertions in ponder.config.ts.
 *
 * Runs in the second (post-reconcile) pass; requires `pg` + `viem` from
 * node_modules. Invoke: `bun run migrate`.
 */
import { Pool } from "pg";
import { createPublicClient, http } from "viem";
import { loadConfig } from "../src/config";
import { assertRuntime } from "../src/assertions";
import { applyOffchainMigrations } from "../src/offchainMigrations";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error("[migrate] DATABASE_URL is required");

  const ponderSchema = config.databaseSchema ?? "public";
  const pool = new Pool({ connectionString: config.databaseUrl });

  try {
    const client = await pool.connect();
    try {
      console.log("[migrate] applying offchain migrations (phase 1 → public; phase 2 → Ponder schema if built)…");
      await applyOffchainMigrations(client, { ponderSchema });
    } finally {
      client.release();
    }

    console.log(`[migrate] running runtime assertions (pg_trgm, live chain id == INDEXER_CHAIN_ID=${config.chainId} — §12.55(b))…`);
    const rpc = createPublicClient({ transport: http(config.rpcHttp) });
    await assertRuntime(pool, rpc, config.chainId);
    console.log("[migrate] OK");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
