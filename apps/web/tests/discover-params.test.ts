import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTER,
  DEFAULT_SORT,
  buildDiscoverQuery,
  parseFilter,
  parseSort,
} from "@/entities/token/model/params";

/**
 * URL-state parser/serializer (§5.1: sort/filter live in URL searchParams —
 * shareable, SSR-consistent). The vocabularies come from the shared zod enums,
 * so an unknown value degrades to the default rather than throwing.
 */
describe("discover URL state", () => {
  it("defaults when the param is absent", () => {
    expect(parseSort(undefined)).toBe(DEFAULT_SORT);
    expect(parseFilter(undefined)).toBe(DEFAULT_FILTER);
    expect(DEFAULT_SORT).toBe("trending");
    expect(DEFAULT_FILTER).toBe("all");
  });

  it("accepts every ratified sort + filter", () => {
    for (const s of ["trending", "newest", "mcap", "volume24h", "progress"]) {
      expect(parseSort(s)).toBe(s);
    }
    for (const f of ["pregrad", "graduated", "all"]) {
      expect(parseFilter(f)).toBe(f);
    }
  });

  it("degrades unknown / malformed values to the default", () => {
    expect(parseSort("bogus")).toBe(DEFAULT_SORT);
    expect(parseFilter("hacked")).toBe(DEFAULT_FILTER);
    expect(parseSort(["mcap", "newest"])).toBe("mcap"); // first value wins
  });

  it("omits defaults from the shareable query, includes non-defaults", () => {
    expect(buildDiscoverQuery("trending", "all")).toBe("/");
    expect(buildDiscoverQuery("mcap", "all")).toBe("?sort=mcap");
    expect(buildDiscoverQuery("trending", "pregrad")).toBe("?filter=pregrad");
    expect(buildDiscoverQuery("volume24h", "graduated")).toBe(
      "?sort=volume24h&filter=graduated",
    );
  });
});
