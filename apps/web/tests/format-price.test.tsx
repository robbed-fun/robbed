import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  compactPriceParts,
  formatPriceCompact,
  subscriptCount,
} from "@/shared/lib/format-price";
import { PriceEth } from "@/shared/ui";

/**
 * Compact tiny-price formatter (format-price.ts) — DexScreener/pump.fun subscript
 * notation for the sub-1e-4 prices curve memecoins live at. PURE display over a
 * supplied ETH value: no market math, no fabricated USD/ETH-USD (no-market-metrics
 * rule). The exact worked example from the design task is the load-bearing case:
 *   0.000000000063  →  0.0₁₀63   (subscript "10" = the ten leading zeros)
 */

describe("compactPriceParts — decomposition", () => {
  it("collapses the leading-zero run of a tiny value into a subscript count", () => {
    expect(compactPriceParts(0.000000000063)).toEqual({
      kind: "compact",
      sign: "",
      intPart: "0",
      leadingZeros: 10,
      significantDigits: "63",
    });
  });

  it("matches the DexScreener 5-zero reference (0.000006829)", () => {
    expect(compactPriceParts(0.000006829)).toEqual({
      kind: "compact",
      sign: "",
      intPart: "0",
      leadingZeros: 5,
      significantDigits: "6829",
    });
  });

  it("trims trailing zeros in the significant digits (round value)", () => {
    // 1e-7 → 4-sig mantissa "1.000" → "1" after trim, 6 leading zeros.
    expect(compactPriceParts(0.0000001)).toMatchObject({
      kind: "compact",
      leadingZeros: 6,
      significantDigits: "1",
    });
  });

  it("keeps negatives with the true minus U+2212, unsigned magnitude in the parts", () => {
    expect(compactPriceParts(-0.000000000063)).toEqual({
      kind: "compact",
      sign: "−",
      intPart: "0",
      leadingZeros: 10,
      significantDigits: "63",
    });
  });

  it("leaves normal-magnitude values plain (≥ 1e-4 is short enough already)", () => {
    expect(compactPriceParts(0.00034)).toEqual({ kind: "plain", sign: "", abs: 0.00034 });
    expect(compactPriceParts(0.031)).toEqual({ kind: "plain", sign: "", abs: 0.031 });
    expect(compactPriceParts(1.5)).toEqual({ kind: "plain", sign: "", abs: 1.5 });
  });

  it("boundary: exactly 1e-4 (3 leading zeros) stays plain, just below it compacts", () => {
    expect(compactPriceParts(0.0001)).toEqual({ kind: "plain", sign: "", abs: 0.0001 });
    expect(compactPriceParts(0.00009)).toMatchObject({ kind: "compact", leadingZeros: 4 });
  });

  it("boundary: a rounding carry back up to 1e-4 falls back to plain", () => {
    // 0.000099999 rounds (4 sig) to 0.0001 → 3 leading zeros → NOT compacted.
    expect(compactPriceParts(0.000099999)).toEqual({
      kind: "plain",
      sign: "",
      abs: 0.000099999,
    });
  });

  it("handles zero, null, undefined and NaN cleanly", () => {
    expect(compactPriceParts(0)).toEqual({ kind: "plain", sign: "", abs: 0 });
    expect(compactPriceParts(null)).toEqual({ kind: "empty" });
    expect(compactPriceParts(undefined)).toEqual({ kind: "empty" });
    expect(compactPriceParts(Number.NaN)).toEqual({ kind: "empty" });
  });
});

describe("subscriptCount", () => {
  it("renders unicode subscript digits by default", () => {
    expect(subscriptCount(10)).toBe("₁₀");
    expect(subscriptCount(5)).toBe("₅");
  });
  it("renders an ASCII paren fallback for non-glyph contexts", () => {
    expect(subscriptCount(10, "paren")).toBe("(10)");
  });
});

describe("formatPriceCompact — plain string (aria / tooltips / chart axis)", () => {
  it("renders the unicode subscript form by default", () => {
    expect(formatPriceCompact(0.000000000063)).toBe("0.0₁₀63");
  });

  it("renders the ASCII fallback when asked (aria-labels)", () => {
    expect(formatPriceCompact(0.000000000063, { subscript: "paren" })).toBe("0.0(10)63");
  });

  it("appends an optional unit suffix", () => {
    expect(formatPriceCompact(0.000000000063, { unit: "ETH" })).toBe("0.0₁₀63 ETH");
  });

  it("prefixes the true minus for negatives", () => {
    expect(formatPriceCompact(-0.000000000063, { subscript: "paren" })).toBe("−0.0(10)63");
  });

  it("normal magnitude uses the default 2-sig plain price format (never e-notation)", () => {
    expect(formatPriceCompact(0.00034)).toBe("0.00034");
    expect(formatPriceCompact(0.031)).toBe("0.031");
    expect(formatPriceCompact(0)).toBe("0.0");
  });

  it("honors a caller-supplied plain formatter (amount style)", () => {
    expect(formatPriceCompact(0.42, { plain: (abs) => abs.toFixed(4) })).toBe("0.4200");
  });

  it("returns an em-dash for empty input", () => {
    expect(formatPriceCompact(null)).toBe("—");
    expect(formatPriceCompact(Number.NaN)).toBe("—");
  });
});

describe("<PriceEth> — JSX subscript renderer", () => {
  afterEach(cleanup);

  it("renders a real <sub> carrying the zero count, with an ASCII aria-label", () => {
    const { container } = render(<PriceEth value={0.000000000063} unit="ETH" />);
    const sub = container.querySelector("sub");
    expect(sub?.textContent).toBe("10");
    // The visible glyphs are aria-hidden; the accessible name is the ASCII form.
    const labelled = container.querySelector("[aria-label]");
    expect(labelled?.getAttribute("aria-label")).toBe("0.0(10)63 ETH");
    expect(screen.getByText("ETH")).toBeTruthy();
  });

  it("renders tiny wei amounts compactly (event-tape amount path)", () => {
    // 63 wei = 6.3e-17 ETH → 16 leading zeros.
    const { container } = render(<PriceEth wei="63" unit="ETH" decimals={4} />);
    expect(container.querySelector("sub")?.textContent).toBe("16");
  });

  it("keeps normal-magnitude values plain (no <sub>), amount style zero-pads", () => {
    const { container } = render(<PriceEth wei="420000000000000000" unit="ETH" decimals={4} />);
    expect(container.querySelector("sub")).toBeNull();
    expect(screen.getByText("0.4200")).toBeTruthy();
  });

  it("renders a plain 2-sig price at normal magnitude by default", () => {
    render(<PriceEth value={0.00034} />);
    expect(screen.getByText("0.00034")).toBeTruthy();
  });

  it("renders an em-dash for a null price, never a fabricated number", () => {
    render(<PriceEth value={null} />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});
