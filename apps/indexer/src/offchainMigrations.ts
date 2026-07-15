/**
 * Offchain SQL migrations (`apps/indexer/migrations/`) — phased, idempotent,
 * SINGLE implementation shared by the two call sites:
 *
 *  - `scripts/migrate.ts` (ops/manual + compose pre-start): applies both phases
 *    when possible, plus the runtime assertions;
 *  - `src/sidecar.ts` (`startSidecars`, wired from eager compose boot plus the
 *    Ponder `:setup` fallback): re-applies both phases at EVERY indexer boot.
 *
 * Phases:
 *  - PHASE 1 (offchain tables → schema `public`): stable side-process tables
 *    (watermarks, eth_usd, metadata_verifications, flow, address_pnl). Never
 *    reference Ponder tables — safe any time, before or after `ponder start`.
 *  - PHASE 2 (→ the Ponder schema): 0003 pg_trgm GIN indexes + 0005 flow views
 *    + 0007 address_pnl views reference the Ponder-managed `tokens`/`trades`/
 *    `transfers` tables and can only exist while those tables do.
 *
 * DESIGN DECISION (2026-07-12, robbed-indexer — replaces the I-5b compose
 * stopgap that re-ran `migrate` in a `/ready`-polling shell loop):
 * phase 2's first-class home is SIDECAR BOOT, because
 *  1. compose eagerly starts sidecars on process boot (Ponder crash recovery
 *     does not replay `:setup`), and the boot migration waits/retries until
 *     Ponder's `database.migrate()` has created the tables. The `:setup` hook
 *     remains a fallback and is idempotent. No `/ready` polling (that waits for
 *     *historical sync*, far later than table creation);
 *  2. ponder drops its tables WITH CASCADE on a dev schema rebuild
 *     (dist/esm/database/index.js:432), silently dropping these external
 *     views/indexes — so they must be RE-applied on every start, which only an
 *     in-process boot hook does reliably across dev hot-reload, compose, and
 *     the prod Node container alike. All files are idempotent by construction
 *     (IF NOT EXISTS / OR REPLACE — enforced by test/offchainMigrations.test.ts),
 *     so re-application is always safe.
 * Alternative weighed: `migrate --post-ready` polling loop (the stopgap,
 * formalized) — rejected: it re-introduces a background shell process per
 * environment, waits on the wrong signal, and misses dev-mode CASCADE drops
 * after the loop exits.
 *
 * The migrate script keeps phase 2 for ops runs (e.g. after a zero-downtime
 * deploy creates a new versioned Ponder schema — see 0003's header caveat).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ponderSearchPath } from "./dbSearchPath";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "..", "migrations");

/** Phase 1 — offchain side-process tables, schema `public` (order matters). */
export const PHASE1_FILES = [
  "0001_extensions.sql",
  "0002_offchain_core.sql",
  "0004_flow_tables.sql",
  "0006_address_pnl.sql",
  "0008_metadata_display.sql",
] as const;

/** Phase 2 — GIN indexes + views OVER Ponder-managed tables, Ponder schema. */
export const PHASE2_FILES = [
  "0003_trgm_gin_indexes.sql",
  "0005_flow_views.sql",
  "0007_address_pnl_views.sql",
] as const;

/** Minimal query surface (pg `PoolClient` satisfies it; tests fake it). */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export function migrationSql(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

/** Run one migration file inside a scoped search_path. */
async function runIn(client: SqlClient, schema: string, file: string, log: (msg: string) => void): Promise<void> {
  await client.query(`SET search_path TO ${ponderSearchPath(schema)}`);
  await client.query(migrationSql(file));
  log(`  applied ${file} → schema "${schema}"`);
}

export async function tableExists(client: SqlClient, schema: string, table: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  );
  return r.rows.length > 0;
}

export interface ApplyResult {
  /** false = Ponder `tokens` table absent, phase 2 skipped (fresh pre-start DB). */
  phase2Applied: boolean;
}

/**
 * Apply phase 1 unconditionally, then phase 2 iff the Ponder `tokens` table
 * exists in `ponderSchema` (fresh-DB ordering: pre-`ponder start` runs skip it
 * gracefully; the sidecar boot re-run — where tables are guaranteed — applies it).
 */
export async function applyOffchainMigrations(
  client: SqlClient,
  opts: { ponderSchema: string; log?: (msg: string) => void; warn?: (msg: string) => void },
): Promise<ApplyResult> {
  const log = opts.log ?? console.log;
  const warn = opts.warn ?? console.warn;

  for (const file of PHASE1_FILES) await runIn(client, "public", file, log);

  if (!(await tableExists(client, opts.ponderSchema, "tokens"))) {
    warn(
      `[migrate] skipping phase 2 (${PHASE2_FILES.join(", ")}) — ` +
        `"${opts.ponderSchema}".tokens not found yet; the indexer sidecar boot ` +
        `re-applies them once Ponder has built its tables.`,
    );
    return { phase2Applied: false };
  }
  for (const file of PHASE2_FILES) await runIn(client, opts.ponderSchema, file, log);
  return { phase2Applied: true };
}

/** Pool surface `applyMigrationsAtBoot` needs (pg `Pool` satisfies it). */
export interface SqlPool {
  connect(): Promise<SqlClient & { release(): void }>;
}

/**
 * Sidecar-boot entry: apply both phases with a small bounded retry (DDL at boot
 * should never hit transient failures — Ponder just used the same DB — but a
 * few retries cost nothing). NEVER throws into the indexing pipeline: exhausted
 * retries log loudly and return false (search falls back to un-indexed scans;
 * the pnl/flow job tick errors keep the failure visible).
 */
export async function applyMigrationsAtBoot(
  pool: SqlPool,
  ponderSchema: string,
  opts: { attempts?: number; delayMs?: number; log?: (msg: string) => void; error?: (msg: string, err: unknown) => void } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 5;
  const delayMs = opts.delayMs ?? 3_000;
  const error = opts.error ?? ((msg, err) => console.error(msg, err));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const client = await pool.connect();
      try {
        const result = await applyOffchainMigrations(client, { ponderSchema, log: opts.log });
        if (!result.phase2Applied) {
          throw new Error(
            `[indexer migrations] phase 2 skipped at sidecar boot — "${ponderSchema}".tokens absent. ` +
              `Waiting for Ponder to build its tables; if this repeats, check DATABASE_SCHEMA matches Ponder's schema.`,
          );
        }
        return true;
      } finally {
        client.release();
      }
    } catch (err) {
      error(`[indexer migrations] apply failed (attempt ${attempt}/${attempts}):`, err);
      if (attempt < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  error(
    "[indexer migrations] FAILED after all retries — search GIN indexes and flow/pnl views may be missing " +
      "(indexing continues; pnl/flow job errors will page). Run `bun run migrate` manually.",
    null,
  );
  return false;
}
