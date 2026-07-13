/**
 * readCurveImmutables — per-curve on-chain read of BondingCurve immutables
 * (§12.38/§12.40d). Verifies the reader maps each immutable to the token-row
 * field and that `trade_fee_bps` is a non-null number sourced from THIS curve's
 * `TRADE_FEE_BPS` (not the factory config).
 */
import { describe, expect, it } from "bun:test";
import { bondingCurveAbi } from "@robbed/shared/abi";
import {
  readCurveImmutables,
  readCurveImmutablesWithFallback,
  type ContractReader,
} from "../src/curveReader";

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
      CREATOR_FEE_BPS: 50, // §12.63 creator-fee split
    });

    const c = await readCurveImmutables(client, CURVE);

    expect(c.virtualEth0).toBe(30n * 10n ** 18n);
    expect(c.virtualToken0).toBe(1_073_000_000n * 10n ** 18n);
    expect(c.curveSupply).toBe(800_000_000n * 10n ** 18n);
    expect(c.lpTokenTranche).toBe(200_000_000n * 10n ** 18n);
    expect(c.graduationEth).toBe(85n * 10n ** 18n);
    expect(c.tradeFeeBps).toBe(100);
    expect(c.creatorFeeBps).toBe(50); // §7 / §12.63 per-token creator fee snapshot
  });

  it("defaults creator_fee_bps to 0 when CREATOR_FEE_BPS reverts (v1 curve, §12.63)", async () => {
    // A v1 curve predates the creator-fee leg — its CREATOR_FEE_BPS call reverts.
    // The read must degrade to 0 (v1 value) WITHOUT failing token creation, so the
    // six core immutables still map. The stub throws on the unknown function.
    const { client } = stubClient({
      VIRTUAL_ETH_0: 1n,
      VIRTUAL_TOKEN_0: 1n,
      CURVE_SUPPLY: 1n,
      LP_TOKEN_TRANCHE: 1n,
      GRADUATION_ETH: 1n,
      TRADE_FEE_BPS: 100,
      // CREATOR_FEE_BPS deliberately ABSENT → stub throws → reader returns 0.
    });
    const c = await readCurveImmutables(client, CURVE);
    expect(c.creatorFeeBps).toBe(0);
    expect(c.tradeFeeBps).toBe(100); // core immutables unaffected by the fee revert
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

const ALL_VALUES = {
  VIRTUAL_ETH_0: 30n * 10n ** 18n,
  VIRTUAL_TOKEN_0: 1_073_000_000n * 10n ** 18n,
  CURVE_SUPPLY: 800_000_000n * 10n ** 18n,
  LP_TOKEN_TRANCHE: 200_000_000n * 10n ** 18n,
  GRADUATION_ETH: 85n * 10n ** 18n,
  TRADE_FEE_BPS: 100,
  CREATOR_FEE_BPS: 50,
} as const;

/** Stub that always throws — a pruned non-archive node ("missing trie node"). */
function prunedClient(): ContractReader {
  return {
    async readContract() {
      throw new Error("missing trie node ef2c… (path ) state … is not available, not found");
    },
  };
}

describe("readCurveImmutablesWithFallback — pruned-state fallback at latest", () => {
  it("uses the primary (event-block) reader when it succeeds — fallback untouched", async () => {
    const primary = stubClient(ALL_VALUES);
    let fallbackTouched = false;
    const fallback: ContractReader = {
      async readContract() {
        fallbackTouched = true;
        throw new Error("must not be called");
      },
    };
    const c = await readCurveImmutablesWithFallback(primary.client, fallback, CURVE);
    expect(c.tradeFeeBps).toBe(100);
    expect(fallbackTouched).toBe(false);
  });

  it("falls back to the latest reader when the event-block state is pruned", async () => {
    const fallback = stubClient(ALL_VALUES);
    const c = await readCurveImmutablesWithFallback(prunedClient(), fallback.client, CURVE);
    // Values come from the fallback and are complete (immutables: value-identical).
    expect(c.virtualEth0).toBe(ALL_VALUES.VIRTUAL_ETH_0);
    expect(c.graduationEth).toBe(ALL_VALUES.GRADUATION_ETH);
    expect(c.creatorFeeBps).toBe(50);
    // 6 core immutables (Promise.all) + the defensive CREATOR_FEE_BPS read = 7.
    expect(fallback.calls.length).toBe(7);
  });

  it("propagates the error when BOTH readers fail (fail-closed, never a fabricated row)", async () => {
    await expect(
      readCurveImmutablesWithFallback(prunedClient(), prunedClient(), CURVE),
    ).rejects.toThrow(/missing trie node/);
  });
});
