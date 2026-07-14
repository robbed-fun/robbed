import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tokenCard } from "./fixtures";

/**
 * DiscoverGrid (D-70) — the re-added token-card grid. Proves it paints cards from
 * the SSR `initialData`, exposes the view-local sort/filter tabs, and renders the
 * LOOT_ mascot empty state (mascot.md) when the API returns nothing. The
 * `global:metrics` sync no-ops here (no WsProvider → `useWsChannel` sees a null
 * client and returns), so the grid renders without a live socket.
 */
const { push, prefetch } = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, prefetch }) }));
// Non-default sort/filter tabs fetch client-side; keep it off the network.
vi.mock("@/shared/api", () => ({
  getTokens: vi.fn(() => Promise.resolve({ tokens: [], nextCursor: null })),
}));

// Imported AFTER the mocks are registered.
import { DiscoverGrid } from "@/views/discover/ui/DiscoverGrid";

function withQuery(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  push.mockClear();
  prefetch.mockClear();
});
afterEach(cleanup);

describe("DiscoverGrid — D-70", () => {
  it("paints cards from the SSR initialData and exposes sort + filter tabs", () => {
    withQuery(
      <DiscoverGrid
        initial={{
          tokens: [
            tokenCard({ address: "0x00000000000000000000000000000000000000a1", name: "Alpha Coin" }),
            tokenCard({ address: "0x00000000000000000000000000000000000000a2", name: "Beta Coin" }),
          ],
          nextCursor: null,
        }}
      />,
    );

    expect(screen.getByText("Alpha Coin")).toBeTruthy();
    expect(screen.getByText("Beta Coin")).toBeTruthy();

    // view-local controls (D-70): default sort=trending, filter=all
    expect(screen.getByRole("tab", { name: "Trending" }).getAttribute("aria-selected")).toBe("true");
    for (const t of ["Newest", "Mcap", "Vol 24h"]) {
      expect(screen.getByRole("tab", { name: t })).toBeTruthy();
    }
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
    for (const t of ["Pre-grad", "Graduated"]) {
      expect(screen.getByRole("tab", { name: t })).toBeTruthy();
    }
  });

  it("switching a sort tab makes it the active control", () => {
    withQuery(<DiscoverGrid initial={{ tokens: [tokenCard()], nextCursor: null }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Newest" }));
    expect(screen.getByRole("tab", { name: "Newest" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Trending" }).getAttribute("aria-selected")).toBe("false");
  });

  it("renders the LOOT_ mascot empty state when there are no tokens", () => {
    const { container } = withQuery(
      <DiscoverGrid initial={{ tokens: [], nextCursor: null }} />,
    );
    // the design's empty-state line (mascot.md) + the mascot illustration (SVG)
    expect(screen.getByText("nothing here — Loot got to it first")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
    // at the default view (unfiltered) the empty CTA points at /create
    expect(screen.getByRole("link", { name: /Launch the first token/i })).toBeTruthy();
  });
});
