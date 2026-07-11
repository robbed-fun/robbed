/**
 * Redis transport selection (prod-images.md §5 fix): the prod container runs
 * Ponder under NODE (spec §8), so the publish transport is runtime-selected —
 * Bun.RedisClient under Bun, node-redis 6.x under Node — and a silent no-op
 * transport must NEVER exist: unconstructible ⇒ THROW (startSidecars preflights
 * this at startup). Publish failures increment `redis_publish_errors_total`.
 */
import { describe, expect, it, afterEach } from "bun:test";
import {
  createBunPublisher,
  createNodePublisher,
  createReverifySubscriber,
  createRuntimePublisher,
  firePublish,
  getDefaultPublisher,
  setDefaultPublisherForTest,
  type BunRedisNamespace,
  type BunSubscriberNamespace,
  type RedisPublisher,
} from "../src/publish";
import { renderRegistry } from "../src/metrics";

// Unreachable on purpose — no test may talk to a real Redis. Clients built
// against it are close()d immediately; connect errors land in the (throttled)
// error listener, never throw.
const DEAD_URL = "redis://127.0.0.1:6399";

function fakeBun() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  class FakeRedisClient {
    constructor(url: string) {
      calls.push({ op: "ctor", args: [url] });
    }
    async send(command: string, args: string[]) {
      calls.push({ op: command, args });
      return 7;
    }
    async publish(channel: string, message: string) {
      calls.push({ op: "PUBLISH", args: [channel, message] });
      return 1;
    }
    async subscribe(channel: string, listener: (message: string, channel: string) => void) {
      calls.push({ op: "SUBSCRIBE", args: [channel] });
      listener("ping", channel);
    }
  }
  const ns: BunRedisNamespace = { RedisClient: FakeRedisClient };
  return { ns, calls };
}

function publishErrorCount(): number {
  const m = renderRegistry().match(/(?:^|\n)redis_publish_errors_total (\d+)/);
  if (!m) throw new Error("redis_publish_errors_total missing from registry");
  return Number(m[1]);
}

const flush = () => new Promise((r) => setTimeout(r, 5));

afterEach(() => setDefaultPublisherForTest(null));

// ── Runtime selection ───────────────────────────────────────────────────────

describe("createRuntimePublisher — Bun-vs-Node selection", () => {
  it("Bun global present → Bun transport (INCR via send, PUBLISH via publish)", async () => {
    const { ns, calls } = fakeBun();
    const pub = createRuntimePublisher("redis://fake:6379", ns);
    expect(pub.kind).toBe("bun");
    expect(await pub.incr("channel:seq")).toBe(7);
    await pub.publish("global:trades", "{}");
    expect(calls.map((c) => c.op)).toEqual(["ctor", "INCR", "PUBLISH"]);
  });

  it("Bun global absent (explicit null sentinel) → Node transport (node-redis)", () => {
    const pub = createRuntimePublisher(DEAD_URL, null);
    expect(pub.kind).toBe("node");
    pub.close?.();
  });

  it("Bun global present but without RedisClient → Node transport", () => {
    const pub = createRuntimePublisher(DEAD_URL, {});
    expect(pub.kind).toBe("node");
    pub.close?.();
  });

  it("createNodePublisher constructs without touching the network synchronously", () => {
    const pub = createNodePublisher(DEAD_URL);
    expect(pub.kind).toBe("node");
    pub.close?.();
  });
});

// ── Loud failure — a no-op transport must never exist (prod-images.md §5) ────

describe("loud failure when no transport is constructible", () => {
  it("createBunPublisher THROWS when Bun.RedisClient is absent", () => {
    expect(() => createBunPublisher(DEAD_URL, null)).toThrow(/Bun\.RedisClient unavailable/);
    expect(() => createBunPublisher(DEAD_URL, {})).toThrow(/Bun\.RedisClient unavailable/);
  });

  it("getDefaultPublisher THROWS when REDIS_URL is unset (startup preflight relies on this)", () => {
    const saved = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    setDefaultPublisherForTest(null);
    try {
      expect(() => getDefaultPublisher()).toThrow(/REDIS_URL is unset/);
    } finally {
      if (saved !== undefined) process.env.REDIS_URL = saved;
    }
  });

  it("getDefaultPublisher constructs + caches a real transport when REDIS_URL is set", () => {
    const saved = process.env.REDIS_URL;
    process.env.REDIS_URL = DEAD_URL;
    setDefaultPublisherForTest(null);
    try {
      const pub = getDefaultPublisher();
      // Under `bun test` the real Bun global (with RedisClient) is present.
      expect(pub.kind).toBe("bun");
      expect(getDefaultPublisher()).toBe(pub); // cached
      pub.close?.();
    } finally {
      if (saved !== undefined) process.env.REDIS_URL = saved;
      else delete process.env.REDIS_URL;
    }
  });

  it("createReverifySubscriber THROWS when REDIS_URL is unset", () => {
    expect(() => createReverifySubscriber(undefined)).toThrow(/REDIS_URL unset/);
  });
});

// ── Reverify subscriber selection ───────────────────────────────────────────

describe("createReverifySubscriber — Bun-vs-Node selection", () => {
  it("Bun path: subscribes via Bun.RedisClient and forwards messages", async () => {
    const { ns, calls } = fakeBun();
    const received: string[] = [];
    const sub = createReverifySubscriber("redis://fake:6379", ns as unknown as BunSubscriberNamespace);
    await sub.subscribe("control:reverify", (m) => received.push(m));
    expect(calls.map((c) => c.op)).toEqual(["ctor", "SUBSCRIBE"]);
    expect(received).toEqual(["ping"]);
  });

  it("Node path: constructs a node-redis subscriber (no connection until subscribe)", () => {
    // Construction alone must not throw and must not hit the network.
    expect(() => createReverifySubscriber(DEAD_URL, null)).not.toThrow();
  });
});

// ── Error accounting (gate-7 redis_publish_errors_total) ────────────────────

// NOTE: the counter is process-global and the real node clients above emit
// async connection-error increments (DEAD_URL) — so assert MONOTONIC growth
// (>= before + 1), the property gate-7 alerting actually relies on.
describe("publish failures increment redis_publish_errors_total", () => {
  it("firePublish INCR failure → counter grows, no throw into the caller", async () => {
    const before = publishErrorCount();
    const failing: RedisPublisher = {
      async incr() {
        throw new Error("boom");
      },
      async publish() {},
    };
    expect(() => firePublish(failing, "trade", "smoke:errors", 1, {})).not.toThrow();
    await flush();
    expect(publishErrorCount()).toBeGreaterThanOrEqual(before + 1);
  });

  it("firePublish PUBLISH failure → counter grows", async () => {
    const before = publishErrorCount();
    const failing: RedisPublisher = {
      async incr() {
        return 1;
      },
      async publish() {
        throw new Error("boom");
      },
    };
    firePublish(failing, "trade", "smoke:errors", 1, {});
    await flush();
    expect(publishErrorCount()).toBeGreaterThanOrEqual(before + 1);
  });
});
