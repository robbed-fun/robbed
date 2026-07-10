/**
 * loadConfig — the curve-constant env interim is gone (§12.40d, M2-4b).
 *
 * The four curve-constant env vars (CURVE_SUPPLY_WEI &c.) are no longer read;
 * curve immutables are read per-curve at TokenCreated. This asserts the indexer
 * boots (config loads + passes the static gate) with NONE of them set.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { WETH_ADDRESS } from "@robbed/shared";
import { loadConfig } from "../src/config";
import { assertStaticConfig } from "../src/assertions";

const CURVE_ENV = [
  "CURVE_SUPPLY_WEI",
  "INITIAL_VIRTUAL_ETH_WEI",
  "INITIAL_VIRTUAL_TOKEN_WEI",
  "GRADUATION_ETH_WEI",
] as const;

const TOUCHED = [
  "INDEXER_RPC_HTTP",
  "INDEXER_RPC_WS",
  "CURVE_FACTORY_ADDRESS",
  "MIGRATOR_ADDRESS",
  "V3_FACTORY_ADDRESS",
  "V3_NPM_ADDRESS",
  "START_BLOCK",
  ...CURVE_ENV,
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of TOUCHED) saved.set(k, process.env[k]);
  // Minimal REQUIRED non-curve env for a successful boot.
  process.env.INDEXER_RPC_HTTP = "http://localhost:8545";
  process.env.CURVE_FACTORY_ADDRESS = "0x" + "11".repeat(20);
  process.env.MIGRATOR_ADDRESS = "0x" + "22".repeat(20);
  // Explicitly UNSET every curve-constant var — the point of the test.
  for (const k of CURVE_ENV) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
});

describe("loadConfig — no curve-constant env vars (§12.40d)", () => {
  it("boots (loads + passes the static gate) with all curve env vars unset", () => {
    let config!: ReturnType<typeof loadConfig>;
    expect(() => {
      config = loadConfig();
    }).not.toThrow();
    expect(() => assertStaticConfig(config)).not.toThrow();
  });

  it("carries no `curve` constants field on the config object", () => {
    const config = loadConfig();
    expect((config as unknown as Record<string, unknown>).curve).toBeUndefined();
    // Sanity: the non-curve required fields still resolve.
    expect(config.chainId).toBe(4663);
    expect(config.weth).toBe(WETH_ADDRESS.toLowerCase());
    expect(config.curveFactory).toBe("0x" + "11".repeat(20));
  });

  it("ignores curve-constant env vars even when present (no longer read)", () => {
    process.env.CURVE_SUPPLY_WEI = "0"; // would have been rejected by the old interim
    expect(() => assertStaticConfig(loadConfig())).not.toThrow();
  });
});
