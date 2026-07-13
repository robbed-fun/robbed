import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FaucetCta rendering on a TESTNET-target build (46630) + precedence with the
 * wrong-network banner. The chain module is mocked to the testnet target
 * (unit-scoped equivalent of NEXT_PUBLIC_CHAIN_ID=46630 — the real env-driven
 * flip is proven in chain.test.ts; jsdom suites cannot re-import the module
 * graph per test without tearing down React, so the seam is mocked here).
 */

const TESTNET_ID = 46630;
const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

vi.mock("@/shared/lib/chain", () => ({
  robinhoodChain: {
    id: 46630,
    name: "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.test.invalid"] } },
    blockExplorers: {
      default: { name: "Blockscout", url: "https://explorer.test.invalid" },
    },
  },
  explorer: {
    tx: (h: string) => `https://explorer.test.invalid/tx/${h}`,
    address: (a: string) => `https://explorer.test.invalid/address/${a}`,
    token: (a: string) => `https://explorer.test.invalid/token/${a}`,
  },
}));

type Acct = {
  address?: `0x${string}`;
  isConnected: boolean;
  chainId?: number;
  connector?: { uid: string };
};
const acct: { value: Acct } = { value: { isConnected: false } };
const balance = { value: undefined as { value: bigint } | undefined };
const switchChainMock = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => acct.value,
  useBalance: () => ({ data: balance.value }),
  useSwitchChain: () => ({
    switchChain: switchChainMock,
    reset: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

import { FaucetCta } from "@/features/get-testnet-eth";
import { NetworkBanner } from "@/widgets/network-banner";

beforeEach(() => {
  acct.value = { isConnected: true, chainId: TESTNET_ID, address: ADDR, connector: { uid: "inj" } };
  balance.value = { value: 0n };
  switchChainMock.mockClear();
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

describe("FaucetCta — zero-balance testnet onboarding", () => {
  it("0 ETH on the testnet target → CTA with the address-prefilled official link", () => {
    render(<FaucetCta />);
    expect(screen.getByTestId("faucet-cta")).toBeTruthy();

    const official = screen.getByRole("link", { name: /Get testnet ETH/ });
    expect(official.getAttribute("href")).toBe(
      `https://faucet.testnet.chain.robinhood.com/?address=${ADDR}`,
    );
    // ERR-12: external links open in a new tab with noopener.
    expect(official.getAttribute("target")).toBe("_blank");
    expect(official.getAttribute("rel")).toContain("noopener");

    // Verified fallbacks (runbook §3) render as secondary links.
    expect(
      screen.getByRole("link", { name: /Chainlink faucet/ }).getAttribute("href"),
    ).toBe("https://faucets.chain.link/robinhood-testnet");
    expect(
      screen.getByRole("link", { name: /QuickNode faucet/ }).getAttribute("href"),
    ).toBe("https://faucet.quicknode.com/robinhood/testnet");
  });

  it("non-zero balance → nothing", () => {
    balance.value = { value: 1n };
    const { container } = render(<FaucetCta />);
    expect(container.firstChild).toBeNull();
  });

  it("balance still loading → nothing (never assumes zero)", () => {
    balance.value = undefined;
    const { container } = render(<FaucetCta />);
    expect(container.firstChild).toBeNull();
  });

  it("dismiss hides it and persists for the session (not per render)", () => {
    const { container } = render(<FaucetCta />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(container.firstChild).toBeNull();
    expect(window.sessionStorage.getItem("robbed:faucet-cta-dismissed")).toBe("1");

    // A fresh mount in the same session stays hidden.
    cleanup();
    const second = render(<FaucetCta />);
    expect(second.container.firstChild).toBeNull();
  });

  it("wrong network outranks the faucet: mismatch + 0 balance → switch banner only", () => {
    acct.value = { isConnected: true, chainId: 4663, address: ADDR, connector: { uid: "inj" } };
    render(<NetworkBanner />);
    expect(screen.getByRole("alert").textContent).toContain("Robinhood Chain Testnet");
    expect(screen.queryByTestId("faucet-cta")).toBeNull();
    // The auto-switch targeted the testnet chain.
    expect(switchChainMock).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: TESTNET_ID }),
    );
  });
});
