/**
 * HolderJoinedRow → `HolderRow` (frozen shared DTO). Flags are computed at query
 * time (indexer.md §3.6 — not stored) by comparing the holder against the
 * token's creator / curve / pool addresses and configured vault addresses.
 * `botFlags`/`clusterId` are the v1.2 advisory labels from `address_flags`.
 */
import type { HolderRow } from "@robbed/shared";
import type { HolderJoinedRow } from "../lib/db";
import type { HolderSpecialAddresses } from "../lib/listSort";
import { ratio } from "./common";

/**
 * Creator/curve/pool/vault addresses used BOTH by the flag projection here and
 * the holders `label` sort CASE (lib/listSort.ts) — single-sourced as
 * `HolderSpecialAddresses` so the label the row shows and the label it sorts by
 * can't drift. The route builds ONE of these and passes it to `getHolders`
 * (SQL CASE) and `toHolderRow` (flags).
 */
export type SpecialAddresses = HolderSpecialAddresses;

export function toHolderRow(
  row: HolderJoinedRow,
  totalSupply: string,
  special: SpecialAddresses,
): HolderRow {
  const addr = row.holder.toLowerCase();
  const flags: HolderRow["flags"] = [];
  if (addr === special.creator.toLowerCase()) flags.push("creator");
  if (addr === special.curve.toLowerCase()) flags.push("curve");
  if (special.pool && addr === special.pool.toLowerCase()) flags.push("lp_pool");
  if (special.vaults.has(addr)) flags.push("vault");

  const out: HolderRow = {
    address: row.holder,
    balance: row.balance,
    pct: ratio(row.balance, totalSupply) * 100,
    // True balance-desc rank over the whole token (§12.59) — stable even when
    // this page is sorted by address/label (position ≠ rank there).
    rank: row.rank,
    flags,
  };
  if (row.flags?.flags && row.flags.flags.length > 0) out.botFlags = row.flags.flags;
  if (row.flags?.cluster_id) out.clusterId = row.flags.cluster_id;
  return out;
}
