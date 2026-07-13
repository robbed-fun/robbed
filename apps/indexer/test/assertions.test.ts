import { describe, expect, it } from "bun:test";
import { WETH_ADDRESS } from "@robbed/shared";
import { assertStaticConfig } from "../src/assertions";
import type { IndexerConfig } from "../src/config";

const ZERO = "0x0000000000000000000000000000000000000000";

function validConfig(): IndexerConfig {
  return {
    chainId: 4663,
    rpcHttp: "http://localhost:8545",
    rpcWs: undefined,
    startBlock: 0,
    weth: WETH_ADDRESS.toLowerCase(),
    curveFactory: "0x" + "11".repeat(20),
    router: undefined,
    migrator: "0x" + "22".repeat(20),
    creatorVault: undefined, // §12.63 optional — absent on v1 deployments
    lpFeeVault: "0x" + "66".repeat(20), // §12.69 — always resolved from the registry
    v3Factory: "0x" + "33".repeat(20),
    v3PositionManager: "0x" + "44".repeat(20),
    swapRouter02: "0x" + "55".repeat(20),
    redisUrl: undefined,
    databaseUrl: undefined,
    databaseSchema: undefined,
    r2MetadataBaseUrl: undefined,
    metadataFetchRewrite: undefined,
    treasury: undefined,
  };
}

describe("assertStaticConfig — fail-closed startup gate (indexer.md §2, §12.55(b) static half)", () => {
  it("passes a valid config", () => {
    expect(() => assertStaticConfig(validConfig())).not.toThrow();
  });

  it("rejects a chain id with no shared-registry entry (§12.55(b) — no default, no invention)", () => {
    const c = validConfig();
    c.chainId = 1; // mainnet Ethereum — never a robbed deployment
    expect(() => assertStaticConfig(c)).toThrow(/registry/);
  });

  it("accepts every recorded registry chain id (4663 / 31337 / 46630)", () => {
    for (const id of [4663, 31337, 46630]) {
      const c = validConfig();
      c.chainId = id;
      expect(() => assertStaticConfig(c)).not.toThrow();
    }
  });

  it("rejects a zero WETH address", () => {
    const c = validConfig();
    c.weth = ZERO;
    expect(() => assertStaticConfig(c)).toThrow(/WETH/);
  });

  it("rejects a zero V3 factory address", () => {
    const c = validConfig();
    c.v3Factory = ZERO;
    expect(() => assertStaticConfig(c)).toThrow(/V3_FACTORY/);
  });

  it("rejects a zero V3 NPM address", () => {
    const c = validConfig();
    c.v3PositionManager = ZERO;
    expect(() => assertStaticConfig(c)).toThrow(/V3_NPM/);
  });

  it("rejects a zero SwapRouter02 address", () => {
    const c = validConfig();
    c.swapRouter02 = ZERO;
    expect(() => assertStaticConfig(c)).toThrow(/SWAP_ROUTER02/);
  });
});
