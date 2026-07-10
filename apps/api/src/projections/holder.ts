/**
 * HolderJoinedRow → `HolderRow` (frozen shared DTO). Flags are computed at query
 * time (indexer.md §3.6 — not stored) by comparing the holder against the
 * token's creator / curve / pool addresses and configured vault addresses.
 * `botFlags`/`clusterId` are the v1.2 advisory labels from `address_flags`.
 */
import type { HolderRow } from "@robbed/shared";
import type { HolderJoinedRow } from "../lib/db";
import { ratio } from "./common";

export interface SpecialAddresses {
  creator: string;
  curve: string;
  pool: string | null;
  /** Treasury / LPFeeVault addresses (config), lowercased. */
  vaults: Set<string>;
}

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
    flags,
  };
  if (row.flags?.flags && row.flags.flags.length > 0) out.botFlags = row.flags.flags;
  if (row.flags?.cluster_id) out.clusterId = row.flags.cluster_id;
  return out;
}
