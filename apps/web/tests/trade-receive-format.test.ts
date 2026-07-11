import { parseUnits } from "viem";
import { describe, expect, it } from "vitest";

import { formatReceiveTokenAmount } from "@/widgets/trade-widget/lib/format-receive";

/**
 * YOU RECEIVE preview format (fidelity fix 13 — mockup template 2a line 418):
 * grouped + exactly 1 decimal for values ≥ 1 ("1,462.8"), never compact
 * ("1.46K"); sub-1 values keep significant precision instead of collapsing to
 * "0.0".
 */
describe("formatReceiveTokenAmount (trade-widget receive box)", () => {
  it("renders the mockup sample: 1462.8 → '1,462.8' (grouped, 1 decimal)", () => {
    expect(formatReceiveTokenAmount(parseUnits("1462.8", 18))).toBe("1,462.8");
  });

  it("never renders compact notation for large amounts", () => {
    const text = formatReceiveTokenAmount(parseUnits("1460000", 18));
    expect(text).toBe("1,460,000.0");
    expect(text).not.toMatch(/[KMB]/i);
  });

  it("values ≥ 1 get exactly one decimal, zero-padded", () => {
    expect(formatReceiveTokenAmount(parseUnits("5", 18))).toBe("5.0");
    expect(formatReceiveTokenAmount(parseUnits("12.34", 18))).toBe("12.3");
  });

  it("sub-1 values keep significant precision (not collapsed to '0.0')", () => {
    expect(formatReceiveTokenAmount(parseUnits("0.042153", 18))).toBe("0.04215");
    expect(formatReceiveTokenAmount(parseUnits("0.5", 18))).toBe("0.5000");
  });

  it("zero renders as the placeholder-compatible '0.0'", () => {
    expect(formatReceiveTokenAmount(0n)).toBe("0.0");
  });
});
