/**
 * TokenListRow → `TokenCard` (frozen shared DTO). Status is DERIVED, not stored
 * (indexer.md §3.2): `graduated` → graduated; `real_eth ≥ graduation_eth` and
 * not yet graduated → the §12.12 lock window `graduating`; else `curve`. mcap USD
 * is computed at request time from the ETH/USD snapshot — never a constant (§2).
 */
import { computeChange24hPct, type TokenCard } from "@robbed/shared";
import type { ConfirmationWatermarksRow } from "@robbed/shared";
import type { Change24hAnchor, TokenListRow } from "../lib/db";
import { projectConfirmation } from "../lib/confirmation";
import type { EthUsdSnapshot } from "../lib/usd";
import { usdFromEthFloat } from "../lib/usd";
import { progressFraction, resolveSnapshot } from "./common";

const WEI_PER_ETH = 1e18;
const WEI_PER_ETH_BIG = 10n ** 18n;

export function deriveStatus(row: TokenListRow): TokenCard["status"] {
  if (row.graduated) return "graduated";
  if (BigInt(row.real_eth_reserves || "0") >= BigInt(row.graduation_eth || "0")) {
    return "graduating";
  }
  return "curve";
}

/** mcap in ETH (float) = price(ETH/token) × totalSupply(tokens). USD derives from this. */
function mcapEthFloat(row: TokenListRow): number {
  if (row.last_price_eth == null) return 0;
  const supplyTokens = Number(BigInt(row.total_supply || "0")) / WEI_PER_ETH;
  return row.last_price_eth * supplyTokens;
}

/**
 * mcap in ETH as a wei decimal string (decisions.md §7.2 item 3) — the ETH-first
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
): TokenCard {
  const snap = resolveSnapshot(ethUsd);
  return {
    address: row.address,
    name: row.name,
    ticker: row.ticker,
    imageUrl: row.image_url,
    creator: row.creator,
    createdAt: row.created_at,
    priceEth: row.last_price_eth,
    mcap: usdFromEthFloat(mcapEthFloat(row), snap, nowMs),
    // ETH-first mcap source (§2): OG/cards render from this, USD derives from it.
    mcapEth: mcapEthWei(row),
    progressPct: progressFraction(row.real_eth_reserves, row.graduation_eth),
    // §12.40e via the ONE shared resolver, over the batched 24h anchor. Absent
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
