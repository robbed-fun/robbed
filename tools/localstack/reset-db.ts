#!/usr/bin/env bun
/**
 * ── dev:db:reset — wipe the indexer/API DB state and prove backfill-from-chain ──
 *
 * Drops every schema the off-chain services own in the LOCAL compose stack's
 * Postgres, restores the DB-bootstrap statements, clears the persisted Redis
 * channel-seq counters, re-runs the `apimigrations` one-shot, restarts the
 * consumers and waits (bounded, fail-loud) until the indexer has re-indexed
 * everything FROM THE CHAIN (anvil fork). Candles/flows/pnl are derived data,
 * chain tables are re-derivable — this script is the standing proof.
 *
 * Decision basis (recorded per the decide-it-yourself loop, 2026-07-12):
 *  - Schemas: `public` + `ponder_sync` — verified live (`\dn`) against the
 *    running stack; `ponder dev` defaults its app schema to `public`
 *    (ponder.sh/docs/database), the compose stack sets no DATABASE_SCHEMA, and
 *    the indexer's offchain sidecar tables + the API-owned tables also live in
 *    `public`. `ponder_sync` is Ponder's RPC sync cache: dropping it is
 *    DELIBERATE — a wipe that kept it would "re-index" from cached RPC data;
 *    dropping it forces a true refetch from the chain, which is the property
 *    this script exists to prove. An empty DB is exactly Ponder's first-boot
 *    state, so `ponder dev` recreates both schemas and re-syncs from scratch.
 *  - Restart via plain `docker start <container>` (NOT `compose up`, NOT even
 *    `compose start`): BOTH compose verbs process the depends_on graph and
 *    RE-RUN exited one-shots — observed LIVE 2026-07-12: `docker compose start
 *    indexer api ws` restarted `deps` AND `deploychain`, which redeployed the
 *    contracts onto the running anvil and rewrote local.env (new factory +
 *    START_BLOCK), silently breaking the "same chain data reproduces"
 *    guarantee (the first reset run re-indexed the fresh empty deployment in
 *    6s instead of the 190-token world). `compose start` has no `--no-deps`
 *    flag, so the only zero-side-effect restart is `docker start` on the
 *    container names resolved from `docker compose ps` (compose stays the
 *    source of truth for service→container mapping). A tripwire re-stats
 *    local.env after the restart and fails loud if it was rewritten.
 *    `apimigrations` is re-run explicitly (`run --rm --no-deps`) because the
 *    API does NOT apply its migrations at boot (verified: only a comment in
 *    apps/api/src/lib/db.bun.ts references them); the indexer's own offchain
 *    migrations DO re-apply at boot (compose command runs `migrate`, and the
 *    sidecar re-applies phase 2 — apps/indexer/scripts/migrate.ts).
 *  - Grants: the dev DB has ONLY the `robbed` superuser role (verified `\du`);
 *    the robbed_api_ro/rw GRANTs in apps/api/migrations/001_api_tables.sql are
 *    commented-out deploy guidance and the API falls back to DATABASE_URL in
 *    dev (apps/api/src/config.ts). The single canonical bootstrap statement to
 *    restore is `CREATE EXTENSION pg_trgm` (docker/postgres/init/01-pg_trgm.sql),
 *    mirrored below. If real roles ever land in the initdb SQL, mirror them here.
 *  - Redis: verified live (SCAN, 2026-07-12) the ONLY persisted keys are the
 *    per-channel `{channel}:seq` counters from the indexer's publish path
 *    (packages/shared channelSeqKey; appendonly persistence). The backfill-
 *    suppression latch (PublishGate, apps/indexer/src/publish.ts) is process-
 *    local memory — NEVER persisted — so the indexer restart clears it by
 *    itself. The seq counters are deleted (SCAN MATCH `*:seq`, never FLUSHALL)
 *    so the rebuilt-from-genesis world starts at seq 1; safe because ws/api
 *    restart drops every WS client, and clients REST-heal on reconnect anyway.
 *  - NEVER touch anvil: its chain state is in-process memory (no volume) — it
 *    IS the backfill source. postgres/redis/minio/web also stay up.
 *
 * Env knobs (same vars + defaults the compose file owns — never bare
 * hardcodes): PONDER_PORT (4269), API_PORT (4001), REDIS_PORT (4379),
 * DEV_RESET_TIMEOUT_SECS (900 — post-wipe backfill deadline).
 *
 * Targets the LOCAL stack (docker-compose.yml via cwd) only; the testnet stack
 * is a distinct compose project with a remote chain — never reset it with this.
 *
 * Run: `bun run dev:db:reset` (root package.json).
 */
