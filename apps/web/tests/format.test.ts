import { describe, expect, it } from "vitest";
import type { UsdValue } from "@robbed/shared";

import {
  formatAge,
  formatEthFromWei,
  formatPercent,
  formatTokenFromWei,
  formatUsd,
  shortAddress,
} from "@/shared/lib/format";

describe("format helpers", () => {
  it("formats ETH from wei to significant decimals", () => {
    expect(formatEthFromWei(10n ** 18n)).toBe("1");
    expect(formatEthFromWei(1_500_000_000_000_000_000n)).toBe("1.5");
    expect(formatEthFromWei(0n)).toBe("0");
  });

  it("formats token amounts compactly", () => {
    expect(formatTokenFromWei(1_240_000n * 10n ** 18n)).toBe("1.24M");
  });

  it("formats signed percentages", () => {
    expect(formatPercent(12.34, { signed: true })).toBe("+12.3%");
    expect(formatPercent(-4, { signed: true })).toBe("-4.0%");
    expect(formatPercent(null)).toBe("—");
  });

  it("formats ages", () => {
    const now = 1_000_000_000_000;
    expect(formatAge(Math.floor(now / 1000) - 30, now)).toBe("30s");
    expect(formatAge(Math.floor(now / 1000) - 3600, now)).toBe("1h");
  });

  it("shortens addresses", () => {
    expect(shortAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73")).toBe(
      "0x0Bd7…AD73",
    );
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
