/**
 * Confirmation tracker transition suite (indexer.md §5, spec §2.1/§12.20; M2-6).
 * Exercises the PURE decisions + the injectable `runTrackerTick` driver — the
 * same code the sidecar runs in production. Properties: monotonicity (never
 * downgrade), boundary-block correctness (event AT the watermark), reorg notice.
 */
import { describe, expect, it } from "bun:test";
import {
  detectReorg,
  materializationStatements,
  materializationStatementsForTable,
  materializeRows,
  nextWatermark,
  runTrackerTick,
  CONFIRMATION_EVENT_TABLES,
  type ConfirmationStore,
  type ObservedTags,
  type WatermarkState,
} from "../src/confirmation";
import type { RedisPublisher } from "../src/publish";

// ── capturing fakes ─────────────────────────────────────────────────────────

function capturingPublisher() {
  const seqs = new Map<string, number>();
  const messages: Array<{ channel: string; msg: Record<string, unknown> }> = [];
  const publisher: RedisPublisher = {
    async incr(key) {
      const n = (seqs.get(key) ?? 0) + 1;
      seqs.set(key, n);
      return n;
    },
    async publish(channel, message) {
      messages.push({ channel, msg: JSON.parse(message) });
    },
  };
  return { publisher, messages };
}

function fakeStore(initial: WatermarkState | null) {
  const calls = { materialize: [] as Array<{ safe: number; finalized: number }>, save: [] as WatermarkState[] };
  let current = initial;
  const store: ConfirmationStore = {
    async loadWatermarks() {
      return current;
    },
    async saveWatermarks(wm) {
      current = wm;
      calls.save.push(wm);
    },
    async materialize(wm) {
      calls.materialize.push({ safe: wm.safe, finalized: wm.finalized });
    },
  };
  return { store, calls, get current() { return current; } };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

// ── pure decisions ──────────────────────────────────────────────────────────

describe("nextWatermark — monotonic advance", () => {
  it("advances when safe/finalized increase", () => {
    const { next, advanced } = nextWatermark(
      { latest: 100, safe: 50, finalized: 30 },
      { latest: 110, safe: 60, finalized: 35 },
    );
    expect(advanced).toBe(true);
    expect(next).toEqual({ latest: 110, safe: 60, finalized: 35 });
  });

  it("never downgrades safe/finalized on a lower reading (no advance)", () => {
    const { next, advanced } = nextWatermark(
      { latest: 100, safe: 60, finalized: 40 },
      { latest: 100, safe: 55, finalized: 38 },
    );
    expect(advanced).toBe(false);
    expect(next).toEqual({ latest: 100, safe: 60, finalized: 40 });
  });
});

describe("detectReorg — head regress", () => {
  it("flags the orphan floor when head goes backwards", () => {
    expect(detectReorg(120, 117)).toBe(118);
  });
  it("returns null when head advances or holds", () => {
    expect(detectReorg(120, 120)).toBeNull();
    expect(detectReorg(120, 130)).toBeNull();
  });
});

describe("materializeRows — boundary + monotonicity", () => {
  const wm = { safe: 100, finalized: 50 };

  it("event AT safe block → posted_to_l1; AT finalized → finalized", () => {
    const rows = materializeRows(
      [
        { blockNumber: 50, confirmationState: "soft_confirmed" as const }, // == finalized
        { blockNumber: 51, confirmationState: "soft_confirmed" as const }, // > finalized, <= safe
        { blockNumber: 100, confirmationState: "soft_confirmed" as const }, // == safe
        { blockNumber: 101, confirmationState: "soft_confirmed" as const }, // > safe
      ],
      wm,
    );
    expect(rows.map((r) => r.confirmationState)).toEqual([
      "finalized",
      "posted_to_l1",
      "posted_to_l1",
      "soft_confirmed",
    ]);
  });

  it("never downgrades an already-finalized row", () => {
    const rows = materializeRows(
      [{ blockNumber: 999, confirmationState: "finalized" as const }],
      { safe: 0, finalized: 0 },
    );
    expect(rows[0]!.confirmationState).toBe("finalized");
  });
});

describe("materializationStatements — SQL shape encodes the boundaries", () => {
  it("finalized runs before posted, both use <= and the right params", () => {
    const stmts = materializationStatementsForTable("myschema", "trades", { safe: 100, finalized: 50 });
    expect(stmts).toHaveLength(2);
    expect(stmts[0]!.text).toContain("'finalized'");
    expect(stmts[0]!.text).toContain("block_number <= $1");
    expect(stmts[0]!.params).toEqual([50]);
    expect(stmts[1]!.text).toContain("'posted_to_l1'");
    expect(stmts[1]!.params).toEqual([100]);
    // posted pass only touches still-soft rows (finalized already excluded).
    expect(stmts[1]!.text).toContain("confirmation_state = 'soft_confirmed'");
    expect(stmts[0]!.text).toContain('"myschema"."trades"');
  });

  it("covers every event table carrying confirmation_state", () => {
    const stmts = materializationStatements("s", { safe: 1, finalized: 1 });
    expect(stmts).toHaveLength(CONFIRMATION_EVENT_TABLES.length * 2);
  });
});

// ── driver integration ──────────────────────────────────────────────────────

describe("runTrackerTick — end-to-end transitions", () => {
  const now = () => 1_700_000_000_000;

  it("advance → materialize + persist + O(1) confirmations broadcast", async () => {
    const store = fakeStore({ latest: 100, safe: 50, finalized: 30 });
    const { publisher, messages } = capturingPublisher();
    const observed: ObservedTags = { latest: 110, safe: 60, finalized: 35 };

    const next = await runTrackerTick({ latest: 100, safe: 50, finalized: 30 }, {
      store: store.store,
      fetchTags: async () => observed,
      publisher,
      now,
    });
    await flush();

    expect(next).toEqual({ latest: 110, safe: 60, finalized: 35 });
    expect(store.calls.materialize).toEqual([{ safe: 60, finalized: 35 }]);
    expect(store.calls.save).toHaveLength(1);
    // exactly ONE confirmations message (O(1), not per-row).
    const conf = messages.filter((m) => m.msg.type === "confirmations");
    expect(conf).toHaveLength(1);
    expect(conf[0]!.channel).toBe("global:confirmations");
    expect(conf[0]!.msg.data).toEqual({ safeBlock: 60, finalizedBlock: 35 });
  });

  it("no advance → no materialize, no broadcast", async () => {
    const store = fakeStore({ latest: 110, safe: 60, finalized: 35 });
    const { publisher, messages } = capturingPublisher();
    await runTrackerTick({ latest: 110, safe: 60, finalized: 35 }, {
      store: store.store,
      fetchTags: async () => ({ latest: 110, safe: 60, finalized: 35 }),
      publisher,
      now,
    });
    await flush();
    expect(store.calls.materialize).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });

  it("head regress → reorg notice with orphan floor; safe/finalized hold", async () => {
    const store = fakeStore({ latest: 120, safe: 60, finalized: 35 });
    const { publisher, messages } = capturingPublisher();
    const next = await runTrackerTick({ latest: 120, safe: 60, finalized: 35 }, {
      store: store.store,
      fetchTags: async () => ({ latest: 117, safe: 60, finalized: 35 }),
      publisher,
      now,
    });
    await flush();
    const reorg = messages.filter((m) => m.msg.type === "reorg");
    expect(reorg).toHaveLength(1);
    expect(reorg[0]!.msg.data).toEqual({ fromBlock: 118 });
    expect(next.latest).toBe(117);
    // watermarks (safe/finalized) never regress on a reorg.
    expect(next.safe).toBe(60);
    expect(next.finalized).toBe(35);
  });

  it("OI-8: null tags (unsupported) → no-op, state unchanged", async () => {
    const store = fakeStore({ latest: 100, safe: 50, finalized: 30 });
    const { publisher, messages } = capturingPublisher();
    const next = await runTrackerTick({ latest: 100, safe: 50, finalized: 30 }, {
      store: store.store,
      fetchTags: async () => null,
      publisher,
      now,
    });
    await flush();
    expect(next).toEqual({ latest: 100, safe: 50, finalized: 30 });
    expect(store.calls.materialize).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });
});
