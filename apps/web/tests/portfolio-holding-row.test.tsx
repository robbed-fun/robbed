import type { PortfolioHolding } from "@robbed/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HoldingRow } from "@/entities/portfolio";

/**
 * `HoldingRow` renders the mockup's TOKEN/BALANCE/PRICE/VALUE/PNL cells and,
 * critically, degrades an UNPRICEABLE holding to em-dashes instead of inventing
 * a price/value (§2, §5.2). The row renders twice (md grid + mobile card), so
 * assertions use `getAllByText`.
 */

afterEach(cleanup);

const holding = (over: Partial<PortfolioHolding> = {}): PortfolioHolding => ({
  token: {
    address: "0x00000000000000000000000000000000000000aa",
    name: "Hoodcat",
    ticker: "HOODCAT",
    imageUrl: null,
    graduated: false,
    status: "curve",
  },
  balance: "4120551000000000000000000",
  priceEth: 0.00034,
  valueEth: "1400000000000000000",
  value: { usd: "4830", ethUsd: "3450", asOf: "2026-07-10T00:00:00Z" },
  unrealizedPnl: { low: "620000000000000000", high: "620000000000000000", confidence: "exact" },
  ...over,
});

describe("HoldingRow", () => {
  it("renders ticker, grouped balance, price, ETH value and signed PnL", () => {
    render(<HoldingRow holding={holding()} />);
    expect(screen.getAllByText("HOODCAT").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4,120,551").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.00034").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1.4").length).toBeGreaterThan(0); // ETH value
    expect(screen.getAllByText("+0.62").length).toBeGreaterThan(0); // green gain
  });

  it("flags a graduated token as trading on the AMM", () => {
    render(<HoldingRow holding={holding({ token: { ...holding().token, graduated: true } })} />);
    expect(screen.getAllByText("AMM").length).toBeGreaterThan(0);
  });

  it("unpriceable holding → em-dash price/value/PnL, no fabricated numbers", () => {
    render(
      <HoldingRow
        holding={holding({ priceEth: null, valueEth: null, value: null, unrealizedPnl: null })}
      />,
    );
    // Balance is Transfer-truth and still shows; price/value/PnL fall back to —.
    expect(screen.getAllByText("4,120,551").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("1.4")).toBeNull();
  });
});
