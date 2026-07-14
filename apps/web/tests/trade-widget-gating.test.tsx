import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tokenDetail } from "./fixtures";

/**
 * TradeWidget invariants. The load-bearing product guarantee:
 * the SELL path is NEVER gated by any pause flag. When `pauseBuys` is set, the
 * Buy tab disables with the exact copy while the Sell tab stays fully live and
 * submittable. Also covers the invisible venue switch (status selects the engine).
 */

// pauseBuys is toggled per-test through this holder.
const pauseState = { pauseBuys: false as boolean | undefined };
// V3 quote amountOut is set per-test (post-grad venue).
const v3State = { amountOut: null as bigint | null };

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x00000000000000000000000000000000000000ee", isConnected: true }),
  useBalance: () => ({ data: undefined }),
  useReadContract: () => ({ data: undefined }),
  useSimulateContract: () => ({ data: undefined, isFetching: false, isError: false }),
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
  usePublicClient: () => undefined,
}));

vi.mock("@/entities/trade", () => ({
  useOptimisticTradesContext: () => ({
    submit: vi.fn(),
    attachHash: vi.fn(),
    applyReceipt: vi.fn(),
    reject: vi.fn(),
    applyWsTrade: vi.fn(),
    trades: [],
    state: {},
  }),
}));

vi.mock("@/features/connect-wallet", () => ({
  WalletConnectButton: () => <button type="button">Connect</button>,
}));

vi.mock("@/entities/curve", async (importActual) => {
  const actual = await importActual<typeof import("@/entities/curve")>();
  return {
    ...actual,
    usePauseBuys: () => ({ pauseBuys: pauseState.pauseBuys, isError: false }),
    useCurveReads: () => ({
      totalSupply: 1n,
      reserves: { virtualEth: 1n, virtualToken: 2n, realEth: 3n, realToken: 4n },
      graduationEth: 8n,
      tradeFeeBps: 100,
      earlyWindowEnd: null,
      maxEarlyBuyWei: null,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useCurveQuote: () => ({
      quote: { side: "buy", amountOut: 1000n, feeEth: 5n },
      isFetching: false,
      isError: false,
    }),
    useV3Quote: () => ({
      amountOut: v3State.amountOut,
      isFetching: false,
      isError: false,
    }),
  };
});

import { TradeWidget } from "@/widgets/trade-widget";

const PAUSE_COPY = "Buying is temporarily paused — selling remains open.";

function typeAmount(value: string) {
  const input = screen.getByPlaceholderText("0.0");
  act(() => {
    fireEvent.change(input, { target: { value } });
    vi.advanceTimersByTime(300); // clear the 250ms quote debounce
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  pauseState.pauseBuys = false;
  v3State.amountOut = null;
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
});

describe("sells are never gated by pauseBuys ", () => {
  it("pauseBuys=true → Buy disabled with exact copy, Sell stays live + submittable", () => {
    pauseState.pauseBuys = true;
    render(<TradeWidget token={tokenDetail({ status: "curve" })} />);

    // Buy tab (default): the exact pause copy shows, the Buy button is disabled.
    typeAmount("0.5");
    expect(screen.getByText(PAUSE_COPY)).toBeTruthy();
    const buyBtn = screen.getByRole("button", { name: "BUY HOODIE" });
    expect((buyBtn as HTMLButtonElement).disabled).toBe(true);

    // Switch to Sell — the pause copy disappears and Sell is enabled.
    fireEvent.click(screen.getByRole("tab", { name: /sell/i }));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByText(PAUSE_COPY)).toBeNull();
    const sellBtn = screen.getByRole("button", { name: "SELL HOODIE" });
    expect((sellBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("with buys NOT paused, Buy is enabled once a quote exists", () => {
    pauseState.pauseBuys = false;
    render(<TradeWidget token={tokenDetail({ status: "curve" })} />);
    typeAmount("0.5");
    expect(screen.queryByText(PAUSE_COPY)).toBeNull();
    expect((screen.getByRole("button", { name: "BUY HOODIE" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("invisible venue switch — status selects the engine ", () => {
  it("curve status → Buy/Sell tabs (curve engine)", () => {
    render(<TradeWidget token={tokenDetail({ status: "curve" })} />);
    expect(screen.getByRole("tab", { name: /buy/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /sell/i })).toBeTruthy();
  });

  it("graduated status → Uniswap V3 engine, SAME Buy/Sell UX (invisible switch)", () => {
    render(<TradeWidget token={tokenDetail({ status: "graduated", graduated: true })} />);
    // Same widget UX (Buy/Sell tabs) — only the engine underneath changed.
    expect(screen.getByText(/Trading on Uniswap V3/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: /buy/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /sell/i })).toBeTruthy();
    // No curve-only pause copy exists post-graduation (no pause authority).
    expect(screen.queryByText(PAUSE_COPY)).toBeNull();
  });

  it("post-grad quote path uses the V3 quoter → Buy enables once a V3 quote exists", () => {
    v3State.amountOut = 4200n; // a QuoterV2 amountOut (mocked useV3Quote)
    render(<TradeWidget token={tokenDetail({ status: "graduated", graduated: true })} />);
    typeAmount("0.5");
    // The V3 quote drives the expected-out + enables Buy — inline routing, no deep link.
    expect((screen.getByRole("button", { name: "BUY HOODIE" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("post-grad Sell is never gated (no pause authority post-graduation)", () => {
    v3State.amountOut = 4200n;
    pauseState.pauseBuys = true; // even if a stale pause flag were set…
    render(<TradeWidget token={tokenDetail({ status: "graduated", graduated: true })} />);
    fireEvent.click(screen.getByRole("tab", { name: /sell/i }));
    typeAmount("100");
    // …the V3 venue never consults it; Sell stays live and submittable.
    expect((screen.getByRole("button", { name: "SELL HOODIE" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("graduating status → both sides locked with interstitial (not 'paused')", () => {
    render(<TradeWidget token={tokenDetail({ status: "graduating" })} />);
    expect(screen.getByText(/Graduating to Uniswap V3/)).toBeTruthy();
    // : the interstitial must not describe the lock as "paused".
    const region = screen.getByText(/automatic protocol step/i);
    expect(region.textContent).not.toMatch(/paused/i);
  });
});
