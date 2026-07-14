/**
 * token_metrics coalescer (D-70) — throttle / per-token coalescing / last-write-wins
 * by blockNumber, ONE batched anchor read per flush, backfill + unarmed gating, and
 * the ETH-first payload projection (mcap/progress/status parity with the API card +
 * the shared `computeChange24hPct` anchor). Drives the coalescer directly with fakes
 * (no timer, no DB, no real Redis) — the fixed-interval timer is a thin `setInterval`
 * wrapper over the `flush()` exercised here.
 */
import { describe, expect, it } from "bun:test";
import { GLOBAL_METRICS, wsTokenMetricsDataSchema } from "@robbed/shared";
import {
  TokenMetricsCoalescer,
  buildTokenMetrics,
  mcapEthWei,
  progressFraction,
  statusFrom,
  type MetricsCoalescerStore,
  type MetricsInputRow,
} from "../src/tokenMetrics";
import type { RedisPublisher } from "../src/publish";

const NOW_MS = 1_700_000_300_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);
const settle = () => new Promise((r) => setTimeout(r, 5));

const TOKEN_A = "0x" + "aa".repeat(20);
const TOKEN_B = "0x" + "bb".repeat(20);
const TOKEN_C = "0x" + "cc".repeat(20);

/** Capturing publisher (parses the enveloped frames the coalescer fires). */
function capturing() {
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

/** Fake batched store — records the token lists it was asked for. */
function fakeStore(rows: Record<string, MetricsInputRow>, opts: { throwOnce?: boolean } = {}) {
  const calls: string[][] = [];
  let threw = false;
  const store: MetricsCoalescerStore = {
    async readInputs(tokens) {
      calls.push([...tokens]);
      if (opts.throwOnce && !threw) {
        threw = true;
        throw new Error("boom");
      }
      const m = new Map<string, MetricsInputRow>();
      for (const t of tokens) if (rows[t]) m.set(t, rows[t]);
      return m;
    },
  };
  return { store, calls };
}

function row(over: Partial<MetricsInputRow> = {}): MetricsInputRow {
  return {
    token: TOKEN_A,
    lastPriceEth: 0.00000003, // 3e-8 ETH/token
    totalSupply: (1_000_000_000n * 10n ** 18n).toString(), // 1e9 tokens
    realEthReserves: (5n * 10n ** 18n).toString(),
    graduationEth: (85n * 10n ** 18n).toString(),
    volumeEth24h: (12n * 10n ** 18n).toString(),
    graduated: false,
    createdAt: NOW_SEC - 100,
    firstTradePrice: 0.00000001,
    hourCandles: [],
    ...over,
  };
}

/** Armed coalescer with the timer immediately stopped → manual `flush()` control. */
function armed(store: MetricsCoalescerStore, publisher: RedisPublisher, gate = true) {
  const c = new TokenMetricsCoalescer(2000, () => NOW_MS, () => gate);
  c.start({ store, publisher });
  c.stop(); // drop the interval; store/publisher stay armed for manual flush()
  return c;
}

// ── projection parity (mcap / progress / status / change24h) ─────────────────

describe("token_metrics payload projection", () => {
  it("mcapEthWei matches the API card integer-space math (no float loss)", () => {
    // 3e-8 ETH/token × 1e9 tokens = 30 ETH = 3e19 wei.
    expect(mcapEthWei(0.00000003, (1_000_000_000n * 10n ** 18n).toString())).toBe(
      (30n * 10n ** 18n).toString(),
    );
    expect(mcapEthWei(null, "123")).toBe("0"); // null price → "0"
  });

  it("progressFraction / statusFrom mirror the card derivation", () => {
    // `ratio` truncates at 6 decimals (integer-space, matches the API `ratio`).
    expect(progressFraction((5n * 10n ** 18n).toString(), (85n * 10n ** 18n).toString())).toBeCloseTo(
      5 / 85,
      5,
    );
    // Over-1 clamped for display sanity (card parity).
    expect(progressFraction((90n * 10n ** 18n).toString(), (85n * 10n ** 18n).toString())).toBe(1);
    expect(statusFrom(false, "0", "0")).toBe("graduating"); // real ≥ grad (both 0)
    expect(statusFrom(false, "5", "85")).toBe("curve");
    expect(statusFrom(true, "5", "85")).toBe("graduated");
  });

  it("builds a schema-valid ETH-first payload; change24hPct via the shared anchor", () => {
    const r = row({
      lastPriceEth: 3.0,
      createdAt: NOW_SEC - 5 * 86_400, // old token → 1h-candle anchor
      firstTradePrice: 0.5,
      hourCandles: [{ bucket_start: NOW_SEC - 86_400 - 3600, close: 2.0 }],
    });
    const data = buildTokenMetrics(r, { token: TOKEN_A, blockNumber: 99, blockTimestamp: NOW_SEC }, NOW_SEC);
    expect(() => wsTokenMetricsDataSchema.parse(data)).not.toThrow();
    expect(data.change24hPct).toBeCloseTo(50, 9); // (3 − 2)/2 = +50%
    expect(data.blockNumber).toBe(99);
    expect(data.ts).toBe(NOW_SEC);
  });
});

// ── coalescing / throttle / last-write-wins ──────────────────────────────────

describe("token_metrics coalescing", () => {
  it("coalesces per token, last-write-wins by blockNumber (a straggler can't downgrade)", () => {
    const { store } = fakeStore({ [TOKEN_A]: row() });
    const { publisher } = capturing();
    const c = armed(store, publisher);
    c.enqueue({ token: TOKEN_A, blockNumber: 10, blockTimestamp: NOW_SEC - 3 });
    c.enqueue({ token: TOKEN_A, blockNumber: 12, blockTimestamp: NOW_SEC - 1 });
    c.enqueue({ token: TOKEN_A, blockNumber: 11, blockTimestamp: NOW_SEC - 2 }); // out-of-order straggler
    expect(c.pendingSize).toBe(1); // one entry per token
    expect(c.peekPending(TOKEN_A)?.blockNumber).toBe(12); // highest block wins
  });

  it("one flush = ONE batched read for all pending tokens + one publish each", async () => {
    const { store, calls } = fakeStore({
      [TOKEN_A]: row({ token: TOKEN_A }),
      [TOKEN_B]: row({ token: TOKEN_B }),
      [TOKEN_C]: row({ token: TOKEN_C }),
    });
    const { publisher, messages } = capturing();
    const c = armed(store, publisher);
    c.enqueue({ token: TOKEN_A, blockNumber: 1, blockTimestamp: NOW_SEC });
    c.enqueue({ token: TOKEN_A, blockNumber: 2, blockTimestamp: NOW_SEC }); // coalesced
    c.enqueue({ token: TOKEN_B, blockNumber: 3, blockTimestamp: NOW_SEC });
    c.enqueue({ token: TOKEN_C, blockNumber: 4, blockTimestamp: NOW_SEC });

    const published = await c.flush();
    await settle();

    expect(calls.length).toBe(1); // ONE anchor query for the whole batch (not per trade)
    expect(calls[0]!.sort()).toEqual([TOKEN_A, TOKEN_B, TOKEN_C].sort());
    expect(published).toBe(3);
    expect(messages.length).toBe(3);
    for (const m of messages) {
      expect(m.channel).toBe(GLOBAL_METRICS);
      expect(m.msg.type).toBe("token_metrics");
      expect(() => wsTokenMetricsDataSchema.parse(m.msg.data)).not.toThrow();
    }
    const aFrame = messages.find((m) => (m.msg.data as { token: string }).token === TOKEN_A)!;
    expect((aFrame.msg.data as { blockNumber: number }).blockNumber).toBe(2); // last-write-wins carried through
    expect(c.pendingSize).toBe(0); // drained
  });

  it("empty pending → no DB read, nothing published", async () => {
    const { store, calls } = fakeStore({});
    const { publisher, messages } = capturing();
    const c = armed(store, publisher);
    const published = await c.flush();
    await settle();
    expect(calls.length).toBe(0);
    expect(published).toBe(0);
    expect(messages.length).toBe(0);
  });

  it("a failed read is swallowed (advisory); the next flush recovers", async () => {
    const { store, calls } = fakeStore({ [TOKEN_A]: row() }, { throwOnce: true });
    const { publisher, messages } = capturing();
    const c = armed(store, publisher);
    c.enqueue({ token: TOKEN_A, blockNumber: 1, blockTimestamp: NOW_SEC });
    expect(await c.flush()).toBe(0); // throws internally → 0, no rejection
    c.enqueue({ token: TOKEN_A, blockNumber: 2, blockTimestamp: NOW_SEC });
    expect(await c.flush()).toBe(1); // store recovered
    await settle();
    expect(calls.length).toBe(2);
    expect(messages.length).toBe(1);
  });
});

// ── gating: backfill + unarmed ───────────────────────────────────────────────

describe("token_metrics gating", () => {
  it("suppresses enqueue during backfill (publish gate closed)", () => {
    const { store } = fakeStore({ [TOKEN_A]: row() });
    const { publisher } = capturing();
    const c = armed(store, publisher, /* gate */ false);
    c.enqueue({ token: TOKEN_A, blockNumber: 1, blockTimestamp: NOW_SEC });
    expect(c.pendingSize).toBe(0); // nothing accumulates during historical sync
  });

  it("no-ops before start() so nothing accumulates with the sidecar off", () => {
    const c = new TokenMetricsCoalescer(2000, () => NOW_MS, () => true);
    c.enqueue({ token: TOKEN_A, blockNumber: 1, blockTimestamp: NOW_SEC }); // never armed
    expect(c.pendingSize).toBe(0);
  });
});