import { RedisClient } from "bun";
import { statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** deploychain artifact — the reset must NEVER cause it to be rewritten (tripwire). */
const LOCAL_ENV_PATH = join(ROOT, "tools", "localstack", "out", "local.env");
const TIMEOUT_MS = Number(process.env.DEV_RESET_TIMEOUT_SECS ?? 900) * 1000;
const POLL_MS = 3000;
const FAIL_LOG_TAIL = 40;

const env = (name: string, fallback: string): string => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};
const PONDER_PORT = env("PONDER_PORT", "4269");
const API_PORT = env("API_PORT", "4001");
const REDIS_PORT = env("REDIS_PORT", "4379");

/** Services stopped/restarted around the wipe — the DB/Redis consumers. */
const CONSUMERS = ["indexer", "api", "ws"] as const;

// ── compose helpers (stack.ts style) ─────────────────────────────────────────

async function compose(
  args: string[],
  opts: { inherit?: boolean; stdin?: string } = {},
): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(["docker", "compose", ...args], {
    cwd: ROOT,
    stdin: opts.stdin === undefined ? undefined : Buffer.from(opts.stdin),
    stdout: opts.inherit ? "inherit" : "pipe",
    stderr: "inherit",
  });
  const stdout = opts.inherit ? "" : await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

interface PsRow {
  Name: string; // container name — used for the zero-side-effect `docker start`
  Service: string;
  State: string;
  Health: string;
  ExitCode: number;
}

/** Parse `ps --all --format json` output — NDJSON (compose v2.21+) or a JSON array. */
function parsePs(raw: string): Map<string, PsRow> {
  const rows: PsRow[] = [];
  const trimmed = raw.trim();
  if (trimmed === "") return new Map();
  if (trimmed.startsWith("[")) {
    rows.push(...(JSON.parse(trimmed) as PsRow[]));
  } else {
    for (const line of trimmed.split("\n")) {
      if (line.trim() === "") continue;
      rows.push(JSON.parse(line) as PsRow);
    }
  }
  return new Map(rows.map((r) => [r.Service, r]));
}

async function psAll(): Promise<Map<string, PsRow>> {
  const ps = await compose(["ps", "--all", "--format", "json"]);
  if (ps.code !== 0) {
    console.error("[db-reset] FAIL — `docker compose ps` failed (is the docker daemon up?)");
    process.exit(1);
  }
  return parsePs(ps.stdout);
}

async function dumpLogs(services: string[]): Promise<void> {
  for (const svc of services) {
    console.error(`\n[db-reset] ── last ${FAIL_LOG_TAIL} log lines: ${svc} ──`);
    await compose(["logs", "--no-color", `--tail=${FAIL_LOG_TAIL}`, svc], { inherit: true });
  }
}

function loudWarning(): void {
  const lines = [
    "THIS WIPES MORE THAN CHAIN-DERIVED STATE (shared dev DB):",
    "  * moderation_status + moderation_audit_log — moderation verdicts and the",
    "    admin audit trail are GONE (re-moderate / re-hide as needed).",
    "  * eth_usd + competitor snapshot history — EXTERNAL-source series, NOT",
    "    recoverable from the chain; history restarts from the next poll.",
    "  * metadata verification verdicts — re-derived by the verifier (refetch).",
    "Everything chain-derived (tokens, trades, graduations, V3 swaps/collects,",
    "candles, flows, pnl, confirmation watermarks) re-backfills from anvil.",
  ];
  const bar = "!".repeat(78);
  console.log(`\n${bar}`);
  for (const l of lines) console.log(`!! ${l}`);
  console.log(`${bar}\n`);
}

// ── steps ────────────────────────────────────────────────────────────────────

async function preflight(): Promise<void> {
  const rows = await psAll();
  const need: Array<[svc: string, why: string]> = [
    ["postgres", "the wipe runs psql in-container"],
    ["redis", "the seq-counter cleanup targets it"],
    ["anvil", "it IS the backfill source (in-memory chain — never stop it)"],
  ];
  const missing: string[] = [];
  for (const [svc, why] of need) {
    const row = rows.get(svc);
    const healthy = row?.State === "running" && (row.Health === "healthy" || row.Health === "");
    if (!healthy) missing.push(`${svc} (${row ? `${row.State}/${row.Health || "no-health"}` : "not created"}) — ${why}`);
  }
  if (missing.length > 0) {
    console.error("[db-reset] FAIL — the compose stack is not up/healthy:");
    for (const m of missing) console.error(`[db-reset]   ✘ ${m}`);
    console.error("[db-reset] bring it up first: `bun run dev:stack`");
    process.exit(1);
  }
  console.log("[db-reset] ✔ preflight — postgres/redis/anvil healthy");
}

