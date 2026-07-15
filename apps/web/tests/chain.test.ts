import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAIN_ID, WETH_ADDRESS } from "@robbed/shared";
import { getDeployment } from "@robbed/shared/addresses";

import { explorer, robinhoodChain } from "@/shared/lib/chain";

/**
 * Chain config invariants (CLAUDE.md). Default build target
 * = mainnet 4663 (ETH gas / Blockscout / WETH from the shared registry); a
 * per-target build env-selects ONE other registered chain (46630 testnet) and
 * the whole chain object flips to the OFFICIAL testnet params — this is what
 * wallets receive via wallet_addEthereumChain (wagmi injected-connector
 * fallback builds the add-chain proposal from this object; verified against
 * the installed wagmi 2.18.0 source, 2026-07-12).
 */
describe("robinhoodChain (default target = mainnet 4663)", () => {
  it("is chain 4663 with ETH gas", () => {
    expect(robinhoodChain.id).toBe(CHAIN_ID);
    expect(robinhoodChain.id).toBe(4663);
    expect(robinhoodChain.nativeCurrency.symbol).toBe("ETH");
    expect(robinhoodChain.nativeCurrency.decimals).toBe(18);
  });

  it("uses the Blockscout explorer", () => {
    expect(robinhoodChain.blockExplorers?.default.url).toBe(
      "https://robinhoodchain.blockscout.com",
    );
  });

  it("sources WETH from the shared registry (matches the shared constant, no inline literal)", () => {
    expect(robinhoodChain.contracts?.weth9?.address).toBe(getDeployment(4663)?.external.weth);
    expect(robinhoodChain.contracts?.weth9?.address).toBe(WETH_ADDRESS);
  });

  it("reads the RPC endpoint from env, not a hardcoded URL", () => {
    expect(robinhoodChain.rpcUrls.default.http[0]).toBe("https://rpc.test.invalid");
  });

  it("builds Blockscout links without ever using block.number", () => {
    expect(explorer.tx("0xabc")).toBe("https://robinhoodchain.blockscout.com/tx/0xabc");
    expect(explorer.address(WETH_ADDRESS)).toContain("/address/");
    expect(explorer.token(WETH_ADDRESS)).toBe(explorer.address(WETH_ADDRESS));
  });
});

/**
 * env-selected target: NEXT_PUBLIC_CHAIN_ID SELECTS a chain, the shared
 * registry DEFINES it. The 46630 (testnet) selection must flip id, name,
 * explorer, WETH and every robbed/V3 address to the 46630 registry entry —
 * this is the fix for the :4100 testnet stack advertising 4663 to wallets.
 * Modules capture the target at import scope, so each case re-imports after
 * `vi.resetModules()` with the env stubbed.
 */
describe("env-selected chain target ", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("NEXT_PUBLIC_CHAIN_ID=46630 → official testnet chain object", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "46630");
    vi.resetModules();
    const { robinhoodChain: testnet } = await import("@/shared/lib/chain");
    const dep = getDeployment(46630);
    expect(testnet.id).toBe(46630);
    // Official params — docs/developers/runbooks/testnet.md (docs.robinhood.com).
    expect(testnet.name).toBe("Robinhood Chain Testnet");
    expect(testnet.blockExplorers?.default.url).toBe(
      "https://explorer.testnet.chain.robinhood.com",
    );
    expect(testnet.nativeCurrency.symbol).toBe("ETH");
    // WETH = the 46630 registry entry, NOT mainnet's.
    expect(testnet.contracts?.weth9?.address).toBe(dep?.external.weth);
    expect(testnet.contracts?.weth9?.address).not.toBe(WETH_ADDRESS);
    // RPC still env-driven (the compose injects the official testnet RPC).
    expect(testnet.rpcUrls.default.http[0]).toBe("https://rpc.test.invalid");
  });

  it("addresses module resolves the 46630 registry entry (robbed + V3 + WETH)", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "46630");
    vi.resetModules();
    const { ROBBED, V3, WETH } = await import("@/shared/config/addresses");
    const dep = getDeployment(46630);
    expect(dep).toBeDefined();
    expect(ROBBED.router).toBe(dep?.robbed.router);
    expect(ROBBED.curveFactory).toBe(dep?.robbed.curveFactory);
    expect(ROBBED.treasury).toBe(dep?.robbed.treasury);
    expect(V3.quoterV2).toBe(dep?.external.quoterV2);
    expect(V3.swapRouter02).toBe(dep?.external.swapRouter02);
    expect(WETH).toBe(dep?.external.weth);
  });

  it("a chain id with no registry entry fails the import loud (nothing invented via env)", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "1");
    vi.resetModules();
    await expect(import("@/shared/lib/chain")).rejects.toThrow(
      /no entry in the shared deployment registry/,
    );
  });

  it("a registry chain WITHOUT official web facts (31337 local) fails loud too", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "31337");
    vi.resetModules();
    await expect(import("@/shared/lib/chain")).rejects.toThrow(/no official chain facts/);
  });
});

describe("env.chainId (call-time read)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("unset → compile-time mainnet CHAIN_ID", async () => {
    const { env } = await import("@/shared/lib/env");
    expect(env.chainId()).toBe(CHAIN_ID);
  });

  it("46630 → 46630 (registry member)", async () => {
    const { env } = await import("@/shared/lib/env");
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "46630");
    expect(env.chainId()).toBe(46630);
  });

  it("garbage → throws (never a silent fallback)", async () => {
    const { env } = await import("@/shared/lib/env");
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "not-a-chain");
    expect(() => env.chainId()).toThrow(/shared deployment registry/);
  });
});
