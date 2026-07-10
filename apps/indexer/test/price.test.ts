import { describe, expect, it } from "bun:test";
import { WETH_ADDRESS } from "@robbed/shared";
import { curvePriceEth, tokenIsToken0, v3PriceEth } from "../src/price";

const E = 10n ** 18n;
const Q96 = 1n << 96n;

describe("curvePriceEth — virtualEth / virtualToken (post-trade reserves)", () => {
  it("computes ETH-per-token as the reserve ratio", () => {
    expect(curvePriceEth(3n * E, 1n * E)).toBeCloseTo(3, 12);
    expect(curvePriceEth(1n * E, 4n * E)).toBeCloseTo(0.25, 12);
  });
  it("preserves precision for tiny prices (sub-1e-9)", () => {
    // 1 wei ETH virtual per 1e9 tokens → 1e-27 ... use a realistic small ratio.
    expect(curvePriceEth(1n * E, 1_000_000_000n * E)).toBeCloseTo(1e-9, 18);
  });
  it("guards divide-by-zero", () => {
    expect(curvePriceEth(1n * E, 0n)).toBe(0);
  });
});

describe("v3PriceEth — X-2 orientation (sqrtPriceX96 → WETH per token)", () => {
  // Choose sqrtPriceX96 for raw ratio = 4  → sqrt = 2 → sqrtPriceX96 = 2 * 2^96.
  const sqrt4 = 2n * Q96;

  it("token is token0 (token < WETH): raw ratio is WETH-per-token, used directly", () => {
    expect(v3PriceEth(sqrt4, true)).toBeCloseTo(4, 9);
  });
  it("token is token1 (token > WETH): raw ratio is token-per-WETH, inverted", () => {
    expect(v3PriceEth(sqrt4, false)).toBeCloseTo(0.25, 9);
  });
  it("inverting twice round-trips (orientation is the only difference)", () => {
    const asToken0 = v3PriceEth(sqrt4, true);
    const asToken1 = v3PriceEth(sqrt4, false);
    expect(asToken0 * asToken1).toBeCloseTo(1, 9);
  });
  it("guards zero sqrtPrice", () => {
    expect(v3PriceEth(0n, true)).toBe(0);
  });
});

describe("tokenIsToken0 — token < WETH address comparison", () => {
  it("is true when the token sorts below WETH", () => {
    expect(tokenIsToken0("0x" + "00".repeat(20), WETH_ADDRESS)).toBe(true);
  });
  it("is false when the token sorts above WETH", () => {
    expect(tokenIsToken0("0x" + "ff".repeat(20), WETH_ADDRESS)).toBe(false);
  });
});
