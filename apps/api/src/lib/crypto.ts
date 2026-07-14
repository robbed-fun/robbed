/**
 * Small synchronous crypto helpers (node:crypto, available in Bun). Used by the
 * keyset-cursor signer (api.md) and the stateless admin session cookie
 *. Timing-safe compare on every verify.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/** Constant-time string compare (both hex/base64url of equal expected length). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export function fromBase64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
