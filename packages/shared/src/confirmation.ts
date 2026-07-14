/**
 * Confirmation-state enum + helpers (indexer.md).
 *
 * Wire values are snake_case and are the same strings sent in WS/REST
 * payloads and surfaced as the `confirmation_state` field on DB row shapes.
 * NOTE (OI-11 rework, 2026-07-11 —; indexer.md) these
 * are NOT physical columns on Ponder tables; the API derives the value at
 * read time from the `confirmation_watermarks` sidecar via
 * `confirmationStateSql(blockCol)` (apps/api/src/lib/confirmation.ts). See
 * the read-derivation constraint in `db-rows.ts`.
 *
 * Three explicit states, strictly ordered and monotonic (never downgraded):
 *   soft_confirmed → posted_to_l1 → finalized
 */
import { z } from "zod";

export const CONFIRMATION_STATES = [
  "soft_confirmed",
  "posted_to_l1",
  "finalized",
] as const;

export const confirmationStateSchema = z.enum(CONFIRMATION_STATES);
export type ConfirmationState = z.infer<typeof confirmationStateSchema>;

/** Numeric rank for ordering: soft_confirmed=0, posted_to_l1=1, finalized=2. */
export const CONFIRMATION_STATE_RANK: Record<ConfirmationState, number> = {
  soft_confirmed: 0,
  posted_to_l1: 1,
  finalized: 2,
} as const;

/** Ordering helper: negative if a < b, 0 if equal, positive if a > b. */
export function compareConfirmationStates(
  a: ConfirmationState,
  b: ConfirmationState,
): number {
  return CONFIRMATION_STATE_RANK[a] - CONFIRMATION_STATE_RANK[b];
}

/** True if `state` is at least as confirmed as `min`. */
export function isAtLeast(
  state: ConfirmationState,
  min: ConfirmationState,
): boolean {
  return CONFIRMATION_STATE_RANK[state] >= CONFIRMATION_STATE_RANK[min];
}

/**
 * Monotonic upgrade: returns the more-confirmed of the two states.
 * States never flip backwards (indexer.md step 3).
 */
export function upgradeConfirmationState(
  current: ConfirmationState,
  next: ConfirmationState,
): ConfirmationState {
  return compareConfirmationStates(next, current) > 0 ? next : current;
}

/** Watermark snapshot (indexer.md confirmation_watermarks singleton). */
export interface ConfirmationWatermarks {
  /** Highest L2 block posted to L1 ("safe" tag). */
  safeBlock: number | bigint;
  /** Highest L2 block finalized on L1 ("finalized" tag). */
  finalizedBlock: number | bigint;
}

/**
 * Authoritative rule (indexer.md) an event's state is `finalized` if
 * `blockNumber <= finalizedBlock`, else `posted_to_l1` if `<= safeBlock`,
 * else `soft_confirmed`. This is the TS mirror of the API's read-time SQL
 * derivation (`confirmationStateSql`, apps/api/src/lib/confirmation.ts —
 * read-derivation); also used by WS clients upgrading held
 * events from `global:confirmations` watermark broadcasts.
 */
export function stateForBlock(
  blockNumber: number | bigint,
  watermarks: ConfirmationWatermarks,
): ConfirmationState {
  const block = BigInt(blockNumber);
  if (block <= BigInt(watermarks.finalizedBlock)) return "finalized";
  if (block <= BigInt(watermarks.safeBlock)) return "posted_to_l1";
  return "soft_confirmed";
}
