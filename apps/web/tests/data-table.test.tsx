import type { ColumnDef, HeaderContext } from "@tanstack/react-table";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataTable, SortHeader } from "@/shared/ui";
import type { TableSortMeta } from "@/shared/lib/table";

/**
 * Common DataTable upgrades: the `TableLabel` titled wrapper, header
 * cells that dispatch SERVER-SIDE sort (never client sort) with an asc/desc
 * affordance on the active column, and the integrated `Pagination` over an opaque
 * cursor (the pager never sees/parses it — it only fires callbacks).
 */

interface Row {
  id: string;
  name: string;
}

const metaOf = (ctx: HeaderContext<Row, unknown>) =>
  (ctx.table.options.meta ?? {}) as TableSortMeta<string>;

const columns: ColumnDef<Row>[] = [
  {
    id: "name",
    header: (ctx) => <SortHeader label="Name" field="name" meta={metaOf(ctx)} />,
    cell: ({ row }) => <span>{row.original.name}</span>,
  },
  {
    id: "amount",
    header: (ctx) => <SortHeader label="Amount" field="amount" meta={metaOf(ctx)} />,
    cell: () => <span>—</span>,
  },
];

const data: Row[] = [{ id: "1", name: "alice" }];

afterEach(cleanup);

describe("DataTable — TableLabel + server sort + pagination", () => {
  it("renders the TableLabel title and the sortable headers", () => {
    render(
      <DataTable<Row>
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        meta={{ sort: { field: "name", dir: "asc" }, onSort: () => {} }}
        tableLabel={{ title: "My Table" }}
        renderHeader={(cells) => <div>{cells}</div>}
        renderRow={({ cells }) => <div>{cells}</div>}
      />,
    );
    expect(screen.getByRole("heading", { name: "My Table" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Name/ })).toBeTruthy();
  });

  it("dispatches server-side sort on a header click (never client-sorts)", () => {
    const onSort = vi.fn();
    render(
      <DataTable<Row>
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        meta={{ sort: { field: "name", dir: "asc" }, onSort }}
        renderHeader={(cells) => <div>{cells}</div>}
        renderRow={({ cells }) => <div>{cells}</div>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Amount/ }));
    expect(onSort).toHaveBeenCalledWith("amount");
  });

  it("marks the active column with an asc/desc affordance", () => {
    const { rerender } = render(
      <DataTable<Row>
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        meta={{ sort: { field: "name", dir: "asc" }, onSort: () => {} }}
        renderHeader={(cells) => <div data-testid="hdr">{cells}</div>}
        renderRow={({ cells }) => <div>{cells}</div>}
      />,
    );
    const nameBtn = screen.getByRole("button", { name: /Name/ });
    expect(nameBtn.getAttribute("aria-sort")).toBe("ascending");
    expect(nameBtn.textContent).toContain("▲");

    rerender(
      <DataTable<Row>
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        meta={{ sort: { field: "name", dir: "desc" }, onSort: () => {} }}
        renderHeader={(cells) => <div data-testid="hdr">{cells}</div>}
        renderRow={({ cells }) => <div>{cells}</div>}
      />,
    );
    const nameBtn2 = screen.getByRole("button", { name: /Name/ });
    expect(nameBtn2.getAttribute("aria-sort")).toBe("descending");
    expect(nameBtn2.textContent).toContain("▼");
  });

  it("integrates Pagination — Next/Prev fire callbacks, cursor stays opaque to the pager", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(
      <DataTable<Row>
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        renderRow={({ cells }) => <div>{cells}</div>}
        pagination={{
          hasPrev: true,
          hasNext: true,
          onPrev,
          onNext,
          pageIndex: 1,
        }}
      />,
    );
    // The pager renders "Page N" (1-based) and never receives a cursor string.
    expect(screen.getByText("Page 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Prev/ }));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });
});
