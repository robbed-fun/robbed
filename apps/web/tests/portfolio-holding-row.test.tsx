import type { PortfolioHolding } from "@robbed/shared";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HoldingRow, holdingColumns } from "@/entities/portfolio";

/**
 * `HoldingRow` renders the mockup's TOKEN/BALANCE/PRICE/VALUE/PNL cells and,
 * critically, degrades an UNPRICEABLE holding to em-dashes instead of inventing
 * a price/value (§2, §5.2). It is driven by a `@tanstack/react-table` row model,
 * so the test builds a one-row table (`holdingColumns`) and hands the row to the
 * component. The row renders twice (md grid + mobile card), so assertions use
 * `getAllByText`.
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

/** Renders `HoldingRow` from a real table row model (matches HoldingsTab wiring). */
function RowHarness({ data }: { data: PortfolioHolding }) {
  const table = useReactTable({
    data: [data],
    columns: holdingColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.token.address,
  });
  return <HoldingRow row={table.getRowModel().rows[0]!} />;
}

describe("HoldingRow", () => {
  it("renders the token name, grouped balance, price, ETH value and signed PnL", () => {
    render(<RowHarness data={holding()} />);
    // The mockup's TOKEN column shows the token NAME (docs/Robbed.html "2c").
    expect(screen.getAllByText("Hoodcat").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4,120,551").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.00034").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1.40").length).toBeGreaterThan(0); // ETH value, 2-dec mockup contract
    expect(screen.getAllByText("+0.62").length).toBeGreaterThan(0); // green gain
  });

  it("flags a graduated token as trading on the AMM", () => {
    render(<RowHarness data={holding({ token: { ...holding().token, graduated: true } })} />);
    expect(screen.getAllByText("AMM").length).toBeGreaterThan(0);
  });

  it("unpriceable holding → em-dash price/value/PnL, no fabricated numbers", () => {
    render(
      <RowHarness
        data={holding({ priceEth: null, valueEth: null, value: null, unrealizedPnl: null })}
      />,
    );
    // Balance is Transfer-truth and still shows; price/value/PnL fall back to —.
    expect(screen.getAllByText("4,120,551").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("1.4")).toBeNull();
  });
});
