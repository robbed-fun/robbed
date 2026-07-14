/**
 * Error taxonomy (decide-it-yourself, api.md). SINGLE central mapping from a
 * thrown domain error to `{ httpStatus, error.code }`. Consumers switch on the
 * stable `error.code`, never on prose (api.md envelope).
 *
 * The `error.code` vocabulary is a CROSS-SERVICE shape and lives in
 * `@robbed/shared` (`ERROR_CODE_VALUES` / `errorCodeSchema`) — never redeclared
 * here. We import it.
 *
 * RECONCILE (2026-07-10): `upstream_unavailable` and `conflict` are now RATIFIED
 * in `errorCodeSchema` / `ERROR_CODES` (api.md disposition). This file now
 * references the ratified members directly, so every response code — deliberate
 * domain errors and the internal-500 / readyz-503 path alike — is enum-validated.
 */
import { ERROR_CODES, type ErrorCode } from "@robbed/shared";

/**
 * Ratified shared member — used ONLY on the unexpected-500 / readyz-503 paths.
 * Do not use for deliberate domain errors (those carry a specific code below).
 */
export const INTERNAL_ERROR_CODE: ErrorCode = ERROR_CODES.upstream_unavailable;

export class ApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const errors = {
  notFound: (message = "not found") =>
    new ApiError(404, ERROR_CODES.not_found, message),
  validation: (message = "invalid request") =>
    new ApiError(400, ERROR_CODES.invalid_request, message),
  oversized: (message = "payload too large") =>
    new ApiError(413, ERROR_CODES.oversized, message),
  unsupportedType: (message = "unsupported media type") =>
    new ApiError(415, ERROR_CODES.unsupported_type, message),
  decodeFailed: (message = "could not decode image") =>
    new ApiError(400, ERROR_CODES.decode_failed, message),
  rateLimited: (message = "rate limit exceeded") =>
    new ApiError(429, ERROR_CODES.rate_limited, message),
  unauthorized: (message = "unauthorized") =>
    new ApiError(401, ERROR_CODES.unauthorized, message),
  /**
   * Conflict-class (e.g. imageHash references an object we never produced).
   * Behavior UNCHANGED: still 400 / `invalid_request`. `conflict` is now a
   * ratified enum member (shared's enum doc cites this exact imageHash case),
   * so switching this path to 409 / `conflict` is possible — but that is a
   * consumer-visible change (status + code the frontend branches on, plus the
   * metadata test's 400 assertion). FLAGGED for robbed-architect/shared to
   * decide; not self-flipped here.
   */
  conflict: (message = "conflicting request") =>
    new ApiError(400, ERROR_CODES.invalid_request, message),
} as const;
