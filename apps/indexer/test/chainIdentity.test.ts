/**
 * chain-identity gate — the ratified multi-env mechanism, exercised
 * end-to-end at the unit level:
 *   (a) INDEXER_CHAIN_ID selects, never defines — must resolve in the shared
 *       deployment registry; NO default chain id exists.
 *   (b) double fail-closed: registry membership (static, loadConfig/
 *       assertStaticConfig) + live eth_chainId equality (assertRuntime).
 *   (c) chain-dependent addresses resolve from the registry entry (external
 *       set registry-ONLY; robbed contracts = live deploy artifact env wins,
 *       registry fills otherwise).
 *   4663 fork/live split: fork artifacts are refused without the LOCAL-fork opt-in
 *       (INDEXER_ALLOW_FORK_4663=1); live artifacts are allowed.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDeployment } from "@robbed/shared/addresses";
import { loadConfig } from "../src/config";
import { assertRuntime, type ChainIdReadable, type SqlQueryable } from "../src/assertions";

const TOUCHED = [
  "INDEXER_CHAIN_ID",
  "INDEXER_ALLOW_FORK_4663",
  "INDEXER_RPC_HTTP",
  "CURVE_FACTORY_ADDRESS",
  "ROUTER_ADDRESS",
  "MIGRATOR_ADDRESS",
  "TREASURY_ADDRESS",
  "METADATA_FETCH_REWRITE_FROM",
  "METADATA_FETCH_REWRITE_TO",
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of TOUCHED) saved.set(k, process.env[k]);
  for (const k of TOUCHED) delete process.env[k];
  process.env.INDEXER_RPC_HTTP = "http://localhost:8545";
});

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
});

describe("+(b) static half — explicit selection, registry-validated, no default", () => {
  it("throws when INDEXER_CHAIN_ID is unset (no default chain id exists)", () => {
    expect(() => loadConfig()).toThrow(/INDEXER_CHAIN_ID/);
  });

  it("throws when INDEXER_CHAIN_ID is not an integer", () => {
    process.env.INDEXER_CHAIN_ID = "mainnet";
    expect(() => loadConfig()).toThrow(/positive integer/);
  });

  it("throws when the selected chain has no registry entry (env cannot invent a chain)", () => {
    process.env.INDEXER_CHAIN_ID = "1";
    expect(() => loadConfig()).toThrow(/no entry in the shared deployment registry/);
  });
});

describe("4663 fork/live split", () => {
  it("accepts INDEXER_CHAIN_ID=4663 without the LOCAL-fork opt-in when the registry entry is live", () => {
    process.env.INDEXER_CHAIN_ID = "4663";
    expect(getDeployment(4663)!.mode).toBe("live");
    expect(() => loadConfig()).not.toThrow();
  });

  it("refuses a 4663 fork artifact without the LOCAL-fork opt-in", () => {
    process.env.INDEXER_CHAIN_ID = "4663";
    const deployment = getDeployment(4663)! as { mode: string };
    const savedMode = deployment.mode;
    deployment.mode = "fork";
    try {
      expect(() => loadConfig()).toThrow(/mainnet-fork pipeline artifact/);
    } finally {
      deployment.mode = savedMode;
    }
  });

  it("accepts a 4663 fork artifact when the LOCAL fork stack declares itself", () => {
    process.env.INDEXER_CHAIN_ID = "4663";
    process.env.INDEXER_ALLOW_FORK_4663 = "1";
    const deployment = getDeployment(4663)! as { mode: string };
    const savedMode = deployment.mode;
    deployment.mode = "fork";
    try {
      expect(() => loadConfig()).not.toThrow();
    } finally {
      deployment.mode = savedMode;
    }
  });

  it("does not require the opt-in for non-4663 chains", () => {
    process.env.INDEXER_CHAIN_ID = "46630";
    expect(() => loadConfig()).not.toThrow();
  });
});

describe(" — chain-dependent addresses resolve from the registry entry", () => {
  it("46630 resolves the TESTNET external set (never the mainnet constants)", () => {
    process.env.INDEXER_CHAIN_ID = "46630";
    const config = loadConfig();
    const entry = getDeployment(46630)!;
    expect(config.weth).toBe(entry.external.weth.toLowerCase());
    expect(config.v3Factory).toBe(entry.external.v3Factory.toLowerCase());
    expect(config.v3PositionManager).toBe(entry.external.positionManager.toLowerCase());
    expect(config.swapRouter02).toBe(entry.external.swapRouter02.toLowerCase());
    // Cross-chain leak check: none of these equal the 4663 entry's values.
    const mainnet = getDeployment(4663)!;
    expect(config.weth).not.toBe(mainnet.external.weth.toLowerCase());
    expect(config.v3Factory).not.toBe(mainnet.external.v3Factory.toLowerCase());
  });

  it("robbed contracts fill from the registry when no artifact env is injected", () => {
    process.env.INDEXER_CHAIN_ID = "46630";
    const config = loadConfig();
    const entry = getDeployment(46630)!;
    expect(config.curveFactory).toBe(entry.robbed.curveFactory.toLowerCase());
    expect(config.router).toBe(entry.robbed.router.toLowerCase());
    expect(config.migrator).toBe(entry.robbed.v3Migrator.toLowerCase());
    expect(config.treasury).toBe(entry.robbed.treasury.toLowerCase());
  });

  it("live deploy artifact env (local.env/testnet.env injection) wins over the registry snapshot", () => {
    process.env.INDEXER_CHAIN_ID = "46630";
    process.env.CURVE_FACTORY_ADDRESS = "0x" + "aa".repeat(20);
    const config = loadConfig();
    expect(config.curveFactory).toBe("0x" + "aa".repeat(20));
    // Untouched fields still come from the registry.
    expect(config.migrator).toBe(getDeployment(46630)!.robbed.v3Migrator.toLowerCase());
  });

  it("rejects a malformed artifact env value (fail-closed, not silently ignored)", () => {
    process.env.INDEXER_CHAIN_ID = "46630";
    process.env.CURVE_FACTORY_ADDRESS = "not-an-address";
    expect(() => loadConfig()).toThrow(/not a 20-byte address/);
  });
});

describe(" live half — assertRuntime(expected chain id)", () => {
  const okDb: SqlQueryable = {
    query: async () => ({ rows: [{ ok: 1 }] }),
  };
  const rpcReturning = (id: number): ChainIdReadable => ({ getChainId: async () => id });

  it("passes when the live RPC serves the selected chain", async () => {
    await expect(assertRuntime(okDb, rpcReturning(46630), 46630)).resolves.toBeUndefined();
  });

  it("throws when the live RPC serves a different chain (wrong/mistyped RPC)", async () => {
    await expect(assertRuntime(okDb, rpcReturning(4663), 46630)).rejects.toThrow(
      /RPC chain id is 4663, expected INDEXER_CHAIN_ID=46630/,
    );
  });

  it("still throws on a missing pg_trgm extension", async () => {
    const noExt: SqlQueryable = { query: async () => ({ rows: [] }) };
    await expect(assertRuntime(noExt, rpcReturning(46630), 46630)).rejects.toThrow(/pg_trgm/);
  });
});
