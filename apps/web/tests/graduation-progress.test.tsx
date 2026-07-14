import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GraduationProgress } from "@/shared/ui";

/**
 * GraduationProgress — the shared presentational graduation indicator used by the
 * Discover card (compact) and the token-detail SafetyStrip (full). It performs no
 * fetch / on-chain read; every value arrives via props (the graduation threshold
 * included — never hardcoded). These prove: pct + a11y progressbar, the
 * three `tokenStatusSchema` states, and the full-vs-compact rendering contract.
 */

afterEach(cleanup);

describe("GraduationProgress", () => {
  describe("curve — in-progress bar + %", () => {
    it("renders the percentage and an accessible progressbar (aria-valuenow)", () => {
      const { container } = render(
        <GraduationProgress variant="compact" status="curve" progressPct={42} />,
      );
      const bar = container.querySelector('[role="progressbar"]');
      expect(bar).toBeTruthy();
      expect(bar?.getAttribute("aria-valuenow")).toBe("42");
      expect(screen.getByText("42.0%")).toBeTruthy();
    });

    it("clamps an out-of-range pct for BOTH the text and the bar geometry", () => {
      const { container } = render(
        <GraduationProgress variant="compact" status="curve" progressPct={140} />,
      );
      expect(screen.getByText("100.0%")).toBeTruthy();
      expect(
        container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
      ).toBe("100");
    });

    it("full variant shows the raised / threshold ETH label (from props)", () => {
      render(
        <GraduationProgress
          variant="full"
          status="curve"
          progressPct={43.33}
          raisedEth={3_500_000_000_000_000_000n}
          graduationEth={8_076_868_822_140_981_824n}
        />,
      );
      // 3.5 / 8.0769, both zero-padded to 4 dp by the shared formatter.
      expect(screen.getByText(/3\.5000 \/ 8\.0769 ETH raised/)).toBeTruthy();
      expect(screen.getByText("43.3%")).toBeTruthy();
    });

    it("full variant degrades an absent live read to 'unavailable' — never a cached value", () => {
      render(
        <GraduationProgress
          variant="full"
          status="curve"
          progressPct={0}
          raisedEth={null}
          graduationEth={null}
        />,
      );
      expect(screen.getByText(/on-chain read unavailable — retry/)).toBeTruthy();
      // no bar and no fabricated label in the unavailable state
      expect(screen.queryByText(/ETH raised/)).toBeNull();
    });

    it("full variant shows a loading note while the live read is in flight", () => {
      render(
        <GraduationProgress
          variant="full"
          status="curve"
          progressPct={0}
          raisedEth={null}
          graduationEth={null}
          loading
        />,
      );
      expect(screen.getByText(/reading chain…/)).toBeTruthy();
    });
  });

  describe("graduating — ready-to-graduate lock window", () => {
    it("shows the Graduating pill (compact)", () => {
      render(
        <GraduationProgress variant="compact" status="graduating" progressPct={99} />,
      );
      expect(screen.getByText("Graduating")).toBeTruthy();
    });

    it("shows the Graduating pill alongside the raised label (full)", () => {
      render(
        <GraduationProgress
          variant="full"
          status="graduating"
          progressPct={99}
          raisedEth={8_000_000_000_000_000_000n}
          graduationEth={8_076_868_822_140_981_824n}
        />,
      );
      expect(screen.getByText("Graduating")).toBeTruthy();
      expect(screen.getByText(/ETH raised/)).toBeTruthy();
    });
  });

  describe("graduated — migrated to Uniswap V3", () => {
    it("shows the Graduated verdict text + any trailing slot (full)", () => {
      render(
        <GraduationProgress
          variant="full"
          status="graduated"
          progressPct={100}
          trailing={<a href="https://example.test/pool">pool ↗</a>}
        />,
      );
      expect(screen.getByText(/Graduated ✓ → Uniswap V3/)).toBeTruthy();
      expect(screen.getByText("pool ↗")).toBeTruthy();
    });

    it("shows the Graduated pill (compact)", () => {
      render(
        <GraduationProgress variant="compact" status="graduated" progressPct={100} />,
      );
      expect(screen.getByText("Graduated")).toBeTruthy();
    });
  });
});
