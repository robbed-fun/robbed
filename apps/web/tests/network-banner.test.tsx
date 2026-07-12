import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wrong-network popup + auto-switch (features/switch-network via
 * widgets/network-banner). Invariants under test:
 *   - match (wallet on target) → NOTHING renders, no switch request;
 *   - mismatch → banner renders AND exactly ONE automatic switchChain
 *     ({ chainId: target }) fires, stable across re-renders (no popup loop);
 *   - rejection (error) → declined copy + manual "Switch network" button,
 *     which resets and re-requests;
 *   - pending → wallet-confirm copy, no button.
 * Target chain in this suite = the default build target 4663 (vitest env has
 * no NEXT_PUBLIC_CHAIN_ID); the 46630 target is covered by chain.test.ts.
 */

type Acct = {
  address?: `0x${string}`;
  isConnected: boolean;
  chainId?: number;
  connector?: { uid: string };
};
const acct: { value: Acct } = { value: { isConnected: false } };
const switchState = { isPending: false, error: null as Error | null };
const switchChainMock = vi.fn();
const resetMock = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => acct.value,
  useSwitchChain: () => ({
    switchChain: switchChainMock,
    reset: resetMock,
    isPending: switchState.isPending,
    error: switchState.error,
  }),
  // FaucetCta leg: never eligible here (mainnet target has no faucet config).
  useBalance: () => ({ data: undefined }),
}));

import { NetworkBanner } from "@/widgets/network-banner";

const TARGET_ID = 4663; // default build target (see header note)

beforeEach(() => {
  acct.value = { isConnected: false };
  switchState.isPending = false;
  switchState.error = null;
  switchChainMock.mockClear();
  resetMock.mockClear();
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

describe("wrong-network banner + auto-switch", () => {
  it("disconnected → renders nothing, no switch request", () => {
    const { container } = render(<NetworkBanner />);
    expect(container.firstChild).toBeNull();
    expect(switchChainMock).not.toHaveBeenCalled();
  });

  it("connected on the target chain → renders nothing, no switch request", () => {
    acct.value = {
      isConnected: true,
      chainId: TARGET_ID,
      connector: { uid: "inj-1" },
    };
    const { container } = render(<NetworkBanner />);
    expect(container.firstChild).toBeNull();
    expect(switchChainMock).not.toHaveBeenCalled();
  });

  it("mismatch → banner renders and auto-switch fires exactly once", () => {
    acct.value = { isConnected: true, chainId: 1, connector: { uid: "inj-1" } };
    const { rerender } = render(<NetworkBanner />);

    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("Wallet is on chain 1");
    expect(banner.textContent).toContain("Robinhood Chain");
    expect(banner.textContent).toContain(`chain ${TARGET_ID}`);

    expect(switchChainMock).toHaveBeenCalledTimes(1);
    expect(switchChainMock).toHaveBeenCalledWith({ chainId: TARGET_ID });

    // Re-renders must NOT re-fire the wallet popup (one attempt per episode).
    rerender(<NetworkBanner />);
    rerender(<NetworkBanner />);
    expect(switchChainMock).toHaveBeenCalledTimes(1);
  });

  it("pending switch → wallet-confirm copy, no manual button", () => {
    acct.value = { isConnected: true, chainId: 1, connector: { uid: "inj-1" } };
    switchState.isPending = true;
    render(<NetworkBanner />);
    expect(screen.getByText(/Confirm the network switch in your wallet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Switch network" })).toBeNull();
  });

  it("rejection → declined copy + manual button that resets and re-requests", () => {
    acct.value = { isConnected: true, chainId: 1, connector: { uid: "inj-1" } };
    switchState.error = new Error("User rejected the request.");
    render(<NetworkBanner />);

    // Auto attempt fired once on mount; the error state shows the fallback.
    expect(switchChainMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Switch request was declined/)).toBeTruthy();

    const button = screen.getByRole("button", { name: "Switch network" });
    fireEvent.click(button);
    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(switchChainMock).toHaveBeenCalledTimes(2);
    expect(switchChainMock).toHaveBeenLastCalledWith({ chainId: TARGET_ID });
  });

  it("chain-changed to the target (post-switch) → banner unmounts cleanly", () => {
    acct.value = { isConnected: true, chainId: 1, connector: { uid: "inj-1" } };
    const { rerender, container } = render(<NetworkBanner />);
    expect(screen.getByRole("alert")).toBeTruthy();

    // wagmi re-renders useAccount on chainChanged; simulate the wallet landing
    // on the target chain.
    acct.value = { isConnected: true, chainId: TARGET_ID, connector: { uid: "inj-1" } };
    rerender(<NetworkBanner />);
    expect(container.firstChild).toBeNull();
  });
});
