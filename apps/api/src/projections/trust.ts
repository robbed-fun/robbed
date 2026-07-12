/**
 * Trust panel projection (§5.2, api.md §3.4). All derived, none hardcoded. The
 * LP sentence is the exact shared `LP_COPY` constant (CLAUDE.md hard rule —
 * never "burned"). `organic` is the v1.2 advisory range from indexer
 * `token_flow_stats`, null until computed; a RANGE, never a point value (§5.2).
 *
 * `feePolicy.tradeFeeBps` is the PER-TOKEN `tokens.trade_fee_bps` snapshot
 * (§12.40d) — the fee that curve actually charges — NOT the factory-current
 * `config.TRADE_FEE_BPS`, which would misreport an older curve deployed under a
 * different fee. Same for the card/list surface.
 */
import { LP_COPY, type OrganicFlow, type TokenFlowStatsRow, type TrustPanel } from "@robbed/shared";
import type { TokenDetailRow } from "../lib/db";

/**
 * The ONE `token_flow_stats` row → shared `organicFlowSchema` projection.
 * Served on the public Trust panel (below) AND the internal flow-quality
 * endpoint (routes/internal.ts, D-4/M2-13) — extracted so the two surfaces
 * cannot drift (anti-drift; api.md §3.7 "same projection").
 */
export function buildOrganic(flow: TokenFlowStatsRow | null): OrganicFlow | null {
  return flow
    ? {
        holderPctLow: flow.organic_holder_pct_low,
        holderPctHigh: flow.organic_holder_pct_high,
        volumePct: flow.organic_volume_pct,
        flaggedClusterVolPct24h: flow.flagged_cluster_vol_pct_24h,
        methodology: "heuristic — see §8.5",
        updatedAt: flow.updated_at,
      }
    : null;
}

export function buildTrust(row: TokenDetailRow): TrustPanel {
  return {
    metadataVerification: {
      status: row.verification?.status ?? "unfetched",
      onchainHash: row.verification?.onchain_hash ?? row.metadata_hash,
      ...(row.verification?.computed_hash
        ? { computedHash: row.verification.computed_hash }
        : {}),
      ...(row.verification?.verified_at
        ? { verifiedAt: row.verification.verified_at }
        : {}),
    },
    lpCopy: LP_COPY,
    feePolicy: {
      tradeFeeBps: row.trade_fee_bps, // §12.40d per-curve snapshot, not factory-current
      creatorFeeBps: row.creator_fee_bps, // 0 in v1 (§7), present from day 1
    },
    organic: buildOrganic(row.flow),
  };
}
