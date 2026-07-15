/**
 * Offchain migration phasing (src/offchainMigrations.ts) — the I-5b fresh-DB
 * ordering defect, covered:
 *  - phase 1 always applies (schema public); phase 2 (0003 GIN + 0005 flow
 *    views + 0007 pnl views) is SKIPPED while the Ponder `tokens` table is
 *    absent and APPLIED (in the Ponder schema) once it exists;
 *  - `applyMigrationsAtBoot` (the sidecar-boot entry that replaced the compose
 *    /ready-polling stopgap) retries transient failures, never throws, and
 *    reports false when phase 2 could not be applied;
 *  - every phase-2 statement is idempotent by construction (IF NOT EXISTS /
 *    OR REPLACE) — the invariant that makes the every-boot re-apply safe.
 */
import { describe, expect, it } from "bun:test";
import {
  PHASE1_FILES,
  PHASE2_FILES,
  applyMigrationsAtBoot,
  applyOffchainMigrations,
  migrationSql,
  type SqlClient,
} from "../src/offchainMigrations";

/** Records every query; simulates presence/absence of the Ponder tokens table. */
function fakeClient(opts: { tokensExists: boolean }) {
  const queries: Array<{ text: string; params?: unknown[] }> = [];
  const client: SqlClient = {
    async query(text: string, params?: unknown[]) {
      queries.push({ text, params });
      if (text.includes("information_schema.tables")) {
        return { rows: opts.tokensExists ? [{ ok: 1 }] : [] };
      }
      return { rows: [] };
    },
  };
  return { client, queries };
}

/** search_path in effect when the given SQL text was executed. */
function schemaFor(queries: Array<{ text: string }>, sqlText: string): string | null {
  let current: string | null = null;
  for (const q of queries) {
    const m = q.text.match(/^SET search_path TO (.+)$/);
    if (m) current = m[1]!;
    if (q.text === sqlText) return current;
  }
  return null;
}

const noop = () => {};

describe("applyOffchainMigrations — fresh-DB ordering (I-5b)", () => {
  it("fresh DB (no Ponder tokens table): phase 1 applies, phase 2 is skipped", async () => {
    const { client, queries } = fakeClient({ tokensExists: false });
    const warns: string[] = [];
    const result = await applyOffchainMigrations(client, {
      ponderSchema: "public",
      log: noop,
      warn: (m) => warns.push(m),
    });
    expect(result.phase2Applied).toBe(false);
    // Every phase-1 file executed, in order, in schema public.
    for (const file of PHASE1_FILES) {
      expect(schemaFor(queries, migrationSql(file))).toBe('"public"');
    }
    const texts = queries.map((q) => q.text);
    const phase1Positions = PHASE1_FILES.map((f) => texts.indexOf(migrationSql(f)));
    expect(phase1Positions.every((p) => p >= 0)).toBe(true);
    expect([...phase1Positions].sort((a, b) => a - b)).toEqual(phase1Positions);
    // No phase-2 SQL executed.
    for (const file of PHASE2_FILES) {
      expect(texts).not.toContain(migrationSql(file));
    }
    expect(warns.length).toBe(1);
  });

  it("tokens table present: phase 2 applies after phase 1, in the Ponder schema", async () => {
    const { client, queries } = fakeClient({ tokensExists: true });
    const result = await applyOffchainMigrations(client, {
      ponderSchema: "ponder_live",
      log: noop,
    });
    expect(result.phase2Applied).toBe(true);
    const texts = queries.map((q) => q.text);
    // Phase 2 in the PONDER schema (not public), each file executed in order,
    // strictly after the last phase-1 file.
    const lastPhase1 = texts.indexOf(migrationSql(PHASE1_FILES[PHASE1_FILES.length - 1]!));
    for (const file of PHASE2_FILES) {
      expect(schemaFor(queries, migrationSql(file))).toBe('"ponder_live", public');
      expect(texts.indexOf(migrationSql(file))).toBeGreaterThan(lastPhase1);
    }
    const phase2Positions = PHASE2_FILES.map((f) => texts.indexOf(migrationSql(f)));
    expect([...phase2Positions].sort((a, b) => a - b)).toEqual(phase2Positions);
  });

  it("re-apply is a pure re-run (same statements — idempotency lives in the SQL)", async () => {
    const a = fakeClient({ tokensExists: true });
    const b = fakeClient({ tokensExists: true });
    await applyOffchainMigrations(a.client, { ponderSchema: "public", log: noop });
    await applyOffchainMigrations(b.client, { ponderSchema: "public", log: noop });
    expect(a.queries.map((q) => q.text)).toEqual(b.queries.map((q) => q.text));
  });
});

