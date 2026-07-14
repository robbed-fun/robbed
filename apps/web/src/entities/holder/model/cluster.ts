import type { BotFlag, HolderRow } from "@robbed/shared";

/**
 * Holder-list domain helpers (HolderTable + v1.2 funding-cluster grouping).
 * PURE — unit-testable (tests/holder-cluster.test.tsx). All labels here are
 * ADVISORY heuristics : they describe indexer estimates, never gate
 * anything, and must be framed as heuristic, never as fact.
 */

/** Human label for a structural holder flag ("creator/curve/vault flagged"). */
export const HOLDER_FLAG_LABELS: Record<HolderRow["flags"][number], string> = {
  creator: "Creator",
  curve: "Bonding curve",
  lp_pool: "LP pool",
  vault: "LP fee vault",
};

/** Human label for an advisory bot/farm flag. Heuristic framing only. */
export const BOT_FLAG_LABELS: Record<BotFlag, string> = {
  farm: "farm",
  sniper: "sniper",
  programmatic: "programmatic",
  wash: "wash",
  arb_exit: "arb exit",
};

export interface HolderCluster {
  /** Shared gas-funder cluster id, or null for ungrouped rows. */
  clusterId: string | null;
  rows: HolderRow[];
}

/**
 * Group the top-N holder rows so addresses sharing a `clusterId` (same
 * gas-funding source) are visually adjacent while preserving rank order.
 * Ungrouped rows (no clusterId, or a singleton cluster) render standalone —
 * grouping a lone address would over-state confidence ("heuristic").
 *
 * Order is stable: a cluster takes the position of its highest-ranked member, so
 * the balance ranking is preserved as the primary axis.
 */
export function groupHoldersByCluster(rows: readonly HolderRow[]): HolderCluster[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.clusterId) counts.set(r.clusterId, (counts.get(r.clusterId) ?? 0) + 1);
  }

  const out: HolderCluster[] = [];
  const clusterIndex = new Map<string, number>();

  for (const row of rows) {
    const shared = row.clusterId && (counts.get(row.clusterId) ?? 0) >= 2;
    if (shared) {
      const id = row.clusterId as string;
      const existing = clusterIndex.get(id);
      if (existing !== undefined) {
        out[existing]!.rows.push(row);
        continue;
      }
      clusterIndex.set(id, out.length);
      out.push({ clusterId: id, rows: [row] });
    } else {
      out.push({ clusterId: null, rows: [row] });
    }
  }
  return out;
}

/** True if any holder row carries a shared (≥2-member) funding cluster. */
export function hasFundingClusters(rows: readonly HolderRow[]): boolean {
  return groupHoldersByCluster(rows).some((c) => c.clusterId !== null);
}
