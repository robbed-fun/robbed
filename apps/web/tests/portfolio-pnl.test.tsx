import type { EthPnlRange } from "@robbed/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PnlRange } from "@/entities/portfolio";

/**
 * `PnlRange` renders the API's `EthPnlRange | null` HONESTLY (§5.2 — no false
 * precision): null → placeholder (not "0"), exact → a single signed value, a
 * true range → `low…high`, and the tone is committed only when the range shares
 * a sign.
 */

afterEach(cleanup);

const range = (over: Partial<EthPnlRange>): EthPnlRange => ({
  low: "620000000000000000",
  high: "620000000000000000",
  confidence: "exact",
  ...over,
});

describe("PnlRange", () => {
  it("null → faint placeholder, never a fabricated zero", () => {
    render(<PnlRange range={null} />);
    const el = screen.getByText("—");
    expect(el.className).toContain("text-faint");
    expect(el.getAttribute("title")).toBe("no cost basis");
  });

  it("exact single value → one signed figure, green for a gain", () => {
    render(<PnlRange range={range({})} />);
    const el = screen.getByText("+0.62");
    expect(el.className).toContain("text-green");
    expect(el.getAttribute("title")).toContain("exact");
  });

  it("a true range → low…high with the estimated disclosure", () => {
    render(
      <PnlRange
        range={range({
          low: "500000000000000000",
          high: "700000000000000000",
          confidence: "estimated",
        })}
      />,
    );
    const el = screen.getByText("+0.50…+0.70");
    expect(el.className).toContain("text-green");
    expect(el.getAttribute("title")).toContain("estimated");
  });

  it("all-loss range → red, with true minus U+2212", () => {
    render(
      <PnlRange
        range={range({ low: "-70000000000000000", high: "-70000000000000000" })}
      />,
    );
    expect(screen.getByText("−0.07").className).toContain("text-red");
  });

  it("unit='ETH' → LOOT ALL-TIME shape '+0.62 ETH', unit inside the toned span", () => {
    render(<PnlRange range={range({})} unit="ETH" />);
    // Unit is a child span so it inherits the number's color (mockup one-color cell).
    const unitEl = screen.getByText("ETH");
    const el = unitEl.parentElement!;
    expect(el.textContent).toBe("+0.62ETH"); // visual gap is ml-1, not a text space
    expect(el.className).toContain("text-green");
  });

  it("unit is suppressed for the null placeholder (no '— ETH')", () => {
    render(<PnlRange range={null} unit="ETH" />);
    expect(screen.getByText("—").textContent).toBe("—");
    expect(screen.queryByText("ETH")).toBeNull();
  });

  it("a range straddling zero stays muted (no false win/loss)", () => {
    render(
      <PnlRange
        range={range({
          low: "-100000000000000000",
          high: "300000000000000000",
          confidence: "estimated",
        })}
      />,
    );
    expect(screen.getByText("−0.10…+0.30").className).toContain("text-muted");
  });
});
