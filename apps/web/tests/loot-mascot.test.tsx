import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LootMascot } from "@/shared/ui";
import styles from "@/shared/ui/mascot/LootMascot.module.css";

/**
 * LOOT_ mascot (design exploration 3a) — the ratified inline-SVG brand asset.
 * Pins: it renders as an SVG, its height derives from the 232×222 viewBox, the
 * decorative (`label=""`) vs labelled a11y branches, and that `animated` toggles
 * the `.figure` (sway) + `.pupil` (dart) classes from the sibling module. Basis:
 * docs/developers/mascot.md + ROBBED Explorations.html §3a.
 */

afterEach(cleanup);

const svgOf = (c: HTMLElement) => c.querySelector("svg") as SVGSVGElement;

describe("LootMascot", () => {
  it("renders a labelled SVG with the ratified viewBox by default", () => {
    const { container } = render(<LootMascot />);
    const svg = svgOf(container);
    expect(svg).toBeTruthy();
    expect(svg.getAttribute("viewBox")).toBe("-8 -4 232 222");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toMatch(/LOOT_/);
    // two darting pupils are always present (masked, permanent)
    expect(container.querySelectorAll("[data-loot-pupil]")).toHaveLength(2);
  });

  it("derives height from the 232×222 viewBox for the given size", () => {
    const { container } = render(<LootMascot size={232} />);
    const svg = svgOf(container);
    expect(Number(svg.getAttribute("width"))).toBe(232);
    // 232 wide → 222 tall (same aspect ratio as the viewBox)
    expect(Number(svg.getAttribute("height"))).toBeCloseTo(222, 5);

    const { container: half } = render(<LootMascot size={116} />);
    const svgHalf = svgOf(half);
    expect(Number(svgHalf.getAttribute("width"))).toBe(116);
    expect(Number(svgHalf.getAttribute("height"))).toBeCloseTo(111, 5);
  });

  it("label='' renders a decorative aria-hidden mascot (no role/label)", () => {
    const { container } = render(<LootMascot label="" />);
    const svg = svgOf(container);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("aria-label")).toBeNull();
  });

  it("a custom label overrides the default accessible name", () => {
    const { container } = render(<LootMascot label="404 — robbed" />);
    expect(svgOf(container).getAttribute("aria-label")).toBe("404 — robbed");
  });

  it("animated (default) applies the figure + pupil classes; static drops both", () => {
    // The CSS-module class names must resolve to real strings in the test env,
    // otherwise the toggle assertion below is meaningless.
    expect(typeof styles.figure).toBe("string");
    expect(styles.figure).toBeTruthy();
    expect(typeof styles.pupil).toBe("string");

    const { container: on } = render(<LootMascot />);
    expect(svgOf(on).getAttribute("class") ?? "").toContain(styles.figure);
    on.querySelectorAll("[data-loot-pupil]").forEach((p) =>
      expect(p.getAttribute("class") ?? "").toContain(styles.pupil),
    );

    const { container: off } = render(<LootMascot animated={false} />);
    expect(svgOf(off).getAttribute("class") ?? "").not.toContain(styles.figure);
    off.querySelectorAll("[data-loot-pupil]").forEach((p) =>
      expect(p.getAttribute("class") ?? "").not.toContain(styles.pupil),
    );
  });

  it("merges a caller className onto the root svg", () => {
    const { container } = render(<LootMascot className="size-4 opacity-70" />);
    const cls = svgOf(container).getAttribute("class") ?? "";
    expect(cls).toContain("size-4");
    expect(cls).toContain("opacity-70");
  });
});
