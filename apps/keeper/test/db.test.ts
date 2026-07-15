import { describe, expect, test } from "bun:test";
import {
  READY_CURVES_SQL,
  GRADUATED_LP_POSITIONS_SQL,
  TREASURY_FEE_CURVES_SQL,
  mapGraduatedLpRows,
  mapReadyRows,
  mapTreasuryFeeRows,
  queryGraduatedLpPositions,
  queryReadyCurves,
  queryTreasuryFeeCurves,
  type QueryClient,
} from "../src/db";

describe("fallback-sweep query shape", () => {
  test("selects ReadyToGraduate-not-yet-graduated via existing columns (no schema change)", () => {
    const sql = READY_CURVES_SQL.replace(/\s+/g, " ").trim();
    expect(sql).toContain("FROM tokens");
    expect(sql).toContain("graduated = false");
    expect(sql).toContain("real_eth_reserves >= graduation_eth");
    expect(sql).toContain("SELECT address, curve_address");
    // Deterministic drain order after downtime.
    expect(sql).toContain("ORDER BY block_number ASC");
  });

  test("mapReadyRows lowercases + maps address/curve_address → token/curve", () => {
    const mapped = mapReadyRows([{ address: "0xAABBCC", curve_address: "0xDDEEFF" }]);
    expect(mapped).toEqual([{ token: "0xaabbcc", curve: "0xddeeff" }] as never);
  });

  test("queryReadyCurves runs the SQL and returns mapped rows", async () => {
    let calledWith = "";
    const fake: QueryClient = {
      async query<R>(text: string): Promise<{ rows: R[] }> {
        calledWith = text;
        return { rows: [{ address: "0xToKeN01", curve_address: "0xCuRvE01" }] as unknown as R[] };
      },
    };
    const rows = await queryReadyCurves(fake);
    expect(calledWith).toBe(READY_CURVES_SQL);
    expect(rows).toEqual([{ token: "0xtoken01", curve: "0xcurve01" }] as never);
  });
});

describe("treasury-fee sweep query shape", () => {
  test("selects all fee-bearing curves, including graduated rows", () => {
    const sql = TREASURY_FEE_CURVES_SQL.replace(/\s+/g, " ").trim();
    expect(sql).toContain("FROM tokens");
    expect(sql).toContain("trade_fee_bps > 0");
    expect(sql).not.toContain("graduated = false");
    expect(sql).toContain("SELECT address, curve_address");
    expect(sql).toContain("ORDER BY block_number ASC");
  });

  test("mapTreasuryFeeRows lowercases + maps address/curve_address → token/curve", () => {
    const mapped = mapTreasuryFeeRows([{ address: "0xAABBCC", curve_address: "0xDDEEFF" }]);
    expect(mapped).toEqual([{ token: "0xaabbcc", curve: "0xddeeff" }] as never);
  });

  test("queryTreasuryFeeCurves runs the SQL and returns mapped rows", async () => {
    let calledWith = "";
    const fake: QueryClient = {
      async query<R>(text: string): Promise<{ rows: R[] }> {
        calledWith = text;
        return { rows: [{ address: "0xToKeN02", curve_address: "0xCuRvE02" }] as unknown as R[] };
      },
    };
    const rows = await queryTreasuryFeeCurves(fake);
    expect(calledWith).toBe(TREASURY_FEE_CURVES_SQL);
    expect(rows).toEqual([{ token: "0xtoken02", curve: "0xcurve02" }] as never);
  });
});

describe("graduated-LP collect query shape", () => {
  test("selects graduated LP positions from the graduations table", () => {
    const sql = GRADUATED_LP_POSITIONS_SQL.replace(/\s+/g, " ").trim();
    expect(sql).toContain("FROM graduations");
    expect(sql).toContain("SELECT token_address, pool_address, lp_token_id, token_is_token0");
    expect(sql).toContain("ORDER BY block_number ASC");
  });

  test("mapGraduatedLpRows lowercases addresses and parses lp_token_id", () => {
    const mapped = mapGraduatedLpRows([
      {
        token_address: "0xAABBCC",
        pool_address: "0xDDEEFF",
        lp_token_id: "70",
        token_is_token0: true,
      },
    ]);
    expect(mapped).toEqual([
      { token: "0xaabbcc", pool: "0xddeeff", lpTokenId: 70n, tokenIsToken0: true },
    ] as never);
  });

  test("queryGraduatedLpPositions runs the SQL and returns mapped rows", async () => {
    let calledWith = "";
    const fake: QueryClient = {
      async query<R>(text: string): Promise<{ rows: R[] }> {
        calledWith = text;
        return {
          rows: [
            {
              token_address: "0xToKeN03",
              pool_address: "0xPoOl03",
              lp_token_id: "71",
              token_is_token0: false,
            },
          ] as unknown as R[],
        };
      },
    };
    const rows = await queryGraduatedLpPositions(fake);
    expect(calledWith).toBe(GRADUATED_LP_POSITIONS_SQL);
    expect(rows).toEqual([
      { token: "0xtoken03", pool: "0xpool03", lpTokenId: 71n, tokenIsToken0: false },
    ] as never);
  });
});
