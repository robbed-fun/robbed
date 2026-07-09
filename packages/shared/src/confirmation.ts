/**
 * Confirmation-state enum + helpers (spec §2.1, §12.20; indexer.md §3.8, §5).
 *
 * Wire values are snake_case and are the same strings stored in the DB
 * `confirmation_state` columns and sent in WS/REST payloads.
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
 * States never flip backwards (indexer.md §5.1 step 3).
 */
export function upgradeConfirmationState(
  current: ConfirmationState,
  next: ConfirmationState,
): ConfirmationState {
  return compareConfirmationStates(next, current) > 0 ? next : current;
}

/** Watermark snapshot (indexer.md §3.8 confirmation_watermarks singleton). */
export interface ConfirmationWatermarks {
  /** Highest L2 block posted to L1 ("safe" tag). */
  safeBlock: number | bigint;
  /** Highest L2 block finalized on L1 ("finalized" tag). */
  finalizedBlock: number | bigint;
}

/**
 * Authoritative rule (indexer.md §3.8): an event's state is `finalized` if
 * `blockNumber <= finalizedBlock`, else `posted_to_l1` if `<= safeBlock`,
 * else `soft_confirmed`. Used by the indexer's materializer and by WS clients
 * upgrading held events from `global:confirmations` watermark broadcasts
 * (spec §12.20).
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
