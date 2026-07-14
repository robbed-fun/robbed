"use client";

import type { SortDir } from "@robbed/shared";
import { useCallback, useState } from "react";

/**
 * Server-side sortable + keyset-paginated table primitives — the FE half
 * of the shared `tradeListQuerySchema` / `holderListQuerySchema` contract. PURE +
 * headless: these carry NO business knowledge (which fields, which endpoint) — the
 * widgets supply the field enum. Unit-tested in tests/table-state.test.ts.
 *
 * HARD RULE : sort is SERVER-SIDE only. A header click dispatches a
 * new `?sort=&dir=` and refetches; the browser NEVER re-ranks. `nextSort` only
 * computes the NEXT (field, dir) request — it never touches row data.
 */

export type { SortDir };

/** Active (field, dir) request for a server-sorted table. */
export interface SortState<F extends string = string> {
  field: F;
  dir: SortDir;
}

/**
 * The sort request AFTER clicking `field`'s header:
 *  - clicking the ACTIVE column flips its direction (desc ⇄ asc);
 *  - clicking a NEW column sorts it in `defaultDir` (desc — "biggest first").
 * Pure: derives only the next request, never re-sorts rows (that is the server's
 * job —). Proven in tests/table-state.test.ts.
 */
export function nextSort<F extends string>(
  current: SortState<F> | undefined,
  field: F,
  defaultDir: SortDir = "desc",
): SortState<F> {
  if (current && current.field === field) {
    return { field, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { field, dir: defaultDir };
}

/** True when `a` equals the default sort — i.e. the WS-live, SSR-seeded window. */
export function isDefaultSort<F extends string>(
  a: SortState<F>,
  def: SortState<F>,
): boolean {
  return a.field === def.field && a.dir === def.dir;
}

/**
 * Table sort context threaded to the common `DataTable` via TanStack `meta`, so
 * the module-level (stable) column defs stay stable while header cells read the
 * live sort state from render context (`ctx.table.options.meta`).
 */
export interface TableSortMeta<F extends string = string> {
  sort?: SortState<F>;
  /** Dispatch a header click — the widget computes `nextSort` + resets the page. */
  onSort?: (field: F) => void;
}

/**
 * Opaque forward keyset-cursor page stack. Holds the OPAQUE `nextCursor`
 * strings the API returns, one per visited page — it NEVER parses or constructs a
 * cursor (the API is the sole signer/decoder, note 1). `null` is page 1
 * (no cursor). `next(c)` pushes the server's opaque `nextCursor`; `prev()` pops.
 */
export function useCursorStack() {
  const [stack, setStack] = useState<(string | null)[]>([null]);
  const cursor = stack[stack.length - 1] ?? null;

  const next = useCallback((opaqueCursor: string) => {
    setStack((s) => [...s, opaqueCursor]);
  }, []);
  const prev = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  const reset = useCallback(() => {
    setStack((s) => (s.length === 1 && s[0] === null ? s : [null]));
  }, []);

  return {
    /** Opaque cursor for the CURRENT page (null on page 1). */
    cursor,
    /** 0-based page index (0 = first page). */
    pageIndex: stack.length - 1,
    hasPrev: stack.length > 1,
    next,
    prev,
    reset,
  };
}
