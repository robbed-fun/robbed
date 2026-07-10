/**
 * Offchain migration runner + runtime startup assertions (indexer.md §2, §7.3).
 *
 * Applies the plain-SQL `migrations/` in order:
 *  - 0001 extensions, 0002 offchain core, 0004 flow tables → schema `public`
 *    (stable; survive Ponder schema redeploys, so they never FK Ponder tables);
 *  - 0003 pg_trgm GIN indexes → the Ponder schema (DATABASE_SCHEMA, default
 *    `public`), and ONLY if the Ponder `tokens` table already exists (re-run
 *    after `ponder start` to apply them). All statements are idempotent.
 *
 * Then runs the RUNTIME assertions (pg_trgm installed, RPC chain id == 4663) —
 * the fail-closed gate that complements the static assertions in ponder.config.ts.
 *
 * Runs in the second (post-reconcile) pass; requires `pg` + `viem` from
 * node_modules. Invoke: `bun run migrate`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { createPublicClient, http } from "viem";
import { loadConfig } from "../src/config";
import { assertRuntime } from "../src/assertions";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "..", "migrations");

function sql(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

/** Run one migration file inside a scoped search_path. */
async function runIn(client: PoolClient, schema: string, file: string): Promise<void> {
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(sql(file));
  console.log(`  applied ${file} → schema "${schema}"`);
}

async function tableExists(client: PoolClient, schema: string, table: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  );
  return r.rows.length > 0;
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error("[migrate] DATABASE_URL is required");

  const ponderSchema = config.databaseSchema ?? "public";
  const pool = new Pool({ connectionString: config.databaseUrl });

  try {
    const client = await pool.connect();
    try {
      console.log("[migrate] applying offchain migrations (schema public)…");
      // Extension is schema-agnostic; run it first in public.
      await runIn(client, "public", "0001_extensions.sql");
      await runIn(client, "public", "0002_offchain_core.sql");
      await runIn(client, "public", "0004_flow_tables.sql");
      await runIn(client, "public", "0006_address_pnl.sql");

      // GIN indexes (0003) + §8.5 flow views (0005) + address_pnl views (0007)
      // reference the Ponder-managed tables — only creatable once Ponder has built
      // them. Skip gracefully otherwise (re-run later). All apply in the Ponder schema.
      if (await tableExists(client, ponderSchema, "tokens")) {
        await runIn(client, ponderSchema, "0003_trgm_gin_indexes.sql");
        await runIn(client, ponderSchema, "0005_flow_views.sql");
        await runIn(client, ponderSchema, "0007_address_pnl_views.sql");
      } else {
        console.warn(
          `[migrate] skipping 0003 GIN indexes + 0005 flow views + 0007 address_pnl views — ` +
            `"${ponderSchema}".tokens not found yet; re-run \`bun run migrate\` after ` +
            `\`ponder start\` builds it.`,
        );
      }
    } finally {
      client.release();
    }

    console.log("[migrate] running runtime assertions (pg_trgm, chain id 4663)…");
    const rpc = createPublicClient({ transport: http(config.rpcHttp) });
    await assertRuntime(pool, rpc);
    console.log("[migrate] OK");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
