/**
 * User SIWE lifecycle (spec §12.63b) — the sign-in a comment author needs.
 * Mirrors the admin lifecycle (admin/routes.ts) but with NO address allowlist
 * (anyone may sign in to post) and NO CSRF token (the user session uses a
 * SameSite=Lax cookie; auth/session.ts). It REUSES the admin SIWE machinery
 * verbatim — `issueNonce` (single-use Redis nonce) and `verifySiweLogin` with a
 * null allowlist — so there is one SIWE implementation, not two.
 *
 *   GET  /v1/auth/nonce  → single-use nonce for the EIP-4361 message
 *   POST /v1/auth/login  → verify signature → set `robbed_user_session` cookie
 *   POST /v1/auth/logout → clear the cookie
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { ok } from "../lib/envelope";
import { parseJson } from "../lib/validate";
import { issueNonce, verifySiweLogin } from "../admin/siwe";
import { issueUserSession, serializeUserSessionCookie } from "./session";

const loginBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export function authRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/auth/nonce", async (c) => {
    const nonce = await issueNonce(deps.redis);
    return ok(c, { nonce });
  });

  app.post("/v1/auth/login", async (c) => {
    const { message, signature } = await parseJson(loginBodySchema, c);
    // allowlist: null ⇒ any valid signer may sign in (spec §12.63b). The nonce is
    // still single-use (replay-proof) and the EOA signature is still recovered +
    // matched — only the admin-allowlist gate is dropped for the user surface.
    const login = await verifySiweLogin(
      { message, signature: signature as `0x${string}` },
      { redis: deps.redis, allowlist: null, nowSec: Math.floor(deps.now() / 1000) },
    );
    const { cookieValue } = issueUserSession(
      deps.config.SESSION_SECRET,
      login.address,
      Math.floor(deps.now() / 1000),
    );
    c.header("Set-Cookie", serializeUserSessionCookie(cookieValue, deps.secureCookies));
    return ok(c, { address: login.address });
  });

  app.post("/v1/auth/logout", (c) => {
    c.header("Set-Cookie", serializeUserSessionCookie("", deps.secureCookies));
    return ok(c, { ok: true as const });
  });

  return app;
}
