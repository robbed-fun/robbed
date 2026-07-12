/**
 * Public-surface CORS middleware (api.md §6.1 — normative text there; closes
 * the env-inventory `CORS_ALLOWED_ORIGINS` audit gap, 2026-07-12).
 *
 * Scope: mounted on `/v1/*` and explicitly SKIPS `/v1/admin/*`; `/internal/*`
 * never mounts it. Decision (api.md §6.1): admin + internal are the
 * cookie+CSRF SIWE surface — opening them cross-origin widens the
 * CSRF/session attack surface for zero product need, so they stay
 * same-origin only. The public /v1 surface is cookie-less, so `credentials`
 * is deliberately NOT set.
 *
 * Behavior (Hono `cors()`, hono.dev/docs/middleware/builtin/cors — verified
 * 2026-07-12; assertions exercised in test/cors.test.ts rather than trusted):
 *  - function-form `origin`: exact case-insensitive match against the config
 *    set echoes the request origin; a disallowed origin returns null ⇒ NO
 *    Access-Control-Allow-Origin header (never `*`, never an error page).
 *  - OPTIONS preflights are answered by the middleware itself (204) — no
 *    OPTIONS routes exist (the pre-fix 404 on preflight was the user-blocking
 *    upload bug). Mounted BEFORE the rate limiters in app.ts so preflights
 *    never consume rate budget, while a 429 on the actual request still
 *    carries CORS headers (a readable failure, not an opaque network error).
 *  - `exposeHeaders: Retry-After`: the browser client's 429 backoff (§6.3)
 *    must be able to read it (only safelisted response headers are readable
 *    cross-origin otherwise).
 */
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

export function publicCors(allowedOrigins: ReadonlySet<string>): MiddlewareHandler {
  const mw = cors({
    origin: (origin) =>
      allowedOrigins.has(origin.toLowerCase().replace(/\/+$/, "")) ? origin : null,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    exposeHeaders: ["Retry-After"],
    maxAge: 86400,
    // NO `credentials` — public /v1 is cookie-less (api.md §6.1).
  });
  return async (c, next) => {
    // §6.1 scoping: the SIWE cookie surface is never opened cross-origin.
    if (c.req.path.startsWith("/v1/admin")) return next();
    return mw(c, next);
  };
}
