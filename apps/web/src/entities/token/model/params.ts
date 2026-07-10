import {
  type tokenFilterSchema,
  type tokenSortSchema,
  tokenFilterSchema as filterSchema,
  tokenSortSchema as sortSchema,
} from "@robbed/shared";
import type { z } from "zod";

/**
 * Discover URL-state (§5.1 "sort/filter/search state lives in URL searchParams —
 * shareable, back-button correct, SSR-consistent"). SINGLE parser used by BOTH
 * the server page (`app/page.tsx`, awaits `searchParams`) and the client controls
 * (`useSearchParams`) so SSR and client can never disagree on the active state.
 * Sort/filter vocabularies come from the shared zod enums — never redeclared.
 */

export type TokenSort = z.infer<typeof tokenSortSchema>;
export type TokenFilter = z.infer<typeof tokenFilterSchema>;

export const DEFAULT_SORT: TokenSort = "trending";
export const DEFAULT_FILTER: TokenFilter = "all";

/** Human labels for the tab bars (§5.1 "trending | newest | mcap | 24h volume | progress"). */
export const SORT_LABELS: Record<TokenSort, string> = {
  trending: "Trending",
  newest: "Newest",
  mcap: "Mcap",
  volume24h: "24h Volume",
  progress: "Progress",
};

export const FILTER_LABELS: Record<TokenFilter, string> = {
  pregrad: "Pre-grad",
  graduated: "Graduated",
  all: "All",
};

export const SORT_ORDER: readonly TokenSort[] = [
  "trending",
  "newest",
  "mcap",
  "volume24h",
  "progress",
];
export const FILTER_ORDER: readonly TokenFilter[] = ["all", "pregrad", "graduated"];

function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseSort(v: string | string[] | undefined): TokenSort {
  const parsed = sortSchema.safeParse(firstValue(v));
  return parsed.success ? parsed.data : DEFAULT_SORT;
}

export function parseFilter(v: string | string[] | undefined): TokenFilter {
  const parsed = filterSchema.safeParse(firstValue(v));
  return parsed.success ? parsed.data : DEFAULT_FILTER;
}

/** Build the `?sort=&filter=` query, omitting defaults for clean shareable URLs. */
export function buildDiscoverQuery(sort: TokenSort, filter: TokenFilter): string {
  const qs = new URLSearchParams();
  if (sort !== DEFAULT_SORT) qs.set("sort", sort);
  if (filter !== DEFAULT_FILTER) qs.set("filter", filter);
  const s = qs.toString();
  return s ? `?${s}` : "/";
}
