"use client";

import type { TableSortMeta } from "@/shared/lib/table";
import { MonoLabel } from "./MonoText";
import { cn } from "@/shared/lib/utils";

/**
 * Sortable column-header button (§12.59). Clicking dispatches a SERVER-SIDE sort
 * (`meta.onSort(field)` → widget recomputes `nextSort` + refetches with
 * `?sort=&dir=`); the browser never re-ranks. The active column shows an asc/desc
 * glyph; idle columns show a faint neutral glyph as the sortable affordance.
 *
 * Presentational only: the widget passes the live `TableSortMeta` (read from
 * TanStack `ctx.table.options.meta` inside the column's `header` fn), so the
 * module-level column defs stay stable.
 */
export function SortHeader({
  label,
  field,
  meta,
  align = "left",
  className,
}: {
  label: string;
  /** A field from the endpoint's sort allowlist (kept as `string` so any
   *  per-table `SortField` enum passes without generic variance friction). */
  field: string;
  meta: TableSortMeta<string>;
  align?: "left" | "right";
  className?: string;
}) {
  const active = meta.sort?.field === field;
  const dir = active ? meta.sort!.dir : undefined;

  return (
    <button
      type="button"
      onClick={() => meta.onSort?.(field)}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "group inline-flex items-center gap-1",
        align === "right" && "flex-row-reverse",
        className,
      )}
    >
      <MonoLabel size="2xs" className={cn(active && "text-text")}>
        {label}
      </MonoLabel>
      <SortGlyph active={active} dir={dir} />
    </button>
  );
}

function SortGlyph({ active, dir }: { active: boolean; dir?: "asc" | "desc" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "text-[9px] leading-none transition-colors",
        active
          ? "text-green"
          : "text-text-tertiary opacity-0 group-hover:opacity-60",
      )}
    >
      {active ? (dir === "asc" ? "▲" : "▼") : "▼"}
    </span>
  );
}
