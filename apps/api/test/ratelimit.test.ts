/**
 * M2-11 rate limiting : sliding-window math (boundary/refill) + the
 * trusted-proxy IP source (forged XFF must NOT evade the per-IP window).
 */
import { describe, expect, it } from "bun:test";
import type { Context } from "hono";
import { InMemoryRateLimitStore, resolveClientIp, slidingWindow } from "../src/mw/ratelimit";

describe("slidingWindow", () => {
  it("admits up to the limit then blocks with a Retry-After", () => {
    const win = 1000;
    let ts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = slidingWindow(ts, i, win, 3);
      ts = r.next;
      expect(r.result.allowed).toBe(true);
    }
    const blocked = slidingWindow(ts, 3, win, 3);
    expect(blocked.result.allowed).toBe(false);
    expect(blocked.result.retryAfterSec).toBeGreaterThanOrEqual(1);
  });
  it("refills as old hits fall out of the window", () => {
    const win = 1000;
    let ts: number[] = [];
    ts = slidingWindow(ts, 0, win, 1).next; // hit at t=0
    expect(slidingWindow(ts, 500, win, 1).result.allowed).toBe(false); // still in window
    expect(slidingWindow(ts, 1001, win, 1).result.allowed).toBe(true); // t=0 expired
  });
});

describe("InMemoryRateLimitStore", () => {
  it("tracks per-key windows independently", async () => {
    const s = new InMemoryRateLimitStore();
    expect((await s.hit("a", 1000, 1, 0)).allowed).toBe(true);
    expect((await s.hit("a", 1000, 1, 1)).allowed).toBe(false);
    expect((await s.hit("b", 1000, 1, 1)).allowed).toBe(true);
  });
});

function fakeCtx(headers: Record<string, string>): Context {
  return {
    req: { header: (n: string) => headers[n.toLowerCase()] },
  } as unknown as Context;
}

describe("resolveClientIp (anti-spoof)", () => {
  it("uses the socket IP when no trusted header is configured", () => {
    expect(resolveClientIp(fakeCtx({}), "", "10.0.0.9")).toBe("10.0.0.9");
  });
  it("honors a configured single-value trusted header", () => {
    const c = fakeCtx({ "cf-connecting-ip": "1.2.3.4" });
    expect(resolveClientIp(c, "CF-Connecting-IP", "10.0.0.9")).toBe("1.2.3.4");
  });
  it("takes the RIGHTMOST XFF hop, never the client-settable leftmost", () => {
    // Attacker prepends a fake hop to try to shift their rate-limit bucket.
    const c = fakeCtx({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" });
    expect(resolveClientIp(c, "X-Forwarded-For", "10.0.0.9")).toBe("1.2.3.4");
  });
});

describe("RATE_LIMIT_SCALE (dev/e2e multiplier — never a bypass)", () => {
  // ROUTE_LIMITS is computed at module load; this suite runs with the ambient
  // env (unset or the compose value), so assert the INVARIANTS rather than a
  // specific product: limits are exact multiples of the base values and
  // the multiplier is a clamped integer ≥ 1.
  it("limits are the base values times one shared integer scale ≥ 1", async () => {
    const { ROUTE_LIMITS } = await import("../src/mw/ratelimit");
    const base = { uploadsHour: 10, uploadsMin: 3, metadata: 20, search: 60, reads: 300, admin: 60 };
    const scale = ROUTE_LIMITS.uploadsHour.limit / base.uploadsHour;
    expect(Number.isInteger(scale)).toBe(true);
    expect(scale).toBeGreaterThanOrEqual(1);
    for (const [k, b] of Object.entries(base)) {
      expect(ROUTE_LIMITS[k as keyof typeof ROUTE_LIMITS].limit).toBe(b * scale);
    }
  });
  it("windows are never scaled", async () => {
    const { ROUTE_LIMITS } = await import("../src/mw/ratelimit");
    expect(ROUTE_LIMITS.uploadsHour.windowMs).toBe(60 * 60 * 1000);
    expect(ROUTE_LIMITS.uploadsMin.windowMs).toBe(60 * 1000);
  });
});
