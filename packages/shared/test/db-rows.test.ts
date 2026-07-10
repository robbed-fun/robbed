/**
 * DB row shapes (indexer.md §3 / §8.5). Interfaces are compile-time only, so
 * these fixtures lock the field sets (typecheck is the real guard, `tsc
 * --noEmit`); the runtime asserts guard against accidental key drops.
 */
import { describe, expect, it } from "bun:test";
import type {
  AddressFlagsRow,
  CompetitorSnapshotRow,
  TokenFlowStatsRow,
  TransferRow,
} from "../src/db-rows";

const ADDR = "0x" + "ab".repeat(20);
const TX = "0x" + "12".repeat(32);

describe("transfers row (X-5 — sixth event family, sole balance truth §12.16)", () => {
  it("carries the (tx,log) dedup anchor + Transfer fields", () => {
    const row: TransferRow = {
      id: `${TX}-4`,
      token_address: ADDR,
      from_address: ADDR,
      to_address: ADDR,
      value: "1000000000000000000",
      block_number: 123,
      block_timestamp: 1767950000,
      tx_hash: TX,
      log_index: 4,
      confirmation_state: "soft_confirmed",
    };
    expect(row.id).toBe(`${TX}-4`);
    expect(row.confirmation_state).toBe("soft_confirmed");
  });
});

describe("§8.5 offchain rows (bot/farm heuristics; competitor snapshots)", () => {
  it("address_flags uses the shared BotFlag vocabulary", () => {
    const row: AddressFlagsRow = {
      address: ADDR,
      flags: ["farm", "sniper", "arb_exit"],
      cluster_id: "cluster-7",
      updated_at: "2026-07-10T00:00:00Z",
    };
    expect(row.flags).toContain("arb_exit");
    expect(row.cluster_id).toBe("cluster-7");
  });

  it("token_flow_stats carries organic %/% ranges", () => {
    const row: TokenFlowStatsRow = {
      token_address: ADDR,
      organic_holder_pct_low: 41.2,
      organic_holder_pct_high: 58.7,
      organic_volume_pct: 63.0,
      flagged_cluster_vol_pct_24h: 22.5,
      updated_at: "2026-07-10T00:00:00Z",
    };
    expect(row.organic_holder_pct_high).toBeGreaterThan(row.organic_holder_pct_low);
  });

  it("competitor_snapshots is source+timestamped (never hardcoded, §2)", () => {
    const row: CompetitorSnapshotRow = {
      source: "dune:query/1234567",
      captured_at: "2026-07-10T00:00:00Z",
      tokens_per_day: 12.5,
      graduations: 3,
      visible_volume_eth: "84000000000000000000",
    };
    expect(row.source).not.toBe("");
    expect(row.captured_at).not.toBe("");
  });
});
