/**
 * Rate limiting (§6.3): per-IP + per-route sliding window → 429 + `Retry-After`.
 *
 * The window MATH is a PURE function (unit-tested for boundary/refill) operating
 * on a timestamp list; the store persists timestamps. An in-memory store ships
 * for dev/test/single-node; a Redis sorted-set store is the multi-node impl.
 *
 * IP source (decide-it-yourself, api.md §5): trust a CONFIGURED trusted-proxy
 * header (`CF-Connecting-IP`, else rightmost `X-Forwarded-For` hop) — NEVER the
 * client-settable leftmost XFF, the classic bypass. Empty config ⇒ socket peer.
 */
import type { Context, MiddlewareHandler } from "hono";
import { errors } from "../lib/errors";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window admits the client again (for `Retry-After`). */
  retryAfterSec: number;
}

/**
 * Pure sliding-window decision. `timestamps` are prior hit times (ms) within the
 * window; returns the decision and the PRUNED+updated timestamp list to persist.
 */
export function slidingWindow(
  timestamps: number[],
  now: number,
  windowMs: number,
  limit: number,
): { result: RateLimitResult; next: number[] } {
  const cutoff = now - windowMs;
  const live = timestamps.filter((t) => t > cutoff);
  if (live.length >= limit) {
    const oldest = live[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return {
      result: { allowed: false, remaining: 0, retryAfterSec },
      next: live,
    };
  }
  live.push(now);
  return {
    result: { allowed: true, remaining: limit - live.length, retryAfterSec: 0 },
    next: live,
  };
}

export interface RateLimitStore {
  hit(key: string, windowMs: number, limit: number, now: number): Promise<RateLimitResult>;
}

/** In-memory store (single-node / test) — exercises the pure window math. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly map = new Map<string, number[]>();
  async hit(key: string, windowMs: number, limit: number, now: number): Promise<RateLimitResult> {
    const { result, next } = slidingWindow(this.map.get(key) ?? [], now, windowMs, limit);
    this.map.set(key, next);
    return result;
  }
}

export interface RouteLimit {
  /** Requests allowed per window. */
  limit: number;
  /** Window length, ms. */
  windowMs: number;
  /** Limit key namespace (route class). */
  name: string;
}

/**
 * RATE_LIMIT_SCALE multiplies every per-route limit (windows unchanged).
 * Default 1 = production values. The local dev/e2e stack sets 100: three
 * back-to-back full e2e matrix runs exhaust the production uploads_h=10
 * budget and every create-path flow fails on "rate limit exceeded"
 * (observed 2026-07-12). Never a bypass — 0/negative/NaN clamp to 1.
 */
const RATE_LIMIT_SCALE = Math.max(1, Math.floor(Number(process.env.RATE_LIMIT_SCALE ?? "1") || 1));

const scaled = (limit: number): number => limit * RATE_LIMIT_SCALE;

/** Default per-route limits (api.md §6.3), all overridable. */
export const ROUTE_LIMITS = {
  uploadsHour: { name: "uploads_h", limit: scaled(10), windowMs: 60 * 60 * 1000 },
  uploadsMin: { name: "uploads_m", limit: scaled(3), windowMs: 60 * 1000 },
  metadata: { name: "metadata", limit: scaled(20), windowMs: 60 * 60 * 1000 },
  search: { name: "search", limit: scaled(60), windowMs: 60 * 1000 },
  reads: { name: "reads", limit: scaled(300), windowMs: 60 * 1000 },
  admin: { name: "admin", limit: scaled(60), windowMs: 60 * 1000 },
  // User SIWE lifecycle (/v1/auth/*) — per-IP nonce/login/logout guard (§12.63b).
  auth: { name: "auth", limit: scaled(30), windowMs: 60 * 1000 },
  // Per-AUTHOR comment anti-spam (spec §12.63b) — keyed by SIWE address inside
  // the POST handler (post-auth), not by IP. Simple default (10/min); flagged to
  // the architect for tuning (exact window is an open product knob).
  commentsPerAuthor: { name: "comments_author", limit: scaled(10), windowMs: 60 * 1000 },
} as const satisfies Record<string, RouteLimit>;

/**
 * Resolve the client IP. `trustedHeader` empty ⇒ use socket peer (from
 * `connInfoFn`, dev). Otherwise use that header value; if it's XFF, take the
 * RIGHTMOST hop (closest trusted proxy), never the spoofable leftmost.
 */
export function resolveClientIp(
  c: Context,
  trustedHeader: string,
  connInfoIp: string | null,
): string {
  if (!trustedHeader) return connInfoIp ?? "unknown";
  const raw = c.req.header(trustedHeader);
  if (!raw) return connInfoIp ?? "unknown";
  if (trustedHeader.toLowerCase() === "x-forwarded-for") {
    const hops = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return hops[hops.length - 1] ?? connInfoIp ?? "unknown";
  }
  return raw.trim();
}

export interface RateLimitDeps {
  store: RateLimitStore;
  trustedHeader: string;
  connInfoIp?: (c: Context) => string | null;
  now?: () => number;
}

/** Middleware factory for a given route class + optional per-session keying. */
export function rateLimit(
  deps: RateLimitDeps,
  ...limits: RouteLimit[]
): MiddlewareHandler {
  return async (c, next) => {
    const ip = resolveClientIp(c, deps.trustedHeader, deps.connInfoIp?.(c) ?? null);
    // Keyed by IP. NOTE: the §6.3 "admin 60/min/session" limit runs here BEFORE
    // auth (this mw sits on `/v1/admin/*`), so the admin bucket is effectively
    // per-IP in v1 — a stricter per-session limiter would need to run post-auth.
    const principal = `ip:${ip}`;
    const now = deps.now?.() ?? Date.now();
    for (const l of limits) {
      const res = await deps.store.hit(`rl:${l.name}:${principal}`, l.windowMs, l.limit, now);
      if (!res.allowed) {
        c.header("Retry-After", String(res.retryAfterSec));
        throw errors.rateLimited(`rate limit exceeded for ${l.name}`);
      }
    }
    await next();
  };
}
