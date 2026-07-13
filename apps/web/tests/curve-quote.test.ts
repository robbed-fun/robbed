import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEADLINE_MINUTES,
  DEFAULT_SLIPPAGE_BPS,
  applySlippageFloor,
  clampSlippageBps,
  computeChainDeadline,
  computeDeadline,
  isGraduatingLock,
  isInEarlyWindow,
  isOnCurve,
  parseCurveReads,
  parseQuote,
  priceImpactPct,
  venueForStatus,
} from "@/entities/curve";

/**
 * Curve entity units (§5.2). The QUOTE itself is an on-chain view
 * (BondingCurve.quoteBuy/quoteSell); these prove the DISPLAY transforms around it
 * and the invisible-venue-switch selection — no market metric is inlined (§2).
 */

describe("invisible venue switch — status selects the engine (§5.2)", () => {
  it("curve pre-grad, v3 only after graduation, never a user choice", () => {
    expect(venueForStatus("curve")).toBe("curve");
    expect(venueForStatus("graduating")).toBe("curve"); // still the curve engine
    expect(venueForStatus("graduated")).toBe("v3");
    expect(isOnCurve("curve")).toBe(true);
    expect(isGraduatingLock("graduating")).toBe(true);
    expect(isGraduatingLock("curve")).toBe(false);
  });
});

describe("slippage floor (default 2%) — §5.2", () => {
  it("floors an amount by the tolerance, defaulting to 2%", () => {
    expect(DEFAULT_SLIPPAGE_BPS).toBe(200);
    // 1000 tokens at 2% → 980
    expect(applySlippageFloor(1000n, 200)).toBe(980n);
    // 1e24 wei at 0.5% → 0.995e24
    expect(applySlippageFloor(10n ** 24n, 50)).toBe(995n * 10n ** 21n);
  });

  it("clamps slippage into [0.1%, 50%]", () => {
    expect(clampSlippageBps(0)).toBe(10);
    expect(clampSlippageBps(999999)).toBe(5000);
    expect(clampSlippageBps(200)).toBe(200);
  });
});

describe("deadline is recomputed at call time (never a stale quote's) — §5.2", () => {
  it("returns now + N minutes in unix seconds", () => {
    const now = 1_800_000_000_000; // fixed ms
    expect(computeDeadline(now, 10)).toBe(BigInt(1_800_000_000 + 600));
  });

  it("defaults to a 20-minute window (headroom over the chain-time fix)", () => {
    expect(DEFAULT_DEADLINE_MINUTES).toBe(20);
  });
});

describe("computeChainDeadline — derives the deadline from CHAIN time, not the browser clock", () => {
  it("is blockTimestamp + window when a publicClient is present", async () => {
    // Chain clock is AHEAD of the browser clock by ~1h — the exact skew that
    // makes a browser-derived deadline expire on-chain. The chain-derived value
    // must anchor to block.timestamp, NOT Date.now().
    const chainTs = 2_000_000_000n;
    const client = { getBlock: async () => ({ timestamp: chainTs }) };
    const nowSeconds = 1_999_996_400; // browser lags the chain by 1h

    const deadline = await computeChainDeadline(client, 20);
    expect(deadline).toBe(chainTs + BigInt(20 * 60));
    // Proves it did NOT use the browser clock (which would be far smaller).
    expect(deadline).not.toBe(BigInt(nowSeconds + 20 * 60));
  });

  it("uses the default 20-minute window when none is given", async () => {
    const chainTs = 1_700_000_000n;
    const client = { getBlock: async () => ({ timestamp: chainTs }) };
    expect(await computeChainDeadline(client)).toBe(chainTs + BigInt(DEFAULT_DEADLINE_MINUTES * 60));
  });

  it("falls back to the browser clock when no client is present (never undefined)", async () => {
    const before = computeDeadline(undefined, 20);
    const deadline = await computeChainDeadline(undefined, 20);
    const after = computeDeadline(undefined, 20);
    expect(typeof deadline).toBe("bigint");
    expect(deadline).toBeGreaterThanOrEqual(before);
    expect(deadline).toBeLessThanOrEqual(after);
  });

  it("falls back to the browser clock when getBlock() throws", async () => {
    const client = {
      getBlock: async () => {
        throw new Error("rpc down");
      },
    };
    const before = computeDeadline(undefined, 20);
    const deadline = await computeChainDeadline(client, 20);
    const after = computeDeadline(undefined, 20);
    expect(deadline).toBeGreaterThanOrEqual(before);
    expect(deadline).toBeLessThanOrEqual(after);
  });
});

