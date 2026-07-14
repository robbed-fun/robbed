import { describe, expect, it } from "vitest";

import { describeFeeSplit, formatBpsPercent } from "@/entities/curve";

/**
 * Trade-fee split presentation. Both bps components are read LIVE
 * (never hardcoded); this proves the pure formatter the SafetyStrip and the
 * /create panel share — treasury-only vs. treasury+creator, and the "unread" gate.
 */

describe("formatBpsPercent", () => {
  it("trims to a clean percent", () => {
    expect(formatBpsPercent(100)).toBe("1%");
    expect(formatBpsPercent(150)).toBe("1.5%");
    expect(formatBpsPercent(50)).toBe("0.5%");
    expect(formatBpsPercent(25)).toBe("0.25%");
    expect(formatBpsPercent(0)).toBe("0%");
  });
});

describe("describeFeeSplit", () => {
  it("treasury-only (creator 0) → no creator share", () => {
    const s = describeFeeSplit(100, 0)!;
    expect(s.hasCreatorShare).toBe(false);
    expect(s.totalPct).toBe("1%");
    expect(s.treasuryPct).toBe("1%");
    expect(s.creatorPct).toBe("0%");
    expect(s.totalBps).toBe(100);
  });

  it("splits treasury + creator and sums the total", () => {
    const s = describeFeeSplit(100, 50)!;
    expect(s.hasCreatorShare).toBe(true);
    expect(s.treasuryPct).toBe("1%");
    expect(s.creatorPct).toBe("0.5%");
    expect(s.totalPct).toBe("1.5%");
    expect(s.totalBps).toBe(150);
  });

  it("returns null when EITHER component is still unread (never fabricates 0)", () => {
    expect(describeFeeSplit(null, 0)).toBeNull();
    expect(describeFeeSplit(100, null)).toBeNull();
    expect(describeFeeSplit(null, null)).toBeNull();
  });
});