describe("applyMigrationsAtBoot (sidecar entry)", () => {
  function poolOf(clientFactory: () => SqlClient, failFirst = 0) {
    let calls = 0;
    return {
      connects: () => calls,
      async connect() {
        calls++;
        if (calls <= failFirst) throw new Error("transient: connection refused");
        const c = clientFactory();
        return { ...c, release: noop };
      },
    };
  }

  it("applies both phases and returns true (tokens exist at :setup by construction)", async () => {
    const { client } = fakeClient({ tokensExists: true });
    const pool = poolOf(() => client);
    const ok = await applyMigrationsAtBoot(pool, "public", { log: noop, error: noop });
    expect(ok).toBe(true);
    expect(pool.connects()).toBe(1);
  });

  it("retries transient failures, then succeeds — never throws into indexing", async () => {
    const { client } = fakeClient({ tokensExists: true });
    const pool = poolOf(() => client, 2);
    const errors: string[] = [];
    const ok = await applyMigrationsAtBoot(pool, "public", {
      delayMs: 1,
      log: noop,
      error: (m) => errors.push(m),
    });
    expect(ok).toBe(true);
    expect(pool.connects()).toBe(3);
    expect(errors.length).toBe(2);
  });

  it("exhausted retries → false + loud error, no throw", async () => {
    const pool = poolOf(() => fakeClient({ tokensExists: true }).client, 99);
    const errors: string[] = [];
    const ok = await applyMigrationsAtBoot(pool, "public", {
      attempts: 3,
      delayMs: 1,
      log: noop,
      error: (m) => errors.push(m),
    });
    expect(ok).toBe(false);
    expect(errors.some((m) => m.includes("FAILED after all retries"))).toBe(true);
  });

  it("tokens table missing at boot (schema mismatch) → false, flagged as anomaly", async () => {
    const { client } = fakeClient({ tokensExists: false });
    const pool = poolOf(() => client);
    const errors: string[] = [];
    const ok = await applyMigrationsAtBoot(pool, "wrong_schema", {
      attempts: 1,
      delayMs: 1,
      log: noop,
      error: (m, err) =>
        errors.push(`${m} ${err instanceof Error ? err.message : String(err)}`),
    });
    expect(ok).toBe(false);
    expect(errors.some((m) => m.includes("DATABASE_SCHEMA"))).toBe(true);
  });
});

describe("phase-2 SQL is idempotent by construction (safe to re-apply every boot)", () => {
  it("all indexes IF NOT EXISTS; all views OR REPLACE; no CREATE TABLE", () => {
    for (const file of PHASE2_FILES) {
      const sql = migrationSql(file)
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
      // Any CREATE INDEX must carry IF NOT EXISTS (negative lookahead: a bare
      // CREATE INDEX not immediately followed by IF NOT EXISTS fails the suite).
      expect(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i.test(sql)).toBe(false);
      // Any CREATE VIEW must be CREATE OR REPLACE VIEW.
      expect(/CREATE\s+VIEW/i.test(sql)).toBe(false);
      // Phase 2 never creates tables (those are phase 1 / Ponder's).
      expect(/CREATE\s+TABLE/i.test(sql)).toBe(false);
    }
  });
});
