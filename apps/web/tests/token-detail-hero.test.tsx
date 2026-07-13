import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TD_HERO_HEIGHT, TD_HERO_HEIGHT_PX } from "@/views/token-detail/config/hero";

import { tokenDetail } from "./fixtures";

/**
 * Token-Detail hero sizing (layout revision 2026-07-12 — supersedes the removed
 * `useViewportFillHeight` viewport-fill hero). Two guarantees are proven here:
 *
 *   1. FIXED height, not viewport-relative: the hero row carries a constant
 *      `--td-hero-h` (a single tunable number in ../config/hero) sized to fit a
 *      MacBook 13" first screen — NOT a `100dvh - header` calc.
 *   2. EQUAL-HEIGHT columns: the chart box (left) and the trade-form box (right)
 *      are the SAME height — both are `lg:h-full` children of the one hero row
 *      whose height is that fixed var, with `lg:items-stretch`. So chart-box
 *      height == form-box height == the constant, by construction.
 *
 * Child widgets are stubbed — this test asserts the composition/height wiring the
 * view owns, not the widgets' internals (covered by their own suites).
 */

vi.mock("@/entities/token", () => ({
  useLiveTokenDetail: (t: unknown) => t,
}));
vi.mock("@/entities/trade", () => ({
  OptimisticTradesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/widgets/price-chart", () => ({
  PriceChart: () => <div data-testid="chart-stub" />,
}));
vi.mock("@/widgets/trade-widget", () => ({
  TradeWidget: () => <div data-testid="form-stub" />,
}));
vi.mock("@/widgets/trade-feed", () => ({ TradeFeed: () => <div /> }));
vi.mock("@/widgets/holder-table", () => ({ HolderTable: () => <div /> }));
vi.mock("@/views/token-detail/ui/TokenHeader", () => ({ TokenHeader: () => <div /> }));
vi.mock("@/views/token-detail/ui/TokenInfo", () => ({ TokenInfo: () => <div /> }));

import { TokenDetailClient } from "@/views/token-detail/ui/TokenDetailClient";

afterEach(cleanup);

describe("Token-Detail hero — fixed equal-height columns", () => {
  it("uses a FIXED constant height, not a viewport calc", () => {
    // The constant is a plain number (no `dvh`/`calc`) within the MacBook-13"
    // budget: the usable area below the app header is ~700px, so it must fit
    // there (≤700) and stay tall enough to be a real chart (≥480).
    expect(typeof TD_HERO_HEIGHT_PX).toBe("number");
    expect(Number.isFinite(TD_HERO_HEIGHT_PX)).toBe(true);
    expect(TD_HERO_HEIGHT_PX).toBeLessThanOrEqual(700);
    expect(TD_HERO_HEIGHT_PX).toBeGreaterThanOrEqual(480);
    expect(TD_HERO_HEIGHT).toBe(`${TD_HERO_HEIGHT_PX}px`);
  });

  it("sizes the hero row to the fixed `--td-hero-h` and consumes it at lg", () => {
    render(<TokenDetailClient token={tokenDetail()} />);

    const chartCol = screen.getByTestId("chart-stub").parentElement!;
    const hero = chartCol.parentElement!;

    // Fixed px var (not a viewport-relative value), consumed only at lg.
    expect(hero.style.getPropertyValue("--td-hero-h")).toBe(TD_HERO_HEIGHT);
    expect(hero.className).toContain("lg:h-[var(--td-hero-h)]");
    expect(hero.className).toContain("lg:items-stretch");
    // No leftover viewport-relative height source on the hero.
    expect(hero.className).not.toContain("dvh");
  });

  it("makes chart-box and form-box exactly equal-height (both lg:h-full in one hero)", () => {
    render(<TokenDetailClient token={tokenDetail()} />);

    const chartCol = screen.getByTestId("chart-stub").parentElement!;
    const formCol = screen.getByTestId("form-stub").parentElement!;

    // Both columns fill the SAME fixed-height hero row → equal height.
    expect(chartCol.className).toContain("lg:h-full");
    expect(formCol.className).toContain("lg:h-full");
    expect(chartCol.parentElement).toBe(formCol.parentElement);
  });
});
