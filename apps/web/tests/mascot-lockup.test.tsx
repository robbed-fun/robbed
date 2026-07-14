import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MascotLockup } from "@/shared/ui";
import styles from "@/shared/ui/mascot/LootMascot.module.css";

/**
 * The ROBBED_ brand LOCKUP (design exploration §3/§4) — the LOOT_ mascot beside
 * the ROBBED_ wordmark as one unit. Pins: it COMPOSES the ratified mascot +
 * wordmark (no re-drawn geometry), the mascot is decorative (the wordmark names
 * the brand for a11y), the `_` stays accent-green, and `animated` toggles the
 * mascot's idle-motion classes so the static logo variant is truly static.
 * Basis: docs/developers/mascot.md.
 */

afterEach(cleanup);

const svgOf = (c: HTMLElement) => c.querySelector("svg") as SVGSVGElement;

describe("MascotLockup", () => {
  it("renders the mascot SVG next to the ROBBED wordmark", () => {
    const { container } = render(<MascotLockup />);
    // the ratified mascot asset is present (its viewBox is the tell)
    expect(svgOf(container).getAttribute("viewBox")).toBe("-8 -4 232 222");
    // the wordmark text is present as the brand name
    expect(container.textContent).toContain("ROBBED");
  });

  it("marks the mascot decorative so only the wordmark names the brand", () => {
    const { container } = render(<MascotLockup />);
    const svg = svgOf(container);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
  });

  it("keeps the terminal `_` in accent green (matches copy.BRAND / CursorTag)", () => {
    const { container } = render(<MascotLockup />);
    const underscore = Array.from(container.querySelectorAll("span")).find(
      (s) => s.textContent === "_",
    );
    expect(underscore).toBeTruthy();
    expect(underscore?.getAttribute("class") ?? "").toContain("text-green");
  });

  it("animated (default) applies the mascot idle-motion classes", () => {
    const { container } = render(<MascotLockup />);
    expect(svgOf(container).getAttribute("class") ?? "").toContain(styles.figure);
  });

  it("animated={false} yields a fully static lockup (header / logo variant)", () => {
    const { container } = render(<MascotLockup animated={false} />);
    const svg = svgOf(container);
    expect(svg.getAttribute("class") ?? "").not.toContain(styles.figure);
    svg
      .querySelectorAll("[data-loot-pupil]")
      .forEach((p) =>
        expect(p.getAttribute("class") ?? "").not.toContain(styles.pupil),
      );
  });

  it("sizes the mascot from `size` (height derives from the viewBox)", () => {
    const { container } = render(<MascotLockup size={232} />);
    const svg = svgOf(container);
    expect(Number(svg.getAttribute("width"))).toBe(232);
    expect(Number(svg.getAttribute("height"))).toBeCloseTo(222, 5);
  });

  it("forwards a caller className onto the lockup wrapper", () => {
    const { container } = render(<MascotLockup className="gap-4 opacity-80" />);
    const wrapper = container.firstElementChild as HTMLElement;
    const cls = wrapper.getAttribute("class") ?? "";
    expect(cls).toContain("gap-4");
    expect(cls).toContain("opacity-80");
  });
});
