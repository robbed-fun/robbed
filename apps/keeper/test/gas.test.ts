import { describe, expect, test } from "bun:test";
import { DEFAULT_GAS_CAP, gasWithBuffer } from "../src/gas";

describe("gasWithBuffer (estimate*2 capped at 30M)", () => {
  test("doubles a normal estimate", () => {
    expect(gasWithBuffer(1_000_000n)).toBe(2_000_000n);
    expect(gasWithBuffer(817_845n)).toBe(1_635_690n); // fork worst-case
  });

  test("clamps to the cap instead of overflowing it", () => {
    // 20M*2 = 40M would exceed the block-safe cap → clamp to 30M, NOT 40M.
    expect(gasWithBuffer(20_000_000n)).toBe(DEFAULT_GAS_CAP);
    expect(gasWithBuffer(20_000_000n)).toBe(30_000_000n);
  });

  test("exactly at the cap boundary returns the cap", () => {
    expect(gasWithBuffer(15_000_000n)).toBe(30_000_000n); // 2x == cap
    expect(gasWithBuffer(14_999_999n)).toBe(29_999_998n); // just under
  });

  test("respects a custom cap", () => {
    expect(gasWithBuffer(1_000_000n, 5_000_000n)).toBe(2_000_000n);
    expect(gasWithBuffer(4_000_000n, 5_000_000n)).toBe(5_000_000n); // 8M clamps to 5M
  });

  test("rejects a non-positive estimate (never a zero-gas send)", () => {
    expect(() => gasWithBuffer(0n)).toThrow();
    expect(() => gasWithBuffer(-1n)).toThrow();
  });
});
