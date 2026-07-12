/**
 * Internal dashboard endpoints (D-4; api.md §3.7; M2-13/M2-14 verify legs).
 * — GET /internal/flow/:address returns organic % (the shared organicFlowSchema
 *   RANGE) + bot-flag counts for a SEEDED token (M2-13 verify clause);
 * — GET /internal/competitor-snapshots is paged newest-first with §2
 *   source+timestamp on EVERY row, empty (never fabricated) while the source
 *   is unconfigured (M2-14 verify clause);
 * — both are admin-SIWE-gated (401 without a session).
 */
import { describe, expect, it } from "bun:test";
import { organicFlowSchema, type CompetitorSnapshotRow } from "@robbed/shared";
import { SESSION_COOKIE, issueSession } from "../src/admin/session";
import { createApp } from "../src/app";
import { FakeDb, TEST_ADDR, makeTestDeps, readJson, testConfig } from "./helpers";

const ADMIN = "0x1111111111111111111111111111111111111111";
const UNKNOWN = "0x9999999999999999999999999999999999999999";

function internalDeps() {
  const config = testConfig({
    SESSION_SECRET: "admin-secret",
    adminAllowlist: new Set([ADMIN]),
  });
  const db = new FakeDb();
  const deps = makeTestDeps({ config, db });
  const { cookieValue } = issueSession(config.SESSION_SECRET, ADMIN, "nonceX", 1_700_000_000);
  const headers = { Cookie: `${SESSION_COOKIE}=${cookieValue}` };
  return { deps, db, headers };
}

function snapshot(overrides: Partial<CompetitorSnapshotRow> = {}): CompetitorSnapshotRow {
  return {
    source: "dune:query/1234567",
    captured_at: "2026-07-05T00:00:00.000Z",
    tokens_per_day: 42,
    graduations: 3,
    visible_volume_eth: "12000000000000000000",
    ...overrides,
  };
}

describe("internal endpoints — admin-SIWE gate (D-4)", () => {
  it("401s both endpoints without a session", async () => {
    const { deps } = internalDeps();
    const app = createApp(deps);
    for (const path of [`/internal/flow/${TEST_ADDR}`, "/internal/competitor-snapshots"]) {
      const res = await app.request(new Request(`http://x${path}`));
      expect(res.status).toBe(401);
      expect((await readJson(res)).error.code).toBe("unauthorized");
    }
  });
});

