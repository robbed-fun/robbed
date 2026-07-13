/**
 * User session (spec §12.63b — off-chain SIWE-authored comments). A signed-in
 * address gets a STATELESS HMAC-signed cookie over `{ addr, iat, exp }`, mirroring
 * the admin session (admin/session.ts) but kept DELIBERATELY SEPARATE:
 *
 *  - Distinct cookie name (`robbed_user_session`) so a user session can NEVER be
 *    mistaken for an admin session — the admin surface is unchanged and still
 *    gates on `adminAllowlist`. Reusing the admin cookie name would blur that
 *    security boundary; the small duplication here buys a crisp separation.
 *  - Reuses the SAME HMAC machinery (`lib/crypto`) and the SAME SIWE verifier +
 *    single-use nonce (admin/siwe.ts `verifySiweLogin`/`issueNonce`, now with a
 *    nullable allowlist) — the "reuse the existing SIWE/session machinery" the
 *    task calls for, without touching the admin path.
 *  - No CSRF double-submit token (unlike admin). CSRF defense is the
 *    `SameSite=Lax` cookie: a cross-SITE POST cannot carry it, and the public /v1
 *    surface is same-site in deployment. Admin keeps its stronger double-submit
 *    because admin actions are higher-severity; a comment is low-severity and
 *    moderation-gated. (Adding double-submit for parity is flagged to the
 *    architect, not self-decided.)
 */
import { base64url, fromBase64url, hmacHex, safeEqual } from "../lib/crypto";

export const USER_SESSION_COOKIE = "robbed_user_session";
/** 30-day user session (longer than admin's 12h — a poster, not a privileged op). */
export const USER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface UserSessionPayload {
  addr: string; // lowercased signer address
  iat: number; // issued-at, unix seconds
  exp: number; // expiry, unix seconds
}

function sign(secret: string, payloadB64: string): string {
  // Domain-separated from the admin cookie signature so a token minted for one
  // surface can never validate on the other, even under the same SESSION_SECRET.
  return hmacHex(secret, `user:${payloadB64}`).slice(0, 32);
}

export function issueUserSession(
  secret: string,
  addr: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): { cookieValue: string; payload: UserSessionPayload } {
  const payload: UserSessionPayload = {
    addr: addr.toLowerCase(),
    iat: nowSec,
    exp: nowSec + USER_SESSION_TTL_SECONDS,
  };
  const b64 = base64url(JSON.stringify(payload));
  return { cookieValue: `${b64}.${sign(secret, b64)}`, payload };
}

export function verifyUserSession(
  secret: string,
  cookieValue: string | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): UserSessionPayload | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot < 0) return null;
  const b64 = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!safeEqual(sig, sign(secret, b64))) return null;
  try {
    const payload = JSON.parse(fromBase64url(b64)) as UserSessionPayload;
    if (typeof payload.addr !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= nowSec) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Serialize the Set-Cookie value (HttpOnly, SameSite=Lax, optional Secure). */
export function serializeUserSessionCookie(value: string, secure: boolean): string {
  const parts = [
    `${USER_SESSION_COOKIE}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${value ? USER_SESSION_TTL_SECONDS : 0}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
