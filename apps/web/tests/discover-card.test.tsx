import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tokenCard, usdValue } from "./fixtures";

/**
 * TokenCard renders the D-70 rich field set EXACTLY and performs NO client market
 * math (metrics come straight off the `TokenCard` payload). mcap is ETH-first;
 * USD is a live-priced mirror only where a real feed exists. Graduation copy is
 * venue-named — the forbidden LP verb (built dynamically below so this file has no
 * literal occurrence, lp-copy rule) must never render. `progressPct` is a [0,1]
 * fraction the card scales ×100 for the shared GraduationProgress (D-70 units).
 */
// The forbidden LP verb, assembled so the literal never appears in source.
const FORBIDDEN_LP_VERB = `bur${"ned"}`;
const { push, prefetch } = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, prefetch }),
}));

// Imported AFTER the mock is registered.
import { TokenCard } from "@/entities/token";

beforeEach(() => {
  push.mockClear();
  prefetch.mockClear();
});
afterEach(cleanup);

describe("TokenCard — D-70 fields", () => {
  it("renders image · name · ticker · description · mcap(ETH) · Δ% · status · vol · creator · age", () => {
    const { container } = render(
      <TokenCard
        token={tokenCard({
          imageUrl: null,
          description: "A community memecoin on ROBBED_.",
          progressPct: 0.425,
        })}
      />,
    );

    // name + ticker + image fallback monogram (imageUrl null)
    expect(screen.getByText("Hoodie Coin")).toBeTruthy();
    expect(screen.getByText("HOODIE")).toBeTruthy();
    expect(screen.getByText("HOO")).toBeTruthy();

    // description blurb (D-70 card-preview field)
    expect(screen.getByText("A community memecoin on ROBBED_.")).toBeTruthy();

    // mcap ETH-FIRST (from mcapEth wei = 5.7 ETH), never client-computed
    expect(screen.getByText("5.7000")).toBeTruthy();

    // live USD mirror (fixture has a real feed) with source + timestamp disclosure
    const mcapUsd = screen.getByText("$12,345");
    expect(mcapUsd.getAttribute("title")).toContain("2026-07-10T00:00:00Z");
    expect(mcapUsd.getAttribute("title")).toContain("ETH/USD 3450");

    // graduation status copy: "{n}% to graduation" (progressPct 0.425 → 42.5%)
    expect(screen.getByText("42.5% to graduation")).toBeTruthy();
    expect(container.querySelector('[role="progressbar"]')).toBeTruthy();

    // 24h Δ% (signed), Vol 24h ETH (1.5 ETH), creator short-address, age
    expect(screen.getByText("+12.3%")).toBeTruthy();
    expect(screen.getByText("1.5000")).toBeTruthy();
    expect(screen.getByText(/by 0x0000…00bb/)).toBeTruthy();
    expect(screen.getByText("5m")).toBeTruthy();

    // HARD RULE (lp-copy): the forbidden LP verb never renders on the card.
    expect(container.textContent?.toLowerCase()).not.toContain(FORBIDDEN_LP_VERB);
  });

  it("graduated → 'Graduated · Uniswap V3' (venue named, no forbidden LP verb)", () => {
    const { container } = render(
      <TokenCard token={tokenCard({ graduated: true, status: "graduated", progressPct: 1 })} />,
    );
    expect(screen.getByText("Graduated · Uniswap V3")).toBeTruthy();
    expect(container.textContent?.toLowerCase()).not.toContain(FORBIDDEN_LP_VERB);
  });

  it("shows the exact payload USD figure — never a recomputed/hardcoded metric", () => {
    render(<TokenCard token={tokenCard({ mcap: usdValue({ usd: "999999" }) })} />);
    expect(screen.getByText("$999,999")).toBeTruthy();
  });

  it("renders NO USD mirror when there is no live feed (ethUsd == 0) — no fabricated USD", () => {
    render(
      <TokenCard
        token={tokenCard({
          // API no-feed sentinel (MISSING_ETH_USD): epoch asOf, price 0.
          mcap: usdValue({ usd: "0", ethUsd: "0", asOf: "1970-01-01T00:00:00.000Z" }),
        })}
      />,
    );
    // ETH mcap still shows; NO dollar figure is printed.
    expect(screen.getByText("5.7000")).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("navigates to the token detail on card click", () => {
    render(<TokenCard token={tokenCard({ address: "0x00000000000000000000000000000000000000cd" })} />);
    fireEvent.click(screen.getByRole("link", { name: /Hoodie Coin/ }));
    expect(push).toHaveBeenCalledWith("/t/0x00000000000000000000000000000000000000cd");
  });

  it("creator click deep-links to a creator-filtered search", () => {
    render(<TokenCard token={tokenCard()} />);
    fireEvent.click(screen.getByTitle("Filter by creator"));
    expect(push).toHaveBeenCalledWith(
      "/?q=0x00000000000000000000000000000000000000bb",
    );
  });
});
