/**
 * readCurveImmutables — per-curve on-chain read of BondingCurve immutables
 * (§12.38/§12.40d). Verifies the reader maps each immutable to the token-row
 * field and that `trade_fee_bps` is a non-null number sourced from THIS curve's
 * `TRADE_FEE_BPS` (not the factory config).
 */
import { describe, expect, it } from "bun:test";
import { bondingCurveAbi } from "@robbed/shared/abi";
import { readCurveImmutables, type ContractReader } from "../src/curveReader";

/** Stub client returning canned values keyed by functionName; records calls. */
function stubClient(values: Record<string, bigint | number>): {
  client: ContractReader;
  calls: Array<{ address: string; functionName: string }>;
} {
  const calls: Array<{ address: string; functionName: string }> = [];
  const client: ContractReader = {
    async readContract({ abi, address, functionName }) {
      // The reader MUST pass the shared bondingCurveAbi, never a redeclared one.
      expect(abi).toBe(bondingCurveAbi);
      calls.push({ address, functionName });
      if (!(functionName in values)) throw new Error(`unexpected read: ${functionName}`);
      return values[functionName];
    },
  };
  return { client, calls };
}

const CURVE = "0xAbCdef0123456789abcdef0123456789ABCDEF01";

describe("readCurveImmutables (§12.40d per-curve read)", () => {
  it("maps each immutable to its struct field", async () => {
    const { client } = stubClient({
      VIRTUAL_ETH_0: 30n * 10n ** 18n,
      VIRTUAL_TOKEN_0: 1_073_000_000n * 10n ** 18n,
      CURVE_SUPPLY: 800_000_000n * 10n ** 18n,
      LP_TOKEN_TRANCHE: 200_000_000n * 10n ** 18n,
      GRADUATION_ETH: 85n * 10n ** 18n,
      TRADE_FEE_BPS: 100,
    });

    const c = await readCurveImmutables(client, CURVE);

    expect(c.virtualEth0).toBe(30n * 10n ** 18n);
    expect(c.virtualToken0).toBe(1_073_000_000n * 10n ** 18n);
    expect(c.curveSupply).toBe(800_000_000n * 10n ** 18n);
    expect(c.lpTokenTranche).toBe(200_000_000n * 10n ** 18n);
    expect(c.graduationEth).toBe(85n * 10n ** 18n);
    expect(c.tradeFeeBps).toBe(100);
  });

  it("yields a non-null NUMBER trade_fee_bps (Trust-panel source)", async () => {
    const { client } = stubClient({
      VIRTUAL_ETH_0: 1n,
      VIRTUAL_TOKEN_0: 1n,
      CURVE_SUPPLY: 1n,
      LP_TOKEN_TRANCHE: 1n,
      GRADUATION_ETH: 1n,
      TRADE_FEE_BPS: 100,
    });
    const c = await readCurveImmutables(client, CURVE);
    expect(c.tradeFeeBps).not.toBeNull();
    expect(typeof c.tradeFeeBps).toBe("number");
    expect(Number.isInteger(c.tradeFeeBps)).toBe(true);
  });

  it("coerces a bigint-decoded fee to a number (defensive)", async () => {
    const { client } = stubClient({
      VIRTUAL_ETH_0: 1n,
      VIRTUAL_TOKEN_0: 1n,
      CURVE_SUPPLY: 1n,
      LP_TOKEN_TRANCHE: 1n,
      GRADUATION_ETH: 1n,
      TRADE_FEE_BPS: 250n, // some decoders return uint16 as bigint
    });
    const c = await readCurveImmutables(client, CURVE);
    expect(c.tradeFeeBps).toBe(250);
    expect(typeof c.tradeFeeBps).toBe("number");
  });

  it("reads from the lowercased curve address (§3 address convention)", async () => {
    const { client, calls } = stubClient({
      VIRTUAL_ETH_0: 1n,
      VIRTUAL_TOKEN_0: 1n,
      CURVE_SUPPLY: 1n,
      LP_TOKEN_TRANCHE: 1n,
      GRADUATION_ETH: 1n,
      TRADE_FEE_BPS: 100,
    });
    await readCurveImmutables(client, CURVE);
    for (const call of calls) expect(call.address).toBe(CURVE.toLowerCase());
    // A curve created under a prior fee is read from ITS curve, so the fee is
    // per-token — never the factory config (§12.40d divergence handling).
    expect(calls.some((c) => c.functionName === "TRADE_FEE_BPS")).toBe(true);
  });
});
