/**
 * Read-derivation of `confirmation_state` (OI-11 /, indexer.md).
 * There is no stored per-row column on Ponder tables; the API derives the tier
 * from the watermark sidecar in TWO places that must agree with the ONE shared
 * rule (`stateForBlock`): the TS projection (`projectConfirmation`) and the SQL
 * SELECT expression (`confirmationStateSql`). This suite pins both to the
 * shared boundaries (event AT the watermark is inclusive) and pins the SQL
 * branch ORDER (finalized checked first — the no-downgrade precedence).
 */
import { describe, expect, it } from "bun:test";
import { stateForBlock } from "@robbed/shared";
import { confirmationStateSql, projectConfirmation } from "../src/lib/confirmation";

describe("projectConfirmation — boundary agreement with shared stateForBlock", () => {
  const wm = { safe_block: 100, finalized_block: 50 };
  it("event AT finalized → finalized; AT safe → posted_to_l1; above → soft", () => {
    expect(projectConfirmation(50, wm)).toBe("finalized");
    expect(projectConfirmation(51, wm)).toBe("posted_to_l1");
    expect(projectConfirmation(100, wm)).toBe("posted_to_l1");
    expect(projectConfirmation(101, wm)).toBe("soft_confirmed");
  });
  it("agrees with stateForBlock on every boundary neighborhood", () => {
    for (const b of [0, 49, 50, 51, 99, 100, 101, 10_000]) {
      expect(projectConfirmation(b, wm)).toBe(
        stateForBlock(b, { safeBlock: wm.safe_block, finalizedBlock: wm.finalized_block }),
      );
    }
  });
});

describe("confirmationStateSql — SQL derivation encodes the same boundaries", () => {
  const sql = confirmationStateSql("t.block_number");

  it("reads the watermark SIDECAR singleton (never a stored row column)", () => {
    expect(sql).toContain("FROM confirmation_watermarks w WHERE w.id = 1");
  });

  it("finalized branch runs FIRST and both boundaries are inclusive (<=)", () => {
    const finalizedIdx = sql.indexOf("<= w.finalized_block THEN 'finalized'");
    const postedIdx = sql.indexOf("<= w.safe_block THEN 'posted_to_l1'");
    expect(finalizedIdx).toBeGreaterThan(-1);
    expect(postedIdx).toBeGreaterThan(-1);
    // CASE precedence = the no-downgrade rule: a block <= finalized must never
    // fall through to posted_to_l1.
    expect(finalizedIdx).toBeLessThan(postedIdx);
    expect(sql).toContain("ELSE 'soft_confirmed'");
  });

  it("embeds the given block-number column in both comparisons", () => {
    expect(sql.match(/t\.block_number <=/g)).toHaveLength(2);
    const other = confirmationStateSql("trades.block_number");
    expect(other.match(/trades\.block_number <=/g)).toHaveLength(2);
  });

  it("falls back to 'soft_confirmed' when the singleton is unseeded (fresh deploy)", () => {
    expect(sql.startsWith("coalesce((SELECT CASE")).toBe(true);
    expect(sql.endsWith(", 'soft_confirmed')")).toBe(true);
  });
});
