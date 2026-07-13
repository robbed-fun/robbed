import { describe, expect, test } from "bun:test";
import { READY_CURVES_SQL, mapReadyRows, queryReadyCurves, type QueryClient } from "../src/db";

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
