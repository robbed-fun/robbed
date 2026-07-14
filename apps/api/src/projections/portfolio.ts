/**
 * Portfolio projections (api.md) — `PortfolioHolding` +
 * `PortfolioSummary` from the frozen `@robbed/shared` DTOs. ETH-first :
 * value/PnL are wei decimal strings; USD mirrors derive at request time from the
 * ETH/USD snapshot (`usdFromWei`), never a constant. Balances are Transfer-truth
 * (/ X-4/X-5); price/value are computed READ-TIME (no stored USD).
 *
 * ── Read-time pricing (why curve-quote, not last_price × qty) ────────────────
 * A holding's `valueEth` is the LIQUIDATION value: what the curve would actually
 * pay to sell the whole balance now — `previewSell` from `@robbed/shared`
 * curve-quote over the live virtual reserves (fee-inclusive, rounds toward the
 * curve; contracts.md). That is the honest, no-false-precision number
 * and it can't overstate. `priceEth` is the display-only spot float
 * (`tokens.last_price_eth`, venue-continuous across graduation). Both are `null`
 * when the token has NEVER traded (`last_price_eth == null`) — the indexer can't
 * price it, so we don't guess. For a GRADUATED token the curve is drained, so
 * curve-quote no longer applies; we mark-to-spot (`last_price × balance`).
 *
 * ── Unrealized PnL as a RANGE (no false precision) ─────────────────────
 * point = liquidationValue − remainingCostBasis, where
 *   remainingCostBasis = total_eth_in · min(balance, tokensBought) / tokensBought
 * (average cost on the still-held qty; tokens acquired purely by transfer-in carry
 * no basis). `null` when there is NO cost basis at all (tokensBought == 0).
 * - curve-only token (basis EXACT) → low == high == point, `exact`.
 *  - graduated token (basis best-effort — V3 legs, OI-5) → `estimated`, bracketed
 *    between the trusted recorded basis (low = value − basis) and a discarded
 *    basis (high = value). This mirrors the indexer realized-range "discard-vs-
 *    trust the uncertain V3 data" bracket (src/pnl/compute.ts), applied to basis.
 */
import {
  type AddressPnlRow,
  type EthPnlRange,
  type PortfolioHolding,
  type PortfolioSummary,
  type TokenRef,
  previewSell,
} from "@robbed/shared";
import type { PortfolioHoldingRow } from "../lib/db";
import type { EthUsdSnapshot } from "../lib/usd";
import { usdFromWei } from "../lib/usd";
import { resolveSnapshot, statusFrom } from "./common";

const WEI_PER_ETH = 10n ** 18n;

/** Compact token reference for portfolio rows (avatar + ticker + venue pill). */
function toTokenRef(row: PortfolioHoldingRow): TokenRef {
  return {
    address: row.token_address,
    name: row.name,
    ticker: row.ticker,
    imageUrl: row.image_url,
    graduated: row.graduated,
    status: statusFrom(row.graduated, row.real_eth_reserves, row.graduation_eth),
  };
}

/**
 * Read-time price + liquidation value for a holding.
 * `valueEth` null iff the token has never traded (unpriceable — no false price).
 */
export function priceHolding(row: PortfolioHoldingRow): {
  priceEth: number | null;
  valueEth: bigint | null;
} {
  if (row.last_price_eth == null) return { priceEth: null, valueEth: null };
  const bal = BigInt(row.balance || "0");
  if (bal <= 0n) return { priceEth: row.last_price_eth, valueEth: 0n };
  if (!row.graduated) {
    const vE = BigInt(row.virtual_eth || "0");
    const vT = BigInt(row.virtual_token || "0");
    if (vE > 0n && vT > 0n) {
      // Fee-inclusive liquidation value from the live curve (rounds toward curve).
      const { ethOut } = previewSell(vE, vT, bal, row.trade_fee_bps);
      return { priceEth: row.last_price_eth, valueEth: ethOut };
    }
  }
  // Graduated (curve drained) or degenerate reserves → mark-to-spot, wei.
  const pricePerTokenWei = BigInt(Math.round(row.last_price_eth * 1e18));
  return { priceEth: row.last_price_eth, valueEth: (pricePerTokenWei * bal) / WEI_PER_ETH };
}

