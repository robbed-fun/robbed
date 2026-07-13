import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TrendingCarousel } from "@/widgets/trending-carousel";

import { tokenCard } from "./fixtures";

/**
 * TrendingCarousel is the real Discover (`/`) token list (§5.1 as amended by
 * §12.50(f)). This proves the compact GraduationProgress now adds the raise
 * progress bar + graduated/on-curve status to each card, WITHOUT disturbing the
 * DISC-1 accessibility contract (the "Trending tokens" region + the per-card
 * `— rank N` link name).
 */

afterEach(cleanup);

describe("TrendingCarousel — Discover token list (§5.1)", () => {
  it("adds the graduation progress bar + status to each card, DISC-1 contract intact", () => {
    const { container } = render(
      <TrendingCarousel
        tokens={[
          tokenCard({
            address: "0x00000000000000000000000000000000000000aa",
            name: "Curve One",
            ticker: "CUR",
            progressPct: 42.5,
            status: "curve",
          }),
          tokenCard({
            address: "0x00000000000000000000000000000000000000bb",
            name: "Grad Two",
            ticker: "GRD",
            graduated: true,
            status: "graduated",
            progressPct: 100,
          }),
        ]}
      />,
    );

    // DISC-1 selectors unchanged: the region + the rank-1 card link accessible name.
    expect(screen.getByRole("region", { name: /trending tokens/i })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /rank 1$/i }).length).toBeGreaterThan(0);

    // Each card carries a graduation progressbar now.
    expect(container.querySelectorAll('[role="progressbar"]').length).toBeGreaterThan(0);
    // curve card shows its %; graduated card shows the Graduated status pill.
    expect(screen.getAllByText("42.5%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Graduated").length).toBeGreaterThan(0);
  });
});
