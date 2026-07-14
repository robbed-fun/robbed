// @vitest-environment jsdom
// (this .ts file exercises a React hook via renderHook, so it needs the DOM env
// that the config otherwise scopes to *.test.tsx.)
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  type SortState,
  isDefaultSort,
  nextSort,
  useCursorStack,
} from "@/shared/lib/table";

/**
 * Server-side sort + keyset-pagination primitives. Pure `nextSort` /
 * `isDefaultSort` only compute the NEXT request (never re-rank rows), and
 * `useCursorStack` stores the API's OPAQUE cursor VERBATIM — it never parses or
 * constructs one (the API is the sole signer/decoder).
 */

describe("nextSort — computes the next server-sort request", () => {
  it("sorts a NEW column in the default direction (desc)", () => {
    const cur: SortState<"age" | "amount"> = { field: "age", dir: "desc" };
    expect(nextSort(cur, "amount")).toEqual({ field: "amount", dir: "desc" });
  });

  it("honours a caller-supplied default direction for a new column", () => {
    const cur: SortState<"amount" | "trader"> = { field: "amount", dir: "desc" };
    expect(nextSort(cur, "trader", "asc")).toEqual({ field: "trader", dir: "asc" });
  });

  it("flips direction when the ACTIVE column is clicked again", () => {
    expect(nextSort({ field: "age", dir: "desc" }, "age")).toEqual({
      field: "age",
      dir: "asc",
    });
    expect(nextSort({ field: "age", dir: "asc" }, "age")).toEqual({
      field: "age",
      dir: "desc",
    });
  });

  it("falls back to the default direction with no current sort", () => {
    expect(nextSort(undefined, "price")).toEqual({ field: "price", dir: "desc" });
  });
});

describe("isDefaultSort", () => {
  const def: SortState<"age"> = { field: "age", dir: "desc" };
  it("is true only for the exact default field + dir", () => {
    expect(isDefaultSort({ field: "age", dir: "desc" }, def)).toBe(true);
    expect(isDefaultSort({ field: "age", dir: "asc" }, def)).toBe(false);
  });
});

describe("useCursorStack — opaque forward keyset cursor", () => {
  it("starts on page 1 (null cursor), no prev", () => {
    const { result } = renderHook(() => useCursorStack());
    expect(result.current.cursor).toBeNull();
    expect(result.current.pageIndex).toBe(0);
    expect(result.current.hasPrev).toBe(false);
  });

  it("pushes the server's OPAQUE cursor verbatim on next(), pops on prev()", () => {
    const { result } = renderHook(() => useCursorStack());
    // An opaque HMAC-signed base64url cursor the FE must NOT parse.
    const opaque = "eyJrIjoiMTIzIiwiaSI6IjB4YWEtMSJ9.c2lnbmF0dXJl";

    act(() => result.current.next(opaque));
    expect(result.current.cursor).toBe(opaque); // stored byte-identical
    expect(result.current.pageIndex).toBe(1);
    expect(result.current.hasPrev).toBe(true);

    act(() => result.current.prev());
    expect(result.current.cursor).toBeNull();
    expect(result.current.pageIndex).toBe(0);
    expect(result.current.hasPrev).toBe(false);
  });

  it("reset() returns to page 1 from any depth", () => {
    const { result } = renderHook(() => useCursorStack());
    act(() => result.current.next("c1"));
    act(() => result.current.next("c2"));
    expect(result.current.pageIndex).toBe(2);
    act(() => result.current.reset());
    expect(result.current.pageIndex).toBe(0);
    expect(result.current.cursor).toBeNull();
  });

  it("prev() on page 1 is a no-op (never goes negative)", () => {
    const { result } = renderHook(() => useCursorStack());
    act(() => result.current.prev());
    expect(result.current.pageIndex).toBe(0);
    expect(result.current.hasPrev).toBe(false);
  });
});
