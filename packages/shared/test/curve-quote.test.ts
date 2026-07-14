/**
 * curve-quote vectors + normative properties (;
 * contracts.md). This is the TS side of the DUAL computation: it must agree
 * with CurveMath.sol byte-for-byte.
 *
 * Golden vectors: exact integer values, hand-derived from the constant-product
 * relation with the retained reserve rounded UP, and independently reproduced by
 * an in-test bigint reference ({@link refBuy}/{@link refSell}) written with a
 * DIFFERENT ceil expression than the module (`(n + d − 1) / d` here vs the
 * module's `ceilMulDiv`). Two independent bigint derivations agreeing pins the
 * arithmetic; the property blocks pin the CurveMath fuzz invariants (rounding
 * direction, k non-decreasing, no underflow) that makes normative. When
 * `forge` is wired into CI, add a fixture that diff's these against the Solidity
 * library output directly.
 */
import { describe, expect, it } from "bun:test";
import {
  CurveQuoteZeroReserveError,
  buyTokensOut,
  previewBuy,
  previewSell,
  sellEthOut,
} from "../src/curve-quote";

const ONE = 10n ** 18n;

/** Independent reference: ceil(vE·vT / (vE+e)) via a different expression. */
function refBuy(vE: bigint, vT: bigint, e: bigint): bigint {
  const n = vE * vT;
  const d = vE + e;
  const ceil = n % d === 0n ? n / d : n / d + 1n; // ceil, expressed differently
  return vT - ceil;
}
function refSell(vE: bigint, vT: bigint, t: bigint): bigint {
  const n = vE * vT;
  const d = vT + t;
  const ceil = n % d === 0n ? n / d : n / d + 1n;
  return vE - ceil;
}

// ── Golden vectors (exact literals — the frozen cross-check values) ──────────
interface BuyVec {
  name: string;
  vE: bigint;
  vT: bigint;
  e: bigint;
  out: bigint;
}
const BUY_VECTORS: BuyVec[] = [
  // k / (vE+e) divides evenly ⇒ ceil is a no-op ⇒ exact half of vT.
  { name: "even division (ceil no-op)", vE: ONE, vT: 10n ** 27n, e: ONE, out: 500000000000000000000000000n },
  // Tiny integers exercising the ceil branch: k=21, denom=8, ceil(21/8)=3, out=7−3=4.
  { name: "ceil branch, tiny ints", vE: 3n, vT: 7n, e: 5n, out: 4n },
  // Launch-scale (vT≈1.073e27), 1 ETH net in.
  { name: "launch-scale 1 ETH in", vE: 30n * ONE, vT: 1073000000n * ONE, e: ONE, out: 34612903225806451612903225n },
  // Zero in ⇒ zero out.
  { name: "zero net-in", vE: 30n * ONE, vT: 1073000000n * ONE, e: 0n, out: 0n },
];

describe("buyTokensOut — golden vectors match Solidity CurveMath.buyTokensOut", () => {
  for (const v of BUY_VECTORS) {
    it(v.name, () => {
      const got = buyTokensOut(v.vE, v.vT, v.e);
      expect(got).toBe(v.out); // frozen literal
      expect(got).toBe(refBuy(v.vE, v.vT, v.e)); // independent bigint derivation
    });
  }
});

describe("sellEthOut — golden vectors + symmetry with buy", () => {
  it("even division (ceil no-op): k=1e45, denom=2e18 ⇒ half of vE", () => {
    const got = sellEthOut(ONE, 10n ** 27n, 10n ** 27n);
    expect(got).toBe(500000000000000000n);
    expect(got).toBe(refSell(ONE, 10n ** 27n, 10n ** 27n));
  });
  it("ceil branch, tiny ints: vE=7,vT=3,t=5 ⇒ ceil(21/8)=3 ⇒ 4", () => {
    expect(sellEthOut(7n, 3n, 5n)).toBe(4n);
  });
  it("zero token-in ⇒ zero eth out", () => {
    expect(sellEthOut(30n * ONE, 1073000000n * ONE, 0n)).toBe(0n);
  });
});

