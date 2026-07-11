import { describe, expect, it } from "vitest";

import {
  formatBalance,
  formatFirstSeen,
  pnlTone,
  signedEth,
  signedEthFromWei,
} from "@/entities/portfolio";

/**
 * Portfolio display formatters (mockup "2c"). Pure functions over supplied
 * indexer/on-chain values — the discipline under test is HONEST rendering: no
 * false precision, explicit signs, and the mockup's grouped-integer balances.
 */

describe("formatBalance — grouped integer (mockup rows)", () => {
  it("groups whole token balances with no decimals", () => {
    // 4,120,551 tokens (18dp) → "4,120,551", matching the mockup verbatim.
    expect(formatBalance("4120551000000000000000000")).toBe("4,120,551");
    expect(formatBalance("61022000000000000000000")).toBe("61,022");
  });

  it("keeps a little precision for sub-unit dust and handles zero", () => {
    expect(formatBalance("0")).toBe("0");
    expect(formatBalance("120000000000000000")).toBe("0.12");
  });
});

describe("signedEth — leading + only for gains, 2-dec portfolio contract", () => {
  it("signs positives, uses true minus U+2212, and zero-pads to 2 decimals", () => {
    expect(signedEth(0.62)).toBe("+0.62");
    expect(signedEth(1.94)).toBe("+1.94"); // mockup LOOT "+1.94 ETH"
    expect(signedEth(-0.07)).toBe("−0.07"); // U+2212, never hyphen-minus
    expect(signedEth(-0.07)).not.toContain("-");
    expect(signedEth(0)).toBe("0.00");
  });

  it("reads wei bounds (PnL is wei)", () => {
    expect(signedEthFromWei("620000000000000000")).toBe("+0.62");
    expect(signedEthFromWei("-70000000000000000")).toBe("−0.07");
  });
});

describe("pnlTone — commits a sign only when the whole range agrees", () => {
  it("all-gain → green, all-loss → red, straddling/zero → muted", () => {
    expect(pnlTone(0.5, 0.7)).toBe("green");
    expect(pnlTone(-0.5, -0.1)).toBe("red");
    expect(pnlTone(-0.1, 0.3)).toBe("muted"); // no false win/loss for a straddle
    expect(pnlTone(0, 0)).toBe("muted");
  });
});

describe("formatFirstSeen — coarse account age", () => {
  const NOW = 1_700_000_000_000; // fixed ms

  it("months / days / just-now, and null → new here", () => {
    const nowSec = Math.floor(NOW / 1000);
    expect(formatFirstSeen(nowSec - 3 * 2_592_000, NOW)).toBe("first seen 3mo ago");
    expect(formatFirstSeen(nowSec - 5 * 86_400, NOW)).toBe("first seen 5d ago");
    expect(formatFirstSeen(nowSec - 30, NOW)).toBe("first seen just now");
    expect(formatFirstSeen(null, NOW)).toBe("new here");
  });
});