describe("parseQuote — normalizes the on-chain view tuples (contracts.md §2.3)", () => {
  it("buy tuple → [tokensOut, fee, acceptedEthGross, refund]", () => {
    const q = parseQuote("buy", [1234n, 5n, 990n, 10n]);
    expect(q).toEqual({
      side: "buy",
      amountOut: 1234n,
      feeEth: 5n,
      acceptedEthGross: 990n,
      refund: 10n,
    });
  });
  it("sell tuple → [ethOut, fee]", () => {
    const q = parseQuote("sell", [777n, 7n]);
    expect(q).toEqual({ side: "sell", amountOut: 777n, feeEth: 7n });
  });
  it("returns null for a malformed result", () => {
    expect(parseQuote("buy", undefined)).toBeNull();
    expect(parseQuote("sell", [])).toBeNull();
  });
});

describe("priceImpactPct — ratio of effective fill to curve spot", () => {
  it("is ~0 at spot and grows with size", () => {
    // spot = 1 ETH / 100 tokens = 0.01 ETH/token; effective exactly at spot → 0
    const flat = priceImpactPct({
      side: "buy",
      eth: 1,
      tokens: 100,
      virtualEth: 1,
      virtualToken: 100,
    });
    expect(flat).toBeCloseTo(0, 6);
    // effective 0.02 vs spot 0.01 → 100% impact
    const big = priceImpactPct({
      side: "buy",
      eth: 2,
      tokens: 100,
      virtualEth: 1,
      virtualToken: 100,
    });
    expect(big).toBeCloseTo(100, 6);
  });
  it("returns null on unusable inputs", () => {
    expect(
      priceImpactPct({ side: "buy", eth: 1, tokens: 0, virtualEth: 1, virtualToken: 1 }),
    ).toBeNull();
  });
});

describe("parseCurveReads — live Trust-panel reads (never cached API)", () => {
  it("parses the useReadContracts result array positionally", () => {
    const parsed = parseCurveReads([
      { status: "success", result: 10n ** 27n }, // totalSupply
      { status: "success", result: [1n, 2n, 3n, 4n] }, // reserves tuple
      { status: "success", result: 8076868822140981824n }, // GRADUATION_ETH
      { status: "success", result: 100 }, // TRADE_FEE_BPS (uint16 → number)
      { status: "success", result: 1_800_000_500n }, // EARLY_WINDOW_END
      { status: "success", result: 5n * 10n ** 17n }, // MAX_EARLY_BUY
    ]);
    expect(parsed.totalSupply).toBe(10n ** 27n);
    expect(parsed.reserves).toEqual({
      virtualEth: 1n,
      virtualToken: 2n,
      realEth: 3n,
      realToken: 4n,
    });
    expect(parsed.graduationEth).toBe(8076868822140981824n);
    expect(parsed.tradeFeeBps).toBe(100);
    expect(parsed.maxEarlyBuyWei).toBe(5n * 10n ** 17n);
  });

  it("degrades a single failed read to null (allowFailure) without nuking the rest", () => {
    const parsed = parseCurveReads([
      { status: "success", result: 10n ** 27n },
      { status: "failure" }, // reserves read reverted
      { status: "success", result: 1n },
      { status: "success", result: 100 },
      { status: "failure" },
      { status: "failure" },
    ]);
    expect(parsed.totalSupply).toBe(10n ** 27n);
    expect(parsed.reserves).toBeNull(); // NOT substituted with an API value
    expect(parsed.tradeFeeBps).toBe(100);
  });
});

describe("isInEarlyWindow — anti-sniper cap surfacing (§6.5)", () => {
  it("is true before the window end, false after", () => {
    const nowMs = 1_800_000_000_000;
    expect(isInEarlyWindow(1_800_000_100n, nowMs)).toBe(true);
    expect(isInEarlyWindow(1_799_999_900n, nowMs)).toBe(false);
    expect(isInEarlyWindow(null, nowMs)).toBe(false);
  });
});
