/**
 * Confirmation-state projection (spec §2.1, api.md §2). Every event-derived DTO
 * carries `confirmationState`. The indexer already MATERIALIZES a per-row
 * `confirmation_state` column, but we recompute at read time from the current
 * watermark singleton so the response can never be staler than the watermark
 * (the column lags at most one tracker tick — indexer.md §3.8). The rule lives
 * once, in `@robbed/shared` `stateForBlock`; we only supply the watermarks.
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
