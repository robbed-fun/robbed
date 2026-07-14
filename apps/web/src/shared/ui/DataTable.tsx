"use client";

import {
  type ColumnDef,
  type Row,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Fragment, type ReactNode } from "react";

import type { TableSortMeta } from "@/shared/lib/table";
import { cn } from "@/shared/lib/utils";
import { Pagination, type PaginationControls } from "./Pagination";

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
 * SERVER-SIDE ONLY : `manualSorting` is on — the table NEVER client-sorts.
 * Column headers dispatch a `?sort=&dir=` refetch via `meta` (TableSortMeta);
 * pagination is keyset over an opaque cursor. Both are threaded through, not owned
 * here — the caller's `useCursorStack` + query own the data.
 *
 * CONVENTION: the optional `tableLabel` (a titled header/caption region)
 * and the integrated `Pagination` mean every titled, paged table on token-detail
 * (Top Holders, trade feed) and elsewhere renders its chrome through ONE component.
 */

/** Titled-table wrapper (`TableLabel`). Also exported standalone. */
export function TableLabel({
  title,
  right,
  children,
  className,
}: {
  title: ReactNode;
  /** Trailing region on the title row (count, live dot, …). */
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        {typeof title === "string" ? (
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        ) : (
          title
        )}
        {right}
      </div>
      {children}
    </section>
  );
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  renderRow,
  renderHeader,
  empty,
  className,
  "aria-label": ariaLabel,
  tableLabel,
  meta,
  pagination,
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
  /**
   * Optional header row. Receives the pre-rendered header cells (each column's
   * `header` fn via `flexRender`, so sort affordances read `meta` from context)
   * and returns the header markup — the CALLER owns the grid layout so the
   * table's DOM/columns stay byte-identical to the mockup.
   */
  renderHeader?: (cells: ReactNode) => ReactNode;
  /** Shown when there are no rows (the header + pager still render around it). */
  empty?: ReactNode;
  className?: string;
  "aria-label"?: string;
  /** Titled wrapper. */
  tableLabel?: { title: ReactNode; right?: ReactNode };
  /** Server-sort context threaded to header cells (TableSortMeta). */
  meta?: TableSortMeta<string>;
  /** Integrated keyset pager — rendered below the rows when present. */
  pagination?: PaginationControls & { className?: string };
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    // Server-authoritative order : the table renders the returned order
    // and never client-sorts; header clicks refetch via `meta.onSort`.
    manualSorting: true,
    // Defensive: a data swap must never reset internal state → re-render loop.
    autoResetPageIndex: false,
    autoResetExpanded: false,
    meta,
  });

  const rows = table.getRowModel().rows;

  const headerCells = renderHeader
    ? (table.getHeaderGroups()[0]?.headers ?? []).map((header) => (
        <Fragment key={header.id}>
          {flexRender(header.column.columnDef.header, header.getContext())}
        </Fragment>
      ))
    : null;

  const body =
    rows.length === 0 ? (
      <>{empty ?? null}</>
    ) : (
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

  const content = (
    <>
      {renderHeader && headerCells ? renderHeader(headerCells) : null}
      {body}
      {pagination ? <Pagination {...pagination} /> : null}
    </>
  );

  if (tableLabel) {
    return (
      <TableLabel title={tableLabel.title} right={tableLabel.right}>
        {content}
      </TableLabel>
    );
  }
  return content;
}
