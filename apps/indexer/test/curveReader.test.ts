/**
 * readCurveImmutables — per-curve on-chain read of BondingCurve immutables
 *. Verifies the reader maps each immutable to the token-row
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

describe("readCurveImmutables (per-curve read)", () => {
  it("maps each immutable to its struct field", async () => {
    const { client } = stubClient({
      VIRTUAL_ETH_0: 30n * 10n ** 18n,
      VIRTUAL_TOKEN_0: 1_073_000_000n * 10n ** 18n,
      CURVE_SUPPLY: 800_000_000n * 10n ** 18n,
      LP_TOKEN_TRANCHE: 200_000_000n * 10n ** 18n,
      GRADUATION_ETH: 85n * 10n ** 18n,
      TRADE_FEE_BPS: 100,
      CREATOR_FEE_BPS: 50, // creator-fee split
    });

    const c = await readCurveImmutables(client, CURVE);

    expect(c.virtualEth0).toBe(30n * 10n ** 18n);
    expect(c.virtualToken0).toBe(1_073_000_000n * 10n ** 18n);
    expect(c.curveSupply).toBe(800_000_000n * 10n ** 18n);
    expect(c.lpTokenTranche).toBe(200_000_000n * 10n ** 18n);
    expect(c.graduationEth).toBe(85n * 10n ** 18n);
    expect(c.tradeFeeBps).toBe(100);
    expect(c.creatorFeeBps).toBe(50); // per-token creator fee snapshot
  });

  it("defaults creator_fee_bps to 0 when CREATOR_FEE_BPS reverts (v1 curve)", async () => {
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

  it("reads from the lowercased curve address (address convention)", async () => {
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
    // per-token — never the factory config (divergence handling).
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

  it("degrades to safe defaults (NEVER throws) when BOTH event-block and latest are pruned", async () => {
    // A single failed read must never stall the backfill (Ponder retries-9×-and-
    // wedges on a throw). When the event block AND `latest` are both pruned, each
    // read degrades to its per-immutable default so the handler proceeds — a
    // reindex on an archive RPC later restores the true (immutable) values.
    const c = await readCurveImmutablesWithFallback(prunedClient(), prunedClient(), CURVE);
    expect(c.virtualEth0).toBe(0n);
    expect(c.virtualToken0).toBe(0n);
    expect(c.curveSupply).toBe(0n);
    expect(c.lpTokenTranche).toBe(0n);
    expect(c.graduationEth).toBe(0n);
    expect(c.tradeFeeBps).toBe(0);
    expect(c.creatorFeeBps).toBe(0);
  });

  it("degrades ONLY the pruned reads to latest, leaving the healthy reads on the event block", async () => {
    // Mirrors the observed live failure: CURVE_SUPPLY (0x1e4c7292), GRADUATION_ETH
    // (0xa6f5302b) and TRADE_FEE_BPS (0x9185f598) throw "missing trie node" at the
    // event block while the rest read fine. The three degrade to `latest`; the
    // others never touch the fallback.
    const pruned = new Set(["CURVE_SUPPLY", "GRADUATION_ETH", "TRADE_FEE_BPS"]);
    const primary: ContractReader = {
      async readContract({ functionName }) {
        if (pruned.has(functionName)) {
          throw new Error(`missing trie node … (path 0x7cd37…) state … is not available, not found`);
        }
        return (ALL_VALUES as Record<string, bigint | number>)[functionName];
      },
    };
    const fallback = stubClient(ALL_VALUES);
    const c = await readCurveImmutablesWithFallback(primary, fallback.client, CURVE);
    // Correct values regardless of which reader served them (immutables are equal).
    expect(c.curveSupply).toBe(ALL_VALUES.CURVE_SUPPLY);
    expect(c.graduationEth).toBe(ALL_VALUES.GRADUATION_ETH);
    expect(c.tradeFeeBps).toBe(ALL_VALUES.TRADE_FEE_BPS);
    expect(c.virtualEth0).toBe(ALL_VALUES.VIRTUAL_ETH_0);
    // Only the three pruned selectors were re-read at latest.
    expect(fallback.calls.map((x) => x.functionName).sort()).toEqual(
      ["CURVE_SUPPLY", "GRADUATION_ETH", "TRADE_FEE_BPS"].sort(),
    );
  });
});
