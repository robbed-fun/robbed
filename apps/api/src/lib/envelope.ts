/**
 * Response envelope (api.md) `{ data, error: null }` on success,
 * `{ data: null, error: { code, message } }` on failure. Single helper set so
 * no route hand-builds the shape. The success arm's `data` is typed by the
 * caller against a `@robbed/shared` DTO — never redeclared here.
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiEnvelope, ErrorCode } from "@robbed/shared";
import { ApiError, INTERNAL_ERROR_CODE } from "./errors";

export function okBody<T>(data: T): ApiEnvelope<T> {
  return { data, error: null };
}

export function errBody(code: ErrorCode | typeof INTERNAL_ERROR_CODE, message: string) {
  return { data: null, error: { code, message } } as const;
}

/** Success JSON response. */
export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json(okBody(data), status);
}

/**
 * Central error → envelope projection (wired via `app.onError`). Known
 * `ApiError`s map to their frozen code + status; anything else is an
 * unexpected bug → 500 with `upstream_unavailable` (planned shared code) and a
 * generic message (never leaks internals — api.md).
 */
export function toErrorResponse(c: Context, err: unknown) {
  if (err instanceof ApiError) {
    const body = errBody(err.code, err.message);
    return c.json(body, err.httpStatus as ContentfulStatusCode);
  }
  // Unexpected — do not leak internals.
  console.error("[api] unhandled error:", err);
  return c.json(errBody(INTERNAL_ERROR_CODE, "internal error"), 500);
}