describe("guard — zero reserve reverts (mirrors CurveMathZeroReserve)", () => {
  it("buyTokensOut throws on zero virtualEth / virtualToken", () => {
    expect(() => buyTokensOut(0n, ONE, ONE)).toThrow(CurveQuoteZeroReserveError);
    expect(() => buyTokensOut(ONE, 0n, ONE)).toThrow(CurveQuoteZeroReserveError);
  });
  it("sellEthOut throws on zero virtualEth / virtualToken", () => {
    expect(() => sellEthOut(0n, ONE, ONE)).toThrow(CurveQuoteZeroReserveError);
    expect(() => sellEthOut(ONE, 0n, ONE)).toThrow(CurveQuoteZeroReserveError);
  });
});

describe("normative properties (CurveMath fuzz invariants)", () => {
  // A spread of reserves/amounts covering small, launch-scale, and skewed ratios.
  const vEs = [ONE, 10n * ONE, 30n * ONE, 250n * ONE];
  const vTs = [1073000000n * ONE, 500000000n * ONE, 793100000n * ONE];
  const amts = [1n, ONE, 5n * ONE, 123456789n * 10n ** 9n, 40n * ONE];

  it("k is non-decreasing across a buy (retained reserve rounded up)", () => {
    for (const vE of vEs) for (const vT of vTs) for (const e of amts) {
      const out = buyTokensOut(vE, vT, e);
      const kBefore = vE * vT;
      const kAfter = (vE + e) * (vT - out);
      expect(kAfter).toBeGreaterThanOrEqual(kBefore);
    }
  });

  it("k is non-decreasing across a sell", () => {
    for (const vE of vEs) for (const vT of vTs) for (const t of amts) {
      const out = sellEthOut(vE, vT, t);
      const kBefore = vE * vT;
      const kAfter = (vE - out) * (vT + t);
      expect(kAfter).toBeGreaterThanOrEqual(kBefore);
    }
  });

  it("payout never exceeds the supplied-against reserve and is non-negative (no underflow)", () => {
    for (const vE of vEs) for (const vT of vTs) for (const a of amts) {
      const tOut = buyTokensOut(vE, vT, a);
      expect(tOut).toBeGreaterThanOrEqual(0n);
      expect(tOut).toBeLessThanOrEqual(vT);
      const eOut = sellEthOut(vE, vT, a);
      expect(eOut).toBeGreaterThanOrEqual(0n);
      expect(eOut).toBeLessThanOrEqual(vE);
    }
  });

  it("rounding always favors the curve: buy then immediate sell-back returns ≤ net-in", () => {
    for (const vE of vEs) for (const vT of vTs) for (const e of amts) {
      const out = buyTokensOut(vE, vT, e);
      if (out === 0n) continue;
      const back = sellEthOut(vE + e, vT - out, out);
      expect(back).toBeLessThanOrEqual(e); // error accrues to the curve
    }
  });
});

describe("previewBuy / previewSell — fee-inclusive display quotes (contracts.md)", () => {
  it("previewBuy takes the fee (floor) first, then prices the net on the curve", () => {
    const gross = 100n * ONE;
    const bps = 100; // 1% (CLAUDE.md trade fee)
    const p = previewBuy(30n * ONE, 1073000000n * ONE, gross, bps);
    expect(p.fee).toBe((gross * 100n) / 10000n); // 1 ETH
    expect(p.netEth).toBe(gross - p.fee); // 99 ETH
    expect(p.tokensOut).toBe(buyTokensOut(30n * ONE, 1073000000n * ONE, p.netEth));
  });

  it("fee is floored (curve-favoring) — odd wei rounds down", () => {
    // gross=12345 wei, bps=100 ⇒ 12345*100/10000 = 123.45 ⇒ floor 123.
    const p = previewBuy(ONE, 10n ** 27n, 12345n, 100);
    expect(p.fee).toBe(123n);
    expect(p.netEth).toBe(12222n);
  });

  it("previewSell prices the token leg first, then fees the gross ETH out", () => {
    const t = 10n ** 24n;
    const bps = 100;
    const p = previewSell(30n * ONE, 1073000000n * ONE, t, bps);
    expect(p.ethOutGross).toBe(sellEthOut(30n * ONE, 1073000000n * ONE, t));
    expect(p.fee).toBe((p.ethOutGross * 100n) / 10000n);
    expect(p.ethOut).toBe(p.ethOutGross - p.fee);
  });

  it("zero trade fee ⇒ net == gross (fee-free curve)", () => {
    const p = previewBuy(ONE, 10n ** 27n, ONE, 0);
    expect(p.fee).toBe(0n);
    expect(p.netEth).toBe(ONE);
  });
});
