/**
 * Cursor pagination (decide-it-yourself, api.md). Opaque, HMAC-SIGNED,
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
import { clampListLimit, type KeysetCursorPayload } from "@robbed/shared";
import { base64url, fromBase64url, hmacHex, safeEqual } from "./crypto";
import { errors } from "./errors";

/**
 * The signed cursor's logical payload. STRUCTURAL DEDUP (robbed-shared report
 * note) the `{ k, i }` shape is single-sourced as `KeysetCursorPayload`
 * in `@robbed/shared` and re-exported here as `Cursor` — the API keeps ownership
 * of the HMAC signing/verification, the shape lives once. `k` = string form of
 * the active sort column's value on the last row; `i` = its stable tiebreak.
 */
export type Cursor = KeysetCursorPayload;

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

/**
 * STRUCTURAL DEDUP (robbed-shared report note) delegates to the shared
 * `clampListLimit` — the single source for the `[1, PAGE_LIMIT_MAX]` clamp with
 * `PAGE_LIMIT_DEFAULT` fallback. Kept as a thin re-export so existing call sites
 * (`clampLimit`) stay stable while the logic lives once in `@robbed/shared`.
 */
export function clampLimit(raw: unknown): number {
  return clampListLimit(raw);
}