/** Best-effort unrealized-PnL range; null when the holding has no cost basis. */
export function unrealizedFor(
  row: PortfolioHoldingRow,
  valueEth: bigint | null,
): EthPnlRange | null {
  if (valueEth == null) return null;
  const bought = BigInt(row.total_bought_tokens || "0");
  if (bought <= 0n) return null; // pure transfer-in — no basis
  const bal = BigInt(row.balance || "0");
  const ethIn = BigInt(row.total_eth_in || "0");
  const remainingTokens = bal < bought ? bal : bought;
  const remainingBasis = (ethIn * remainingTokens) / bought;
  const point = valueEth - remainingBasis;
  if (!row.graduated) {
    return { low: point.toString(), high: point.toString(), confidence: "exact" };
  }
  // Graduated: basis is V3-best-effort → bracket [trusted basis, discarded basis].
  return { low: point.toString(), high: valueEth.toString(), confidence: "estimated" };
}

export function toPortfolioHolding(
  row: PortfolioHoldingRow,
  ethUsd: EthUsdSnapshot | null,
  nowMs: number = Date.now(),
): PortfolioHolding {
  const snap = resolveSnapshot(ethUsd);
  const { priceEth, valueEth } = priceHolding(row);
  return {
    token: toTokenRef(row),
    balance: row.balance,
    priceEth,
    valueEth: valueEth == null ? null : valueEth.toString(),
    value: valueEth == null ? null : usdFromWei(valueEth, snap, nowMs),
    unrealizedPnl: unrealizedFor(row, valueEth),
  };
}

/**
 * All-time PnL ("LOOT") = realized (materialized `address_pnl` range) + unrealized
 * (summed live over holdings). null when NO cost basis exists anywhere.
 * Component-wise range add; confidence downgrades to 'estimated' if any component
 * is estimated.
 */
function combinePnl(
  pnl: AddressPnlRow | null,
  holdings: PortfolioHoldingRow[],
): EthPnlRange | null {
  let low = 0n;
  let high = 0n;
  let any = false;
  let estimated = false;

  if (pnl && pnl.pnl_confidence != null) {
    low += BigInt(pnl.realized_pnl_low || "0");
    high += BigInt(pnl.realized_pnl_high || "0");
    any = true;
    if (pnl.pnl_confidence === "estimated") estimated = true;
  }
  for (const h of holdings) {
    const { valueEth } = priceHolding(h);
    const u = unrealizedFor(h, valueEth);
    if (!u) continue;
    low += BigInt(u.low);
    high += BigInt(u.high);
    any = true;
    if (u.confidence === "estimated") estimated = true;
  }
  if (!any) return null;
  return { low: low.toString(), high: high.toString(), confidence: estimated ? "estimated" : "exact" };
}

export function toPortfolioSummary(input: {
  address: string;
  pnl: AddressPnlRow | null;
  /**
   * Live `count(*)` from `trades` (Db.countAddressTrades) — NOT the advisory
   * `address_pnl.trade_count`, which lags by up to one roll-up interval and is
   * 0 on a fresh DB before the job's first tick (PORT-1). firstSeenAt /
   * tokensCreated / realized PnL below remain roll-up-sourced (advisory
   * latency ≤ PNL_JOB_INTERVAL_MS, default 60s — api.md).
   */
  tradeCount: number;
  holdings: PortfolioHoldingRow[];
  walletEthBalance: string;
  ethUsd: EthUsdSnapshot | null;
  nowMs?: number;
}): PortfolioSummary {
  const nowMs = input.nowMs ?? Date.now();
  const snap = resolveSnapshot(input.ethUsd);
  let totalValue = 0n;
  for (const h of input.holdings) {
    const { valueEth } = priceHolding(h);
    if (valueEth != null) totalValue += valueEth;
  }
  return {
    address: input.address,
    firstSeenAt: input.pnl?.first_seen_at ?? null,
    tradeCount: input.tradeCount,
    tokensCreated: input.pnl?.tokens_created ?? 0,
    walletEthBalance: input.walletEthBalance,
    totalValueEth: totalValue.toString(),
    totalValue: usdFromWei(totalValue, snap, nowMs),
    pnlAllTime: combinePnl(input.pnl, input.holdings),
  };
}
