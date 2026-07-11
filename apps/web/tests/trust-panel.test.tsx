import { LP_COPY } from "@robbed/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { organicFlow, tokenDetail } from "./fixtures";

/**
 * Trust panel (§5.2) — the sourcing contract. Proves the on-chain rows render the
 * LIVE reads (never the API's cached `reserves`), the fee is rendered from the
 * on-chain bps, the LP sentence is verbatim, and the v1.2 organic-holder estimate
 * is a RANGE (never false precision).
 */

// The whole panel's live reads flow through wagmi `useReadContracts`; control it.
const readContractsMock = vi.fn();
vi.mock("wagmi", () => ({
  useReadContracts: (...args: unknown[]) => readContractsMock(...args),
}));
vi.mock("@/shared/lib/ws", () => ({ useWsChannel: () => {} }));

import { TrustPanel } from "@/widgets/trust-panel";

// Live on-chain reserves — DELIBERATELY different from the API fixture's cached
// reserves (realEth 9.999) so we can prove the panel shows the chain value.
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

describe("TrustPanel sourcing", () => {
  it("row 3 shows the LIVE on-chain reserves, not the API's cached value", () => {
    readContractsMock.mockReturnValue(liveReads());
    render(<TrustPanel token={tokenDetail()} />);

    // On-chain realEth 3.5 renders (zero-padded to 4 dec); the cached 9.999 does NOT.
    expect(screen.getByText(/3\.5000 ETH/)).toBeTruthy();
    expect(screen.queryByText(/9\.999/)).toBeNull();
    expect(screen.getByText(/read from chain/)).toBeTruthy();
  });

  it("row 2 verifies fixed 1B supply from the live totalSupply", () => {
    readContractsMock.mockReturnValue(liveReads());
    render(<TrustPanel token={tokenDetail()} />);
    expect(screen.getByText(/1,000,000,000 fixed/)).toBeTruthy();
  });

  it("row 6 renders the fee from the on-chain bps (1% ← 100 bps), not a literal", () => {
    readContractsMock.mockReturnValue(liveReads());
    render(<TrustPanel token={tokenDetail()} />);
    // Text is split across nodes (the "1%" is rendered from the on-chain bps).
    expect(screen.getByText("1%")).toBeTruthy();
    expect(screen.getByText(/curve fee → treasury/)).toBeTruthy();
  });

  it("row 5 is the canonical LP sentence, verbatim (no forbidden LP verb)", () => {
    readContractsMock.mockReturnValue(liveReads());
    const { container } = render(<TrustPanel token={tokenDetail()} />);
    expect(screen.getByText(LP_COPY)).toBeTruthy();
    // The forbidden LP verb (CLAUDE.md hard rule) — built from parts so this test
    // file never contains the literal string.
    const forbidden = ["bu", "rn"].join("");
    expect(container.textContent?.toLowerCase()).not.toContain(forbidden);
  });

  it("row 7 shows the indexer metadata verdict", () => {
    readContractsMock.mockReturnValue(liveReads());
    render(<TrustPanel token={tokenDetail()} />);
    expect(screen.getByText(/Metadata matches on-chain commitment/)).toBeTruthy();
  });

  it("v1.2 organic-holder estimate renders a RANGE, never a single number", () => {
    readContractsMock.mockReturnValue(liveReads());
    render(
      <TrustPanel
        token={tokenDetail({
          trust: {
            metadataVerification: {
              status: "match",
              onchainHash:
                "0x1111111111111111111111111111111111111111111111111111111111111111",
            },
            lpCopy: LP_COPY,
            feePolicy: { tradeFeeBps: 100, creatorFeeBps: 0 },
            organic: organicFlow({ holderPctLow: 55, holderPctHigh: 70 }),
          },
        })}
      />,
    );
    expect(screen.getByText(/~55[–-]70%/)).toBeTruthy();
  });

  it("organic shows 'estimating…' while stats are null (fresh token)", () => {
    readContractsMock.mockReturnValue(liveReads());
    render(
      <TrustPanel
        token={tokenDetail({
          trust: {
            metadataVerification: {
              status: "match",
              onchainHash:
                "0x1111111111111111111111111111111111111111111111111111111111111111",
            },
            lpCopy: LP_COPY,
            feePolicy: { tradeFeeBps: 100, creatorFeeBps: 0 },
            organic: null,
          },
        })}
      />,
    );
    expect(screen.getAllByText(/estimating…/).length).toBeGreaterThan(0);
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
    render(<TrustPanel token={tokenDetail()} />);
    expect(screen.getAllByText(/on-chain read unavailable/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/9\.999/)).toBeNull();
  });
});
