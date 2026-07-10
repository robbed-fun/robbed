/**
 * TokenDetailRow → `TokenDetail` (frozen shared DTO = TokenCard + §5.2 fields +
 * Trust panel). `creator` is the enriched `{ address, tokensCreated }` profile
 * that supersedes the card's plain address (RATIFIED X-13; address is inside).
 */
import type { ConfirmationWatermarksRow, TokenDetail } from "@robbed/shared";
import type { Change24hAnchor, TokenDetailRow } from "../lib/db";
import type { EthUsdSnapshot } from "../lib/usd";
import { toTokenCard } from "./card";
import { progressFraction } from "./common";
import { buildTrust } from "./trust";

export function toTokenDetail(
  row: TokenDetailRow,
  wm: Pick<ConfirmationWatermarksRow, "safe_block" | "finalized_block">,
  ethUsd: EthUsdSnapshot | null,
  nowMs: number = Date.now(),
  anchor?: Change24hAnchor,
): TokenDetail {
  const card = toTokenCard(row, wm, ethUsd, nowMs, anchor);
  return {
    ...card,
    description: row.description,
    links: (row.links as TokenDetail["links"]) ?? null,
    curveAddress: row.curve_address,
    ...(row.v3_pool_address ? { v3PoolAddress: row.v3_pool_address } : {}),
    ...(row.graduated_at != null ? { graduatedAt: row.graduated_at } : {}),
    supply: {
      total: row.total_supply,
      // Balance the curve holds; falls back to live curve token reserves.
      curveHeld: row.curve_balance ?? row.real_token_reserves,
      lpTranche: row.pool_balance ?? "0",
    },
    reserves: {
      virtualEth: row.virtual_eth,
      virtualToken: row.virtual_token,
      realEth: row.real_eth_reserves,
      realToken: row.real_token_reserves,
    },
    graduation: {
      thresholdEth: row.graduation_eth,
      progressPct: progressFraction(row.real_eth_reserves, row.graduation_eth),
    },
    trust: buildTrust(row),
    creator: {
      address: row.creator,
      tokensCreated: row.creator_tokens_created,
    },
    moderation: {
      visibility: row.m_visibility ?? "visible",
      impersonationFlag: row.m_impersonation_flag ?? false,
      ...(row.m_impersonation_ticker
        ? { impersonationTicker: row.m_impersonation_ticker }
        : {}),
    },
  };
}