async function stopConsumers(): Promise<void> {
  console.log(`[db-reset] stopping consumers: ${CONSUMERS.join(", ")} …`);
  const res = await compose(["stop", ...CONSUMERS], { inherit: true });
  if (res.code !== 0) {
    console.error(`[db-reset] FAIL — \`docker compose stop\` exited ${res.code}`);
    process.exit(1);
  }
}

async function wipePostgres(): Promise<void> {
  // Optional non-default Ponder schema (compose sets none; honor the same env
  // Ponder reads). Identifier-validated before interpolation.
  const extraSchema = env("DATABASE_SCHEMA", "public");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(extraSchema)) {
    console.error(`[db-reset] FAIL — DATABASE_SCHEMA ${JSON.stringify(extraSchema)} is not a plain identifier`);
    process.exit(1);
  }
  const dropExtra = extraSchema === "public" ? "" : `DROP SCHEMA IF EXISTS "${extraSchema}" CASCADE;`;
  const sql = `
-- dev:db:reset — drop everything the indexer/API own, restore bootstrap state.
DROP SCHEMA IF EXISTS ponder_sync CASCADE;  -- Ponder RPC cache: force refetch from chain
${dropExtra}
DROP SCHEMA IF EXISTS public CASCADE;       -- Ponder app tables + offchain sidecar + API tables
-- Recreate \`public\` in the PG15+ default shape (owner pg_database_owner, USAGE
-- to PUBLIC — postgresql.org/docs/current/ddl-schemas.html).
CREATE SCHEMA public AUTHORIZATION pg_database_owner;
COMMENT ON SCHEMA public IS 'standard public schema';
GRANT USAGE ON SCHEMA public TO PUBLIC;
-- Mirror of docker/postgres/init/01-pg_trgm.sql (the canonical initdb SQL; the
-- indexer's startup assertion requires the extension to already exist).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
`;
  console.log("[db-reset] wiping Postgres (drop public + ponder_sync, restore bootstrap) …");
  // Credentials stay compose-owned: psql runs in-container with ITS env.
  const res = await compose(
    ["exec", "-T", "postgres", "sh", "-c",
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --no-psqlrc -f -'],
    { stdin: sql },
  );
  if (res.code !== 0) {
    console.error(`[db-reset] FAIL — psql wipe exited ${res.code}`);
    process.exit(1);
  }
  console.log("[db-reset] ✔ postgres wiped; public schema + pg_trgm restored");
}

async function clearRedisSeqKeys(): Promise<void> {
  // SCAN MATCH `*:seq` — the only persisted keys (see decision basis in header);
  // never FLUSHALL (least destruction; Redis also carries live pub/sub traffic).
  const redis = new RedisClient(`redis://localhost:${REDIS_PORT}`);
  try {
    let cursor = "0";
    let deleted = 0;
    do {
      const reply = (await redis.send("SCAN", [cursor, "MATCH", "*:seq", "COUNT", "500"])) as [string, string[]];
      cursor = reply[0];
      const keys = reply[1];
      if (keys.length > 0) {
        const n = (await redis.send("DEL", keys)) as number;
        deleted += Number(n);
      }
    } while (cursor !== "0");
    console.log(`[db-reset] ✔ redis — deleted ${deleted} \`*:seq\` channel counters (latch is process-local; nothing else persisted)`);
  } catch (err) {
    console.error("[db-reset] FAIL — redis seq cleanup:", err);
    process.exit(1);
  } finally {
    redis.close();
  }
}

async function rerunApiMigrations(): Promise<void> {
  // The API does not apply migrations at boot — re-run the one-shot. `--no-deps`:
  // postgres is preflight-verified healthy; never let compose touch other services.
  console.log("[db-reset] re-running the apimigrations one-shot …");
  const res = await compose(["run", "--rm", "--no-deps", "apimigrations"], { inherit: true });
  if (res.code !== 0) {
    console.error(`[db-reset] FAIL — apimigrations exited ${res.code}`);
    process.exit(1);
  }
}

