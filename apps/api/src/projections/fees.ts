/**
 * Fee-collection aggregation for GET /v1/tokens/:address/fees (§6.4 treasury
 * dashboard). `collected` sums indexed `fee_collections`; `uncollected` is a
 * live NPM `tokensOwed` RPC read (cold, cached 60s — never the hot path) added
 * by the route. Uses the frozen `feeCollectionEntrySchema` shape.
 */
import type { ConfirmationWatermarksRow, FeeCollectionRow } from "@robbed/shared";
import type { z } from "zod";
import { feeCollectionEntrySchema, feesResponseSchema } from "@robbed/shared";
import { projectConfirmation } from "../lib/confirmation";

type FeeEntry = z.infer<typeof feeCollectionEntrySchema>;
type FeesResponse = z.infer<typeof feesResponseSchema>;

export function toCollected(
  rows: FeeCollectionRow[],
  wm: Pick<ConfirmationWatermarksRow, "safe_block" | "finalized_block">,
): FeesResponse["collected"] {
  let token = 0n;
  let weth = 0n;
  const byCollection: FeeEntry[] = rows.map((r) => {
    token += BigInt(r.amount_token || "0");
    weth += BigInt(r.amount_weth || "0");
    return {
      id: r.id,
      amountToken: r.amount_token,
      amountWeth: r.amount_weth,
      recipient: r.recipient,
      blockTimestamp: r.block_timestamp,
      txHash: r.tx_hash,
      confirmationState: projectConfirmation(r.block_number, wm),
    };
  });
  return { token: token.toString(), weth: weth.toString(), byCollection };
}
