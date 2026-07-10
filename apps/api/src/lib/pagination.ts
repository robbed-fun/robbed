/**
 * Cursor pagination (decide-it-yourself, api.md §5). Opaque, HMAC-SIGNED,
 * base64url KEYSET cursor encoding `(sortKey, id)` — NOT `OFFSET`.
 *
 * Basis: keyset is stable under concurrent inserts and O(1); `OFFSET` drifts and
 * scans. Signing means a tampered/forged cursor 400s (`errors.validation`)
 * instead of injecting an attacker-chosen keyset into the query — the cursor is
 * server state the client only echoes back.
 *
 * The cursor payload is `{ k: sortKey, i: id }`. `sortKey` is the value of the
 * active sort column of the LAST row returned (string form; the query compares
 * `(sort_col, address) < (k, i)` for DESC). `limit` is clamped to
 * `[1, PAGE_LIMIT_MAX]` with `PAGE_LIMIT_DEFAULT`.
 */
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX } from "@robbed/shared";
import { base64url, fromBase64url, hmacHex, safeEqual } from "./crypto";
import { errors } from "./errors";

export interface Cursor {
  /** Sort-key value of the last row (string form for stable transport). */
  k: string;
  /** Tiebreak id (token address / row id) of the last row. */
  i: string;
}

export function encodeCursor(secret: string, cursor: Cursor): string {
  const payload = base64url(JSON.stringify(cursor));
  const sig = hmacHex(secret, payload).slice(0, 32);
  return `${payload}.${sig}`;
}

/** Returns null for an absent cursor; throws `errors.validation` on tamper. */
export function decodeCursor(secret: string, raw: string | undefined): Cursor | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) throw errors.validation("malformed cursor");
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = hmacHex(secret, payload).slice(0, 32);
  if (!safeEqual(sig, expected)) throw errors.validation("invalid cursor signature");
  try {
    const parsed = JSON.parse(fromBase64url(payload)) as Cursor;
    if (typeof parsed?.k !== "string" || typeof parsed?.i !== "string") {
      throw new Error("shape");
    }
    return parsed;
  } catch {
    throw errors.validation("malformed cursor");
  }
}

export function clampLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return PAGE_LIMIT_DEFAULT;
  return Math.min(Math.floor(n), PAGE_LIMIT_MAX);
}