/** mtime of the deploychain artifact — the "did deploychain re-run?" tripwire. */
function localEnvMtime(): number {
  try {
    return statSync(LOCAL_ENV_PATH).mtimeMs;
  } catch {
    console.error(`[db-reset] FAIL — ${LOCAL_ENV_PATH} missing; the stack never deployed. Run \`bun run dev:stack\`.`);
    process.exit(1);
  }
}

async function startConsumers(): Promise<void> {
  // Plain `docker start` on compose-resolved container names — BOTH `compose up`
  // and `compose start` re-run exited depends_on one-shots (deploychain!) —
  // observed live 2026-07-12; see decision basis in the header.
  const rows = await psAll();
  const names: string[] = [];
  for (const svc of CONSUMERS) {
    const row = rows.get(svc);
    if (!row?.Name) {
      console.error(`[db-reset] FAIL — no container for service \`${svc}\` (removed?). Run \`bun run dev:stack\`.`);
      process.exit(1);
    }
    names.push(row.Name);
  }
  console.log(`[db-reset] docker start ${names.join(" ")} …`);
  const proc = Bun.spawn(["docker", "start", ...names], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) {
    console.error("[db-reset] FAIL — `docker start` failed (containers missing? run `bun run dev:stack`)");
    process.exit(1);
  }
}

async function httpOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function waitForReady(): Promise<void> {
  const indexerReady = `http://localhost:${PONDER_PORT}/ready`; // 200 ⇔ backfill complete (ponder.sh docs)
  const apiReady = `http://localhost:${API_PORT}/v1/readyz`;
  console.log(`[db-reset] waiting for re-backfill: ${indexerReady} + ${apiReady} + ws healthy (deadline ${Math.round(TIMEOUT_MS / 1000)}s)`);
  const started = Date.now();
  let last = "";
  for (;;) {
    // Fail fast on a crashed consumer instead of waiting out the deadline.
    const rows = await psAll();
    const crashed = CONSUMERS.filter((svc) => {
      const r = rows.get(svc);
      return !r || r.State === "exited" || r.State === "dead";
    });
    if (crashed.length > 0) {
      console.error(`\n[db-reset] FAIL — consumer(s) died during re-backfill: ${crashed.join(", ")}`);
      await dumpLogs(crashed);
      process.exit(1);
    }

    const [idx, api] = await Promise.all([httpOk(indexerReady), httpOk(apiReady)]);
    const wsRow = rows.get("ws");
    const ws = wsRow?.State === "running" && (wsRow.Health === "healthy" || wsRow.Health === "");
    const status = `indexer:${idx ? "ready" : "…"} api:${api ? "ready" : "…"} ws:${ws ? "ready" : "…"}`;
    if (status !== last) {
      last = status;
      console.log(`[db-reset] ${status} (${Math.round((Date.now() - started) / 1000)}s)`);
    }
    if (idx && api && ws) {
      console.log(`\n[db-reset] ✔ re-backfill complete in ${Math.round((Date.now() - started) / 1000)}s — chain state re-derived from anvil.`);
      return;
    }
    if (Date.now() - started > TIMEOUT_MS) {
      const pending = CONSUMERS.filter((s, i) => [!idx, !api, !ws][i]);
      console.error(`\n[db-reset] FAIL — timeout after ${Math.round(TIMEOUT_MS / 1000)}s; not ready: ${pending.join(", ")}`);
      await dumpLogs(pending.length > 0 ? pending : [...CONSUMERS]);
      process.exit(1);
    }
    await Bun.sleep(POLL_MS);
  }
}

async function main(): Promise<void> {
  loudWarning();
  await preflight();
  const localEnvBefore = localEnvMtime();
  await stopConsumers();
  await wipePostgres();
  await clearRedisSeqKeys();
  await rerunApiMigrations();
  await startConsumers();
  // Tripwire: if the deploychain artifact changed, a one-shot re-ran and the
  // contract world was REDEPLOYED — the reset's core guarantee is broken.
  if (localEnvMtime() !== localEnvBefore) {
    console.error("[db-reset] FAIL — tools/localstack/out/local.env was rewritten during the reset:");
    console.error("[db-reset] the deploychain one-shot re-ran (contracts redeployed, new START_BLOCK) —");
    console.error("[db-reset] the DB will backfill a DIFFERENT world than the one wiped. This is a bug");
    console.error("[db-reset] in the restart path (it must never trigger compose dependency processing).");
    process.exit(1);
  }
  await waitForReady();
  loudWarning();
  console.log("[db-reset] done — verify with `bun run dev:health`.");
  process.exit(0);
}

await main();
