import { describe, expect, it } from "vitest";

import {
  buildFaucetUrl,
  faucetsFor,
  shouldShowFaucetCta,
} from "@/features/get-testnet-eth";

/**
 * Faucet CTA config + pure trigger logic (features/get-testnet-eth).
 * - faucetsFor: testnet-registry-gated — official URLs (/ runbook
 * +) surface ONLY for a registered mode="testnet" chain; mainnet/local
 *   unknown chains get null (no invented faucets, never shown off-testnet).
 * - buildFaucetUrl: the official faucet's `?address=` prefill deep link.
 * - shouldShowFaucetCta: zero-balance trigger with wrong-network precedence.
 */
describe("faucetsFor — testnet-target-only resolution", () => {
  it("46630 (registry mode=testnet) → the official faucet set", () => {
    const f = faucetsFor(46630);
    expect(f).not.toBeNull();
    expect(f?.official).toBe("https://faucet.testnet.chain.robinhood.com");
    expect(f?.fallbacks.map((x) => x.url)).toEqual([
      "https://faucets.chain.link/robinhood-testnet",
      "https://faucet.quicknode.com/robinhood/testnet",
    ]);
  });

  it("mainnet 4663 (mode=live) → null (faucet never shows on mainnet)", () => {
    expect(faucetsFor(4663)).toBeNull();
  });

  it("local 31337 (mode=local) → null", () => {
    expect(faucetsFor(31337)).toBeNull();
  });

  it("unregistered chain → null", () => {
    expect(faucetsFor(1)).toBeNull();
  });
});

describe("buildFaucetUrl — address prefill deep link", () => {
  const OFFICIAL = "https://faucet.testnet.chain.robinhood.com";
  const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  it("carries the connected address as ?address=", () => {
    const url = buildFaucetUrl(OFFICIAL, ADDR);
    expect(url).toBe(`https://faucet.testnet.chain.robinhood.com/?address=${ADDR}`);
    expect(new URL(url).searchParams.get("address")).toBe(ADDR);
  });

  it("no address → bare official URL", () => {
    expect(new URL(buildFaucetUrl(OFFICIAL)).searchParams.get("address")).toBeNull();
  });
});

describe("shouldShowFaucetCta — zero-balance trigger", () => {
  const base = {
    faucets: faucetsFor(46630),
    isConnected: true,
    walletChainId: 46630,
    targetChainId: 46630,
    balanceWei: 0n as bigint | undefined,
    dismissed: false,
  };

  it("connected on target with 0 balance → shows", () => {
    expect(shouldShowFaucetCta(base)).toBe(true);
  });

  it("non-zero balance → hidden", () => {
    expect(shouldShowFaucetCta({ ...base, balanceWei: 1n })).toBe(false);
  });

  it("balance not yet loaded (undefined) → hidden (never guesses zero)", () => {
    expect(shouldShowFaucetCta({ ...base, balanceWei: undefined })).toBe(false);
  });

  it("wrong network takes precedence → hidden even at 0 balance", () => {
    expect(shouldShowFaucetCta({ ...base, walletChainId: 4663 })).toBe(false);
  });

  it("disconnected → hidden", () => {
    expect(shouldShowFaucetCta({ ...base, isConnected: false })).toBe(false);
  });

  it("dismissed this session → hidden", () => {
    expect(shouldShowFaucetCta({ ...base, dismissed: true })).toBe(false);
  });

  it("no faucet config (non-testnet target) → hidden", () => {
    expect(shouldShowFaucetCta({ ...base, faucets: null })).toBe(false);
  });
});
