/**
 * TokenListRow → `TokenCard` (frozen shared DTO). Status is DERIVED, not stored
 * (indexer.md) `graduated` → graduated; `real_eth ≥ graduation_eth` and
 * not yet graduated → the lock window `graduating`; else `curve`. mcap USD
 * is computed at request time from the ETH/USD snapshot — never a constant.
 */
import { computeChange24hPct, TOKEN_CARD_DESCRIPTION_MAX, type TokenCard } from "@robbed/shared";
import type { ConfirmationWatermarksRow } from "@robbed/shared";
import type { Change24hAnchor, TokenListRow } from "../lib/db";
import { projectConfirmation } from "../lib/confirmation";
import type { EthUsdSnapshot } from "../lib/usd";
import { usdFromEthFloat } from "../lib/usd";
import { rewriteLocalStorageUrl } from "./assets";
import { progressFraction, resolveSnapshot, statusFrom } from "./common";

const WEI_PER_ETH = 1e18;
const WEI_PER_ETH_BIG = 10n ** 18n;

export function deriveStatus(row: TokenListRow): TokenCard["status"] {
  return statusFrom(row.graduated, row.real_eth_reserves, row.graduation_eth);
}

/** mcap in ETH (float) = price(ETH/token) × totalSupply(tokens). USD derives from this. */
function mcapEthFloat(row: TokenListRow): number {
  if (row.last_price_eth == null) return 0;
  const supplyTokens = Number(BigInt(row.total_supply || "0")) / WEI_PER_ETH;
  return row.last_price_eth * supplyTokens;
}

/**
 * mcap in ETH as a wei decimal string (ETH-first; mcapEth refinement ratified 2026-07-10) — the ETH-first
 * source for OG/cards so no client-side `usd / ethUsd` divide is needed. Computed
 * in integer space to avoid float loss on the >2^53 wei product:
 *   mcapWei = round(price × 1e18) [wei/token] × totalSupply(wei) / 1e18.
 */
function mcapEthWei(row: TokenListRow): string {
  if (row.last_price_eth == null) return "0";
  const pricePerTokenWei = BigInt(Math.round(row.last_price_eth * WEI_PER_ETH));
  return ((pricePerTokenWei * BigInt(row.total_supply || "0")) / WEI_PER_ETH_BIG).toString();
}

export function toTokenCard(
  row: TokenListRow,
  wm: Pick<ConfirmationWatermarksRow, "safe_block" | "finalized_block">,
  ethUsd: EthUsdSnapshot | null,
  nowMs: number = Date.now(),
  anchor?: Change24hAnchor,
  publicAssetBaseUrl?: string,
): TokenCard {
  const snap = resolveSnapshot(ethUsd);
  return {
    address: row.address,
    name: row.name,
    ticker: row.ticker,
    imageUrl: rewriteLocalStorageUrl(row.image_url, publicAssetBaseUrl),
    // Card-preview blurb (D-70; api.md section 3.4). `tokens.description` is already
    // SELECTed onto TokenListRow — the card just truncates it; the FULL text stays
    // on TokenDetail (GET /v1/tokens/:address). Required-nullable in the ratified
    // shared shape: null when absent, else server-truncated to the card cap.
    description:
      row.description == null ? null : row.description.slice(0, TOKEN_CARD_DESCRIPTION_MAX),
    creator: row.creator,
    createdAt: row.created_at,
    priceEth: row.last_price_eth,
    mcap: usdFromEthFloat(mcapEthFloat(row), snap, nowMs),
    // ETH-first mcap source : OG/cards render from this, USD derives from it.
    mcapEth: mcapEthWei(row),
    progressPct: progressFraction(row.real_eth_reserves, row.graduation_eth),
    // via the ONE shared resolver, over the batched 24h anchor. Absent
    // anchor (no trades / not fetched) → 0 per the spec's no-trades rule.
    change24hPct: computeChange24hPct({
      nowSec: Math.floor(nowMs / 1000),
      lastPrice: row.last_price_eth,
      firstTradePrice: anchor?.firstTradePrice ?? null,
      createdAtSec: row.created_at,
      hourCandles: anchor?.hourCandles ?? [],
    }),
    volume24h: row.volume_eth_24h,
    graduated: row.graduated,
    status: deriveStatus(row),
    confirmationState: projectConfirmation(row.block_number, wm),
    moderation: {
      visibility: row.m_visibility ?? "visible",
      impersonationFlag: row.m_impersonation_flag ?? false,
    },
  };
}
