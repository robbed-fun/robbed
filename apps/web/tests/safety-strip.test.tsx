import { LP_COPY } from "@robbed/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { tokenDetail } from "./fixtures";

/**
 * Safety strip (§12.57) — the relocated must-render floor after the Trust panel's
 * deletion. Proves the three HARD-RULE signals still render on token detail from
 * LIVE reads (never the API's cached reserves): the §12.14 LP_COPY sentence
 * (VERBATIM), the graduation progress toward GRADUATION_ETH, and the live curve
 * reserves. Also proves the cheap ticks (ownerless/fixed-supply/metadata/fee) and
 * that the dropped organic-holder RANGE block is GONE from the public page.
 */

const readContractsMock = vi.fn();
vi.mock("wagmi", () => ({
  useReadContracts: (...args: unknown[]) => readContractsMock(...args),
}));
vi.mock("@/shared/lib/ws", () => ({ useWsChannel: () => {} }));

import { SafetyStrip } from "@/widgets/safety-strip";

// Live on-chain reserves — DELIBERATELY different from the API fixture's cached
// reserves (realEth 9.999) so we prove the strip shows the CHAIN value.
const LIVE_REAL_ETH = 3_500_000_000_000_000_000n; // 3.5 ETH
function liveReads() {
  return {
    data: [
      { status: "success", result: 10n ** 27n }, // totalSupply = 1e27
      { status: "success", result: [1n, 2n, LIVE_REAL_ETH, 5n * 10n ** 26n] }, // reserves
      { status: "success", result: 8_076_868_822_140_981_824n }, // GRADUATION_ETH ~8.08
      { status: "success", result: 100 }, // TRADE_FEE_BPS
      { status: "success", result: 0n }, // EARLY_WINDOW_END
      { status: "success", result: 0n }, // MAX_EARLY_BUY
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

afterEach(cleanup);

describe("SafetyStrip — relocated must-render floor (§12.57)", () => {
  it("renders the canonical LP sentence, verbatim (no forbidden LP verb)", () => {
    readContractsMock.mockReturnValue(liveReads());
    const { container } = render(<SafetyStrip token={tokenDetail()} />);
    expect(screen.getByText(LP_COPY)).toBeTruthy();
    const forbidden = ["bu", "rn"].join("");
    expect(container.textContent?.toLowerCase()).not.toContain(forbidden);
  });

  it("shows LIVE on-chain curve reserves, not the API's cached value", () => {
    readContractsMock.mockReturnValue(liveReads());
    render(<SafetyStrip token={tokenDetail()} />);
    expect(screen.getByText(/3\.5000 ETH/)).toBeTruthy();
    expect(screen.queryByText(/9\.999/)).toBeNull();
    expect(screen.getByText(/read from chain/)).toBeTruthy();
  });

  it("shows graduation progress toward GRADUATION_ETH (LIVE reserves ÷ threshold)", () => {
    readContractsMock.mockReturnValue(liveReads());
    render(<SafetyStrip token={tokenDetail()} />);
    // 3.5 / 8.0769 ≈ 43.3%
    expect(screen.getByText(/43\.3%/)).toBeTruthy();
    expect(screen.getByText(/ETH raised/)).toBeTruthy();
  });

  it("keeps the cheap ownerless ✓ + fixed-1B ✓ + fee ticks", () => {
    readContractsMock.mockReturnValue(liveReads());
    render(<SafetyStrip token={tokenDetail()} />);
    expect(screen.getByText(/Ownerless token/)).toBeTruthy();
    expect(screen.getByText(/1,000,000,000 fixed/)).toBeTruthy();
    // Fee rendered from the on-chain bps (1% ← 100 bps), not a literal.
    expect(screen.getByText(/1% → treasury/)).toBeTruthy();
  });

  it("shows the indexer metadata verdict", () => {
    readContractsMock.mockReturnValue(liveReads());
    render(<SafetyStrip token={tokenDetail()} />);
    expect(screen.getByText(/Metadata matches/)).toBeTruthy();
  });

  it("does NOT render the dropped organic-holder RANGE block (§12.57 drop)", () => {
    readContractsMock.mockReturnValue(liveReads());
    render(<SafetyStrip token={tokenDetail()} />);
    expect(screen.queryByText(/organic/i)).toBeNull();
    expect(screen.queryByText(/of holders look/i)).toBeNull();
  });

  it("degrades a failed reserves read to 'unavailable' — never a cached API value", () => {
    readContractsMock.mockReturnValue({
      data: [
        { status: "success", result: 10n ** 27n },
        { status: "failure" }, // reserves reverted
        { status: "failure" },
        { status: "success", result: 100 },
        { status: "failure" },
        { status: "failure" },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<SafetyStrip token={tokenDetail()} />);
    expect(screen.getAllByText(/on-chain read unavailable/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/9\.999/)).toBeNull();
    // The LP floor still renders even when the on-chain reads fail.
    expect(screen.getByText(LP_COPY)).toBeTruthy();
  });
});
