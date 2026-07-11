import { describe, expect, it } from "vitest";
import type { UsdValue } from "@robbed/shared";

import {
  formatAge,
  formatEthFromWei,
  formatEthNumber,
  formatPercent,
  formatTokenFromWei,
  formatUsd,
  shortAddress,
} from "@/shared/lib/format";

/**
 * WAVE-1 mockup-faithful contract (docs/Robbed.html):
 * - ETH amounts zero-PADDED to fixed decimals (default 4 — "0.4200 ETH"),
 *   never trimmed; callers pass `decimals: 2` where the mockup shows 2
 *   ("1.40 ETH" portfolio values).
 * - Sub-0.0001 values: 2 significant digits retaining the trailing zero
 *   ("0.0000010 ETH" starting price).
 * - Negatives use true minus U+2212 ("−1.8%"), never hyphen-minus.
 */
describe("format helpers", () => {
  it("zero-pads ETH to 4 decimals by default, never trimming", () => {
    expect(formatEthFromWei(10n ** 18n)).toBe("1.0000");
    expect(formatEthFromWei(1_500_000_000_000_000_000n)).toBe("1.5000");
    expect(formatEthFromWei(420_000_000_000_000_000n)).toBe("0.4200"); // mockup tape
    expect(formatEthFromWei(1_200_000_000_000_000_000n)).toBe("1.2000"); // mockup tape
    expect(formatEthFromWei(80_000_000_000_000_000n)).toBe("0.0800"); // mockup tape
    expect(formatEthFromWei(0n)).toBe("0.0000");
  });

  it("supports the 2-decimal portfolio contract via `decimals`", () => {
    expect(formatEthFromWei(1_400_000_000_000_000_000n, { decimals: 2 })).toBe("1.40");
    expect(formatEthNumber(4.82, { decimals: 2 })).toBe("4.82"); // TOTAL VALUE
    expect(formatEthNumber(0.93, { decimals: 2 })).toBe("0.93");
  });

  it("renders tiny values (< 0.001) with 2 significant digits, trailing zero retained", () => {
    expect(formatEthNumber(0.000001)).toBe("0.0000010"); // mockup starting price
    expect(formatEthFromWei(1_000_000_000_000n)).toBe("0.0000010");
    expect(formatEthNumber(0.000012)).toBe("0.000012");
    expect(formatEthNumber(0.00034)).toBe("0.00034"); // mockup portfolio price
    expect(formatEthNumber(0.0005)).toBe("0.0005"); // mockup deploy cost: exact at 4dp stays 4dp
    expect(formatEthNumber(0.0012)).toBe("0.0012"); // ≥ 0.001 stays fixed-4
    expect(formatEthNumber(0.031)).toBe("0.0310"); // mockup portfolio price, padded
  });

  it("uses true minus U+2212 for negative ETH", () => {
    expect(formatEthNumber(-1.5)).toBe("−1.5000");
    expect(formatEthNumber(-1.5)).not.toContain("-"); // no ASCII hyphen-minus
  });

  it("formats token amounts compactly", () => {
    expect(formatTokenFromWei(1_240_000n * 10n ** 18n)).toBe("1.24M");
  });

  it("formats signed percentages with true minus for negatives", () => {
    expect(formatPercent(12.34, { signed: true })).toBe("+12.3%");
    expect(formatPercent(-4, { signed: true })).toBe("−4.0%"); // U+2212
    expect(formatPercent(-1.8)).toBe("−1.8%"); // mockup BAGEL delta
    expect(formatPercent(-1.8)).not.toContain("-");
    expect(formatPercent(null)).toBe("—");
  });

  it("formats ages", () => {
    const now = 1_000_000_000_000;
    expect(formatAge(Math.floor(now / 1000) - 30, now)).toBe("30s");
    expect(formatAge(Math.floor(now / 1000) - 3600, now)).toBe("1h");
  });

  it("shortens addresses with EIP-55 checksum casing (mockup wallet chip)", () => {
    expect(shortAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73")).toBe(
      "0x0Bd7…AD73",
    );
    // Checksummed BEFORE slicing — lowercase input still renders mixed-case.
    expect(shortAddress("0x0bd7d308f8e1639fab988df18a8011f41eacad73")).toBe(
      "0x0Bd7…AD73",
    );
    // The demo wallet fixture renders the mockup string exactly.
    expect(shortAddress("0x7fa300000000000000000000000000000010c92e")).toBe(
      "0x7fA3…c92E",
    );
    // Non-address strings pass through untouched.
    expect(shortAddress("not-an-address")).toBe("not-an-address");
  });
});

describe("formatUsd — never a bare USD figure (spec §2)", () => {
  it("throws without a live snapshot object", () => {
    expect(() => formatUsd(null)).toThrow(/live/i);
    expect(() => formatUsd(undefined)).toThrow();
  });

  it("renders with source + timestamp when a snapshot is present", () => {
    const v: UsdValue = { usd: "69000", ethUsd: "3450", asOf: "2026-07-10T00:00:00Z" };
    const out = formatUsd(v);
    expect(out.text).toContain("$");
    expect(out.asOf).toBe("2026-07-10T00:00:00Z");
    expect(out.ethUsd).toBe("3450");
    expect(out.stale).toBe(false);
  });

  it("surfaces the stale flag", () => {
    const v: UsdValue = {
      usd: "1",
      ethUsd: "1",
      asOf: "2026-07-10T00:00:00Z",
      stale: true,
    };
    expect(formatUsd(v).stale).toBe(true);
  });
});

describe("formatUsd — demo-mode compact (Gap 2), gated by NEXT_PUBLIC_MOCK_DATA", () => {
  const asOf = "2026-07-10T12:00:00.000Z";
  const usd = (n: string): UsdValue => ({ usd: n, ethUsd: "3200", asOf });

  it("prod path (flag off) keeps FULL precision", () => {
    const prev = process.env.NEXT_PUBLIC_MOCK_DATA;
    delete process.env.NEXT_PUBLIC_MOCK_DATA;
    expect(formatUsd(usd("610000")).text).toBe("$610,000");
    process.env.NEXT_PUBLIC_MOCK_DATA = prev;
  });

  it("demo path (flag on) renders compact, byte-for-byte matching the mockup labels", () => {
    const prev = process.env.NEXT_PUBLIC_MOCK_DATA;
    process.env.NEXT_PUBLIC_MOCK_DATA = "true";
    // Values + labels straight from docs/Robbed.html (ROBBED_ terminal).
    expect(formatUsd(usd("610000")).text).toBe("$610K");
    expect(formatUsd(usd("1200000")).text).toBe("$1.2M");
    expect(formatUsd(usd("4100000")).text).toBe("$4.1M");
    expect(formatUsd(usd("240000")).text).toBe("$240K");
    expect(formatUsd(usd("820000")).text).toBe("$820K");
    expect(formatUsd(usd("12000")).text).toBe("$12K");
    expect(formatUsd(usd("402000")).text).toBe("$402K");
    if (prev === undefined) delete process.env.NEXT_PUBLIC_MOCK_DATA;
    else process.env.NEXT_PUBLIC_MOCK_DATA = prev;
  });
});