describe("GET /internal/flow/:address (M2-13; Gate G-A.1)", () => {
  it("returns organic % for a seeded token — the shared organicFlowSchema RANGE", async () => {
    const { deps, db, headers } = internalDeps();
    db.flowStats.set(TEST_ADDR, {
      token_address: TEST_ADDR,
      organic_holder_pct_low: 35,
      organic_holder_pct_high: 60,
      organic_volume_pct: 48.5,
      flagged_cluster_vol_pct_24h: 22,
      updated_at: "2026-07-11T00:00:00.000Z",
    });
    db.flagSummaries.set(TEST_ADDR, {
      flaggedHolders: 7,
      clusterCount: 2,
      byFlag: { farm: 5, sniper: 3 },
    });
    const res = await createApp(deps).request(
      new Request(`http://x/internal/flow/${TEST_ADDR}`, { headers }),
    );
    expect(res.status).toBe(200);
    const { data } = await readJson(res);
    expect(data.token).toBe(TEST_ADDR);
    // organic is EXACTLY the shared shape the Trust panel gets (anti-drift).
    expect(() => organicFlowSchema.parse(data.organic)).not.toThrow();
    expect(data.organic.holderPctLow).toBe(35);
    expect(data.organic.holderPctHigh).toBe(60); // a RANGE, never a point (§5.2)
    expect(data.organic.volumePct).toBe(48.5);
    expect(data.organic.flaggedClusterVolPct24h).toBe(22);
    // flagged summary: per-flag counts zero-filled to the full BotFlag record.
    expect(data.flagged).toEqual({
      holders: 7,
      clusters: 2,
      byFlag: { farm: 5, sniper: 3, programmatic: 0, wash: 0, arb_exit: 0 },
    });
  });

  it("organic is null (never fabricated) before the §8.5 job computes stats", async () => {
    const { deps, headers } = internalDeps();
    const res = await createApp(deps).request(
      new Request(`http://x/internal/flow/${TEST_ADDR}`, { headers }),
    );
    expect(res.status).toBe(200);
    const { data } = await readJson(res);
    expect(data.organic).toBeNull();
    expect(data.flagged.holders).toBe(0);
    expect(data.flagged.byFlag).toEqual({ farm: 0, sniper: 0, programmatic: 0, wash: 0, arb_exit: 0 });
  });

  it("404s an unknown token", async () => {
    const { deps, headers } = internalDeps();
    const res = await createApp(deps).request(
      new Request(`http://x/internal/flow/${UNKNOWN}`, { headers }),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /internal/competitor-snapshots (M2-14; Gate G-A.2)", () => {
  it("returns seeded snapshots newest-first, §2 source+timestamp on every row", async () => {
    const { deps, db, headers } = internalDeps();
    db.competitorSnapshots = [
      snapshot({ captured_at: "2026-06-21T00:00:00.000Z", tokens_per_day: 30 }),
      snapshot({ captured_at: "2026-07-05T00:00:00.000Z", tokens_per_day: 42 }),
      snapshot({ captured_at: "2026-06-28T00:00:00.000Z", tokens_per_day: 36 }),
    ];
    const res = await createApp(deps).request(
      new Request("http://x/internal/competitor-snapshots", { headers }),
    );
    expect(res.status).toBe(200);
    const { data } = await readJson(res);
    expect(data.snapshots.map((s: CompetitorSnapshotRow) => s.captured_at)).toEqual([
      "2026-07-05T00:00:00.000Z",
      "2026-06-28T00:00:00.000Z",
      "2026-06-21T00:00:00.000Z",
    ]);
    for (const s of data.snapshots) {
      expect(s.source).toBeTruthy(); // never fabricated / never sourceless (§2)
      expect(s.captured_at).toBeTruthy();
      expect(s.visible_volume_eth).toMatch(/^\d+$/); // wei decimal string
    }
    expect(data.nextCursor).toBeNull();
  });

  it("pages with a keyset cursor (captured_at, source) DESC", async () => {
    const { deps, db, headers } = internalDeps();
    db.competitorSnapshots = [
      snapshot({ captured_at: "2026-06-21T00:00:00.000Z" }),
      snapshot({ captured_at: "2026-07-05T00:00:00.000Z" }),
      snapshot({ captured_at: "2026-06-28T00:00:00.000Z" }),
    ];
    const app = createApp(deps);
    const page1 = await readJson(
      await app.request(new Request("http://x/internal/competitor-snapshots?limit=2", { headers })),
    );
    expect(page1.data.snapshots).toHaveLength(2);
    expect(page1.data.nextCursor).toBeTruthy();
    const page2 = await readJson(
      await app.request(
        new Request(
          `http://x/internal/competitor-snapshots?limit=2&cursor=${encodeURIComponent(page1.data.nextCursor)}`,
          { headers },
        ),
      ),
    );
    expect(page2.data.snapshots).toHaveLength(1);
    expect(page2.data.snapshots[0].captured_at).toBe("2026-06-21T00:00:00.000Z");
    expect(page2.data.nextCursor).toBeNull();
  });

  it("returns an empty page while the snapshot source is unconfigured — never a fabricated metric", async () => {
    const { deps, headers } = internalDeps();
    const res = await createApp(deps).request(
      new Request("http://x/internal/competitor-snapshots", { headers }),
    );
    expect(res.status).toBe(200);
    const { data } = await readJson(res);
    expect(data.snapshots).toEqual([]);
    expect(data.nextCursor).toBeNull();
  });
});
