"use client";

import {
  type ColumnDef,
  type Row,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Fragment, type ReactNode } from "react";

/**
 * Reusable headless table (TanStack Table v8, tanstack.com/table — docs-first).
 *
 * Wraps `useReactTable` once so every ROBBED_ table (event tape, trades, holders,
 * portfolio holdings/activity) shares the same row-model plumbing and can't
 * re-introduce the class of bug that froze Discover: passing an UNSTABLE `data`
 * (or `columns`) reference every render makes the table rebuild its row model
 * (and, with `autoReset*` on, flip internal state) on every render → a silent
 * CPU-pegging re-render churn with no console error.
 *
 * CONTRACT (enforced by convention + guarded below):
 * - `data` and `columns` MUST be stable references — memoize them in the caller
 *   (`useMemo`), only recomputing when their inputs actually change.
 * - `autoReset*` is disabled here so a data swap never triggers an internal
 *   state reset → render loop (these tables don't page/expand on data change).
 *
 * The component is render-agnostic: it computes the visible rows + their cells
 * (via `flexRender` over the typed `ColumnDef` cells) and hands them to `renderRow`
 * so callers keep their exact markup (the tape's clickable `<Link>` rows, a grid
 * row, a mobile card — whatever). Renders a semantic `<ul>`/`<li>` list by default.
 */
export function DataTable<T>({
  data,
  columns,
  getRowId,
  renderRow,
  empty,
  className,
  "aria-label": ariaLabel,
}: {
  /** MUST be a stable reference (memoize in the caller). */
  data: T[];
  /** MUST be a stable reference (memoize in the caller). */
  columns: ColumnDef<T>[];
  /** Stable row identity (e.g. `(row) => row.id`) — keeps keys + row model sane. */
  getRowId?: (row: T, index: number) => string;
  /**
   * Render one row. Receives the TanStack `Row`, the pre-rendered `cells`
   * (from the column model via `flexRender`), and the visible index. Return the
   * row's inner markup (the `<li>` wrapper + key are supplied by DataTable).
   */
  renderRow: (args: { row: Row<T>; cells: ReactNode; index: number }) => ReactNode;
  /** Shown when there are no rows. */
  empty?: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    // Defensive: a data swap must never reset internal state → re-render loop.
    autoResetPageIndex: false,
    autoResetExpanded: false,
  });

  const rows = table.getRowModel().rows;

  if (rows.length === 0) return <>{empty ?? null}</>;

  return (
    <ul className={className} aria-label={ariaLabel}>
      {rows.map((row, index) => {
        const cells = row.getVisibleCells().map((cell) => (
          <Fragment key={cell.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </Fragment>
        ));
        return <li key={row.id}>{renderRow({ row, cells, index })}</li>;
      })}
    </ul>
  );
}
