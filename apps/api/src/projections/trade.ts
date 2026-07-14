/**
 * TradeRowDb → `TradeRow` (frozen shared DTO). Unified curve+v3 projection;
 * `confirmationState` recomputed from the current watermark (api.md).
 * `price_eth` is the display-only float from post-trade reserves / sqrtPriceX96.
 */
import type { ConfirmationWatermarksRow, TradeRow, TradeRowDb } from "@robbed/shared";
import { projectConfirmation } from "../lib/confirmation";

export function toTradeRow(
  row: TradeRowDb,
  wm: Pick<ConfirmationWatermarksRow, "safe_block" | "finalized_block">,
): TradeRow {
  return {
    id: row.id,
    token: row.token_address,
    trader: row.trader,
    venue: row.venue,
    isBuy: row.is_buy,
    ethAmount: row.eth_amount,
    tokenAmount: row.token_amount,
    feeEth: row.fee_eth,
    priceEth: row.price_eth,
    blockNumber: row.block_number,
    blockTimestamp: row.block_timestamp,
    txHash: row.tx_hash,
    logIndex: row.log_index,
    confirmationState: projectConfirmation(row.block_number, wm),
  };
}
