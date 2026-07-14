/**
 * Confirmation tracker transition suite (indexer.md,
 * M2-6, reworked to the OI-11 sidecar READ-DERIVATION design). Exercises the PURE
 * decisions + the injectable `runTrackerTick` driver — the same code the sidecar
 * runs in production. Properties: monotonicity (a derived tier can never regress
 * because the watermark never regresses — the ONLY anchor now that no per-row
 * state is stored), boundary-block correctness (event AT the watermark), reorg
 * notice, OI-8 null tags, and the OI-11 invariant itself: the tracker performs
 * NO writes besides the watermark singleton.
 */
import { describe, expect, it } from "bun:test";
import { stateForBlock, upgradeConfirmationState, type ConfirmationState } from "@robbed/shared";
import {
  deriveConfirmationStates,
  detectReorg,
  nextWatermark,
  runTrackerTick,
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
  const calls = { save: [] as WatermarkState[] };
  let current = initial;
  const store: ConfirmationStore = {
    async loadWatermarks() {
      return current;
    },
    async saveWatermarks(wm) {
      current = wm;
      calls.save.push(wm);
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

describe("deriveConfirmationStates — read-derivation boundary correctness", () => {
  const wm = { safe: 100, finalized: 50 };

  it("event AT safe block → posted_to_l1; AT finalized → finalized", () => {
    const rows = deriveConfirmationStates(
      [
        { blockNumber: 50 }, // == finalized
        { blockNumber: 51 }, // > finalized, <= safe
        { blockNumber: 100 }, // == safe
        { blockNumber: 101 }, // > safe
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

  it("agrees with the shared stateForBlock rule (single source, anti-drift)", () => {
    for (const block of [0, 49, 50, 51, 99, 100, 101, 10_000]) {
      const [row] = deriveConfirmationStates([{ blockNumber: block }], wm);
      expect(row!.confirmationState).toBe(
        stateForBlock(block, { safeBlock: wm.safe, finalizedBlock: wm.finalized }),
      );
    }
  });
});

describe("monotonicity — derived tiers never regress under watermark advance", () => {
  it("for any block, each monotone watermark step only ever upgrades the tier", () => {
    // Simulated tracker lifetime: watermark sequence produced by nextWatermark
    // over observed readings that include transient LOWER readings (the exact
    // OI-11 failure mode when it was a stored column).
    const observations: ObservedTags[] = [
      { latest: 100, safe: 40, finalized: 20 },
      { latest: 120, safe: 60, finalized: 30 },
      { latest: 118, safe: 55, finalized: 25 }, // transient regress reading
      { latest: 130, safe: 80, finalized: 60 },
      { latest: 140, safe: 100, finalized: 90 },
    ];
    const blocks = [0, 10, 25, 30, 55, 60, 80, 95, 100, 101, 500];
    let wm: WatermarkState = { latest: 0, safe: 0, finalized: 0 };
    const previous = new Map<number, ConfirmationState>();
    for (const obs of observations) {
      wm = nextWatermark(wm, obs).next;
      for (const block of blocks) {
        const [row] = deriveConfirmationStates([{ blockNumber: block }], wm);
        const prev = previous.get(block) ?? "soft_confirmed";
        // upgrade(prev, next) === next ⟺ next never ranks below prev.
        expect(upgradeConfirmationState(prev, row!.confirmationState)).toBe(row!.confirmationState);
        previous.set(block, row!.confirmationState);
      }
    }
  });

  it("boundary block upgrades exactly once per tier and sticks at finalized", () => {
    const block = 50;
    const steps = [
      { safe: 0, finalized: 0, expected: "soft_confirmed" },
      { safe: 50, finalized: 0, expected: "posted_to_l1" }, // block == safe
      { safe: 80, finalized: 50, expected: "finalized" }, // block == finalized
      { safe: 90, finalized: 70, expected: "finalized" }, // stays finalized
    ] as const;
    for (const s of steps) {
      const [row] = deriveConfirmationStates([{ blockNumber: block }], s);
      expect(row!.confirmationState).toBe(s.expected);
    }
  });
});

// ── driver integration ──────────────────────────────────────────────────────

describe("runTrackerTick — end-to-end transitions (sidecar: watermark-only writes)", () => {
  const now = () => 1_700_000_000_000;

  it("advance → persist watermark + O(1) confirmations broadcast (no row writes)", async () => {
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
    // OI-11: the ONLY persistence surface is the watermark singleton.
    expect(Object.keys(store.store)).toEqual(["loadWatermarks", "saveWatermarks"]);
    expect(store.calls.save).toEqual([{ latest: 110, safe: 60, finalized: 35 }]);
    // exactly ONE confirmations message (O(1), not per-row).
    const conf = messages.filter((m) => m.msg.type === "confirmations");
    expect(conf).toHaveLength(1);
    expect(conf[0]!.channel).toBe("global:confirmations");
    expect(conf[0]!.msg.data).toEqual({ safeBlock: 60, finalizedBlock: 35 });
  });

  it("no advance → no persist, no broadcast", async () => {
    const store = fakeStore({ latest: 110, safe: 60, finalized: 35 });
    const { publisher, messages } = capturingPublisher();
    await runTrackerTick({ latest: 110, safe: 60, finalized: 35 }, {
      store: store.store,
      fetchTags: async () => ({ latest: 110, safe: 60, finalized: 35 }),
      publisher,
      now,
    });
    await flush();
    expect(store.calls.save).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });

  it("lower safe/finalized reading → watermark holds, no broadcast (no regression)", async () => {
    const store = fakeStore({ latest: 110, safe: 60, finalized: 35 });
    const next = await runTrackerTick({ latest: 110, safe: 60, finalized: 35 }, {
      store: store.store,
      fetchTags: async () => ({ latest: 110, safe: 55, finalized: 30 }),
      publisher: capturingPublisher().publisher,
      now,
    });
    await flush();
    expect(next).toEqual({ latest: 110, safe: 60, finalized: 35 });
    expect(store.calls.save).toHaveLength(0);
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
    expect(store.calls.save).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });
});
