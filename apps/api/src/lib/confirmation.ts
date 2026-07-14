/**
 * Confirmation-state derivation (api.md, indexer.md).
 *
 * Per OI-11 (version gate verified 2026-07-11 against ponder 0.16.8) there
 * is NO stored per-row `confirmation_state` column on the Ponder-managed event
 * tables — external writes to Ponder tables are silently reverted by its
 * indexing-store cache (and forbidden by Ponder's docs). The sidecar is
 * implemented as pure READ-DERIVATION: a row's tier is a function of its
 * `block_number` vs the offchain `confirmation_watermarks` sidecar singleton.
 *
 * Two derivation surfaces, both encoding the ONE shared rule:
 *  - `projectConfirmation` — TS, for DTO projections (`stateForBlock` from
 *    `@robbed/shared`, the single source of the boundaries).
 *  - `confirmationStateSql` — SQL, emitted into SELECTs so DB row objects keep
 *    the shared db-row `confirmation_state` field (shapes unchanged). The CASE
 *    branches MUST mirror `stateForBlock` exactly: `finalized` checked first,
 *    both boundaries inclusive (`<=`); COALESCE falls back to `soft_confirmed`
 *    when the watermark singleton has not been seeded yet (fresh deploy) —
 *    matching the old column default. Agreement is asserted by the boundary
 *    test in `test/confirmation-derivation.test.ts`.
 */
import {
  type ConfirmationState,
  type ConfirmationWatermarksRow,
  stateForBlock,
} from "@robbed/shared";

export function projectConfirmation(
  blockNumber: number,
  wm: Pick<ConfirmationWatermarksRow, "safe_block" | "finalized_block">,
): ConfirmationState {
  return stateForBlock(blockNumber, {
    safeBlock: wm.safe_block,
    finalizedBlock: wm.finalized_block,
  });
}

/**
 * SQL expression deriving the tier for one row from the watermark sidecar
 * (scalar subquery — a singleton PK lookup, cheap even correlated per row).
 * `blockNumberCol` is ALWAYS a developer-supplied column reference (e.g.
 * `t.block_number`), never user input — it is interpolated, not parameterized.
 */
export function confirmationStateSql(blockNumberCol: string): string {
  return `coalesce((SELECT CASE
    WHEN ${blockNumberCol} <= w.finalized_block THEN 'finalized'
    WHEN ${blockNumberCol} <= w.safe_block THEN 'posted_to_l1'
    ELSE 'soft_confirmed' END
    FROM confirmation_watermarks w WHERE w.id = 1), 'soft_confirmed')`;
}
