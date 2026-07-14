/**
 * EventFeedDbRow → `EventFeedRow` (frozen shared DTO) for `GET /v1/events`.
 *
 * Each row's `data` is the EXISTING WS payload shape (`WsLaunchData` /
 * `WsTradeData` / `WsGraduatedData`) so a REST-seeded tape row and a live-WS tape
 * row are byte-identical in shape — the frontend maps both with the same
 * launchToEvent/tradeToEvent/graduateToEvent (anti-drift: no second shape).
 * `confirmationState` is recomputed from the current watermark (like `toTradeRow`);
 * the graduated payload carries none, matching `wsGraduatedDataSchema`.
 */
import type { ConfirmationWatermarksRow, EventFeedRow } from "@robbed/shared";
import type { EventFeedDbRow } from "../lib/db";
import { projectConfirmation } from "../lib/confirmation";

export function toEventFeedRow(
  row: EventFeedDbRow,
  wm: Pick<ConfirmationWatermarksRow, "safe_block" | "finalized_block">,
): EventFeedRow {
  switch (row.kind) {
    case "launch":
      return {
        type: "launch",
        data: {
          address: row.address,
          name: row.name,
          ticker: row.ticker,
          creator: row.creator,
          ...(row.image_url ? { imageUrl: row.image_url } : {}),
          createdAt: row.created_at,
          blockNumber: row.block_number,
          confirmationState: projectConfirmation(row.block_number, wm),
        },
      };
    case "trade": {
      const t = row.trade;
      return {
        type: "trade",
        data: {
          token: t.token_address,
          trader: t.trader,
          venue: t.venue,
          isBuy: t.is_buy,
          ethAmount: t.eth_amount,
          tokenAmount: t.token_amount,
          feeEth: t.fee_eth,
          priceEth: t.price_eth,
          blockNumber: t.block_number,
          txHash: t.tx_hash,
          logIndex: t.log_index,
          blockTimestamp: t.block_timestamp,
          confirmationState: projectConfirmation(t.block_number, wm),
        },
      };
    }
    case "graduated":
      return {
        type: "graduated",
        data: {
          token: row.token,
          pool: row.pool,
          blockNumber: row.block_number,
          ts: row.block_timestamp,
        },
      };
  }
}
