/**
 * Admin session (decide-it-yourself, api.md §5/§6.2): STATELESS HMAC-signed
 * cookie over `{ addr, iat, exp, nonce }` (12h, HttpOnly, SameSite=strict) — no
 * session table to leak; the only server state is the single-use nonce in Redis
 * (replay defense, siwe.ts). CSRF token bound to the session nonce is required on
 * mutations (double-submit).
 */
import { base64url, fromBase64url, hmacHex, safeEqual } from "../lib/crypto";

export const SESSION_COOKIE = "robbed_admin_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionPayload {
  addr: string; // lowercased admin address
  iat: number; // issued-at, unix seconds
  exp: number; // expiry, unix seconds
  nonce: string; // ties to the SIWE nonce
}

function sign(secret: string, payloadB64: string): string {
  return hmacHex(secret, payloadB64).slice(0, 32);
}

export function issueSession(
  secret: string,
  addr: string,
  nonce: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): { cookieValue: string; csrfToken: string; payload: SessionPayload } {
  const payload: SessionPayload = {
    addr: addr.toLowerCase(),
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS,
    nonce,
  };
  const b64 = base64url(JSON.stringify(payload));
  const cookieValue = `${b64}.${sign(secret, b64)}`;
  return { cookieValue, csrfToken: csrfFor(secret, nonce), payload };
}

export function verifySession(
  secret: string,
  cookieValue: string | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot < 0) return null;
  const b64 = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!safeEqual(sig, sign(secret, b64))) return null;
  try {
    const payload = JSON.parse(fromBase64url(b64)) as SessionPayload;
    if (typeof payload.addr !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= nowSec) return null;
    return payload;
  } catch {
    return null;
  }
}

/** CSRF token deterministically bound to the session nonce. */
export function csrfFor(secret: string, nonce: string): string {
  return hmacHex(secret, `csrf:${nonce}`).slice(0, 32);
}

export function verifyCsrf(secret: string, nonce: string, token: string | undefined): boolean {
  if (!token) return false;
  return safeEqual(token, csrfFor(secret, nonce));
}

/** Serialize the Set-Cookie header value (HttpOnly, Secure, SameSite=strict). */
export function serializeSessionCookie(value: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
