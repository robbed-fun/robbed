/**
 * Admin auth middleware (§6.2). `requireAdmin` verifies the stateless signed
 * session cookie and pins the address/nonce onto the context; `requireCsrf`
 * enforces the session-bound CSRF token on mutations (double-submit). Both throw
 * `unauthorized` (401) — the only auth code in the frozen enum.
 */
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { SESSION_COOKIE, verifyCsrf, verifySession } from "./session";

export type AdminVars = { adminAddress?: string; adminNonce?: string };

export function requireAdmin(deps: AppDeps): MiddlewareHandler<{ Variables: AdminVars }> {
  return async (c, next) => {
    const cookie = getCookie(c, SESSION_COOKIE);
    const session = verifySession(deps.config.SESSION_SECRET, cookie, Math.floor(deps.now() / 1000));
    if (!session) throw errors.unauthorized("admin session required");
    if (!deps.config.adminAllowlist.has(session.addr)) {
      throw errors.unauthorized("address no longer in admin allowlist");
    }
    c.set("adminAddress", session.addr);
    c.set("adminNonce", session.nonce);
    await next();
  };
}

export function requireCsrf(deps: AppDeps): MiddlewareHandler<{ Variables: AdminVars }> {
  return async (c, next) => {
    const nonce = c.get("adminNonce");
    const token = c.req.header("X-CSRF-Token");
    if (!nonce || !verifyCsrf(deps.config.SESSION_SECRET, nonce, token)) {
      throw errors.unauthorized("invalid or missing CSRF token");
    }
    await next();
  };
}
