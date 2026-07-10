/**
 * hood.fun competitor snapshot suite (indexer.md §8.5.3, spec §3/§14; M2-14).
 * Asserts snapshots are SOURCE + TIMESTAMPED (never a hardcoded metric, §2), a
 * dated row is produced from an injected source, and an unconfigured source
 * writes nothing (never fabricates a number).
 */
import { describe, expect, it } from "bun:test";
import {
  buildCompetitorSnapshot,
  runCompetitorSnapshotTick,
  unconfiguredCompetitorSource,
  type CompetitorSource,
  type CompetitorStore,
} from "../src/jobs/competitor";
import type { CompetitorSnapshotRow } from "@robbed/shared";

function captureStore() {
  const rows: CompetitorSnapshotRow[] = [];
  const store: CompetitorStore = {
    async write(row) {
      rows.push(row);
    },
  };
  return { store, rows };
}

const fixedNow = () => new Date("2026-07-10T00:00:00.000Z");

describe("buildCompetitorSnapshot — source + timestamped", () => {
  it("builds a validated, dated row", () => {
    const row = buildCompetitorSnapshot("dune:query/123", fixedNow().toISOString(), {
      tokensPerDay: 42,
      graduations: 3,
      visibleVolumeEthWei: "123456789000000000000",
    });
    expect(row.source).toBe("dune:query/123");
    expect(row.captured_at).toBe("2026-07-10T00:00:00.000Z");
    expect(row.tokens_per_day).toBe(42);
    expect(row.visible_volume_eth).toBe("123456789000000000000");
  });

  it("rejects an empty source (never a hardcoded metric, §2)", () => {
    expect(() =>
      buildCompetitorSnapshot("", fixedNow().toISOString(), {
        tokensPerDay: 1,
        graduations: 0,
        visibleVolumeEthWei: "0",
      }),
    ).toThrow();
  });

  it("rejects a non-decimal volume string", () => {
    expect(() =>
      buildCompetitorSnapshot("dune", fixedNow().toISOString(), {
        tokensPerDay: 1,
        graduations: 0,
        visibleVolumeEthWei: "12.5",
      }),
    ).toThrow();
  });
});

describe("runCompetitorSnapshotTick", () => {
  it("produces a dated row from an injected source", async () => {
    const { store, rows } = captureStore();
    const source: CompetitorSource = {
      label: "dune:query/999",
      async fetch() {
        return { tokensPerDay: 10, graduations: 2, visibleVolumeEthWei: "5000000000000000000" };
      },
    };
    const row = await runCompetitorSnapshotTick({ source, store, now: fixedNow });
    expect(row).not.toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("dune:query/999");
    expect(rows[0]!.captured_at).toBe("2026-07-10T00:00:00.000Z");
    expect(rows[0]!.graduations).toBe(2);
  });

  it("unconfigured source writes NOTHING (no fabricated metric)", async () => {
    const { store, rows } = captureStore();
    const row = await runCompetitorSnapshotTick({
      source: unconfiguredCompetitorSource(),
      store,
      now: fixedNow,
      logger: { log() {}, error() {} },
    });
    expect(row).toBeNull();
    expect(rows).toHaveLength(0);
  });
});
