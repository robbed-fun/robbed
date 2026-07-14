/**
 * External third-party ABI freeze + drift tests (Uniswap v3 periphery +
 * Chainlink AggregatorV3Interface).
 *
 * These ABIs are transcribed VERBATIM from the pinned official artifacts
 * (src/abi/QuoterV2.json / SwapRouter02.json / AggregatorV3Interface.json).
 * The two assertions here make the two failure modes impossible:
 *  1. const ↔ JSON drift — the exported `as const` copy must deep-equal the JSON
 *     artifact (so hand-edits to either are caught).
 *  2. surface drift — the exact function set the services wire (M3-5 post-grad
 * routing; ETH/USD poller) is frozen; adding/removing one is a
 *     deliberate change, not silent.
 */
import { describe, expect, it } from "bun:test";
import { toFunctionSelector, toFunctionSignature, type AbiFunction } from "viem";
import { aggregatorV3Abi, quoterV2Abi, swapRouter02Abi } from "../src/abi/external";
import aggregatorV3Json from "../src/abi/AggregatorV3Interface.json";
import quoterV2Json from "../src/abi/QuoterV2.json";
import swapRouter02Json from "../src/abi/SwapRouter02.json";

/** Canonical solidity function signature (expands tuple components). */
function sigOf(fn: AbiFunction): string {
  return toFunctionSignature(fn);
}

/** const ABI as a plain AbiFunction[] (the const tuple type is too deep to filter). */
const quoterFns = quoterV2Abi as unknown as AbiFunction[];
const routerFns = swapRouter02Abi as unknown as AbiFunction[];
const aggregatorFns = aggregatorV3Abi as unknown as AbiFunction[];

describe("external ABIs are byte-identical to the pinned JSON artifacts", () => {
  it("quoterV2Abi === QuoterV2.json", () => {
    expect(quoterV2Abi as unknown).toEqual(quoterV2Json as unknown);
  });
  it("swapRouter02Abi === SwapRouter02.json", () => {
    expect(swapRouter02Abi as unknown).toEqual(swapRouter02Json as unknown);
  });
  it("aggregatorV3Abi === AggregatorV3Interface.json", () => {
    expect(aggregatorV3Abi as unknown).toEqual(aggregatorV3Json as unknown);
  });
});

describe("AggregatorV3Interface — the ETH/USD poller read surface", () => {
  const fns = aggregatorFns.filter((x) => x.type === "function");
  it("exposes exactly the three views (frozen — adopted from the indexer local copy)", () => {
    expect(fns.map(sigOf).sort()).toEqual(["decimals()", "description()", "latestRoundData()"]);
    for (const fn of fns) expect(fn.stateMutability).toBe("view");
  });
  it("latestRoundData returns the canonical 5-tuple (answer + updatedAt drive the staleness check)", () => {
    const fn = fns.find((f) => f.name === "latestRoundData")!;
    expect(fn.outputs.map((o) => `${o.type} ${o.name}`)).toEqual([
      "uint80 roundId",
      "int256 answer",
      "uint256 startedAt",
      "uint256 updatedAt",
      "uint80 answeredInRound",
    ]);
  });
  it("selectors are the canonical Chainlink AggregatorV3Interface selectors", () => {
    const bySig = Object.fromEntries(fns.map((f) => [sigOf(f), toFunctionSelector(f)]));
    expect(bySig["decimals()"]).toBe("0x313ce567");
    expect(bySig["description()"]).toBe("0x7284e416");
    expect(bySig["latestRoundData()"]).toBe("0xfeaf968c");
  });
});

describe("QuoterV2 — the two single-hop preview reads (M3-6 launch preview mirror + pre/post-grad quote)", () => {
  const fns = quoterFns.filter((x) => x.type === "function");
  it("exposes exactly quoteExactInputSingle + quoteExactOutputSingle", () => {
    expect(fns.map((f) => f.name).sort()).toEqual([
      "quoteExactInputSingle",
      "quoteExactOutputSingle",
    ]);
  });
  it("quoteExactInputSingle takes the QuoteExactInputSingleParams tuple", () => {
    const fn = fns.find((f) => f.name === "quoteExactInputSingle")!;
    expect(sigOf(fn)).toBe(
      "quoteExactInputSingle((address,address,uint256,uint24,uint160))",
    );
    // returns amountOut first (the value the preview reads).
    expect(fn.outputs.map((o) => o.name)).toEqual([
      "amountOut",
      "sqrtPriceX96After",
      "initializedTicksCrossed",
      "gasEstimate",
    ]);
  });
  it("quote functions are non-view (revert-based quoter — called via eth_call/simulate)", () => {
    for (const fn of fns) expect(fn.stateMutability).toBe("nonpayable");
  });
});

describe("SwapRouter02 — single-hop swaps + native-ETH toolkit (M3-5 post-grad routing)", () => {
  const fns = routerFns.filter((x) => x.type === "function");
  it("exposes exactly the frozen swap surface", () => {
    expect(fns.map(sigOf).sort()).toEqual(
      [
        "WETH9()",
        "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
        "exactOutputSingle((address,address,uint24,address,uint256,uint256,uint160))",
        "multicall(bytes[])",
        "multicall(uint256,bytes[])",
        "refundETH()",
        "unwrapWETH9(uint256,address)",
      ].sort(),
    );
  });
  it("exactInputSingle is payable (accepts native ETH for the WETH leg) and returns amountOut", () => {
    const fn = fns.find((f) => f.name === "exactInputSingle")!;
    expect(fn.stateMutability).toBe("payable");
    expect(fn.outputs.map((o) => o.name)).toEqual(["amountOut"]);
  });
  it("selectors are the canonical Uniswap SwapRouter02 selectors (well-known, stable)", () => {
    const bySig = Object.fromEntries(fns.map((f) => [sigOf(f), toFunctionSelector(f)]));
    // exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
    expect(bySig["exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))"]).toBe(
      "0x04e45aaf",
    );
    // unwrapWETH9(uint256,address)
    expect(bySig["unwrapWETH9(uint256,address)"]).toBe("0x49404b7c");
  });
});
