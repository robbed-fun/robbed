import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tokenCard, usdValue } from "./fixtures";

/**
 * TokenCard renders the §5.1 field set EXACTLY and performs no client market
 * math (metrics come straight from the `TokenCard` payload; mcap discloses its
 * source + timestamp per §2). Navigation is asserted through a mocked router.
 */
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

describe("TokenCard — §5.1 fields", () => {
  it("renders image(monogram) · name · ticker · mcap · progress · 24h Δ% · creator · age", () => {
    const { container } = render(
      <TokenCard token={tokenCard({ imageUrl: null })} />,
    );

    // name + ticker
    expect(screen.getByText("Hoodie Coin")).toBeTruthy();
    expect(screen.getByText("HOODIE")).toBeTruthy();

    // image fallback monogram (imageUrl null)
    expect(screen.getByText("HOO")).toBeTruthy();

    // mcap: rendered from the payload's usd, with source+timestamp disclosure
    const mcap = screen.getByText("$12,345");
    expect(mcap.getAttribute("title")).toContain("2026-07-10T00:00:00Z");
    expect(mcap.getAttribute("title")).toContain("ETH/USD 3450");

    // progress bar present
    expect(container.querySelector('[role="progressbar"]')).toBeTruthy();

    // 24h Δ% (signed)
    expect(screen.getByText("+12.3%")).toBeTruthy();

    // creator (short address)
    expect(screen.getByText(/by 0x0000…00bb/)).toBeTruthy();

    // age — createdAt is now-300s → "5m"
    expect(screen.getByText("5m")).toBeTruthy();
  });

  it("shows the exact payload USD figure — never a recomputed/hardcoded metric", () => {
    render(<TokenCard token={tokenCard({ mcap: usdValue({ usd: "999999" }) })} />);
    // $999,999 comes verbatim from the indexer usd field, not from priceEth math.
    expect(screen.getByText("$999,999")).toBeTruthy();
  });

  it("flags a graduated token and renders a full progress bar", () => {
    render(<TokenCard token={tokenCard({ graduated: true, progressPct: 100 })} />);
    expect(screen.getAllByText("Graduated").length).toBeGreaterThan(0);
  });

  it("navigates to the token detail on card click", () => {
    render(<TokenCard token={tokenCard({ address: "0x00000000000000000000000000000000000000cd" })} />);
    fireEvent.click(screen.getByRole("link", { name: /Hoodie Coin/ }));
    expect(push).toHaveBeenCalledWith("/t/0x00000000000000000000000000000000000000cd");
  });

  it("creator click deep-links to a creator-filtered search (§5.1)", () => {
    render(<TokenCard token={tokenCard()} />);
    fireEvent.click(screen.getByTitle("Filter by creator"));
    expect(push).toHaveBeenCalledWith(
      "/?q=0x00000000000000000000000000000000000000bb",
    );
  });
});
