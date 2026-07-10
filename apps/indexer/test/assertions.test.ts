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
    v3Factory: "0x" + "33".repeat(20),
    v3PositionManager: "0x" + "44".repeat(20),
    redisUrl: undefined,
    databaseUrl: undefined,
    databaseSchema: undefined,
    r2MetadataBaseUrl: undefined,
    treasury: undefined,
  };
}

describe("assertStaticConfig — fail-closed startup gate (indexer.md §2)", () => {
  it("passes a valid config", () => {
    expect(() => assertStaticConfig(validConfig())).not.toThrow();
  });

  it("rejects a WETH that is not the canonical constant", () => {
    const c = validConfig();
    c.weth = "0x" + "ab".repeat(20);
    expect(() => assertStaticConfig(c)).toThrow(/WETH/);
  });

  it("rejects a chain id that is not 4663", () => {
    const c = validConfig();
    c.chainId = 1;
    expect(() => assertStaticConfig(c)).toThrow(/4663/);
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
});
