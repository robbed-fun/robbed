"use client";

import { useSearchParams } from "next/navigation";

import { SearchBox } from "./SearchBox";

/**
 * SearchBox seeded from the URL `?q=` — the creator-click deep link (
 * DISC-4 as amended by) `TokenCard` pushes `/?q=<creator>` and this
 * component closes the round-trip by reading the param back into the box.
 *
 * DECISION (docs-first, nextjs.org/docs/app/api-reference/functions/use-search-params,
 * verified 2026-07-12): `useSearchParams` in a Client Component on a statically
 * prerendered route MUST sit under a `<Suspense>` boundary, otherwise `next
 * build` fails with "Missing Suspense boundary with useSearchParams". The hook
 * is isolated HERE (not in `SearchBox`, which stays a pure controlled feature
 * component usable anywhere) so callers wrap ONLY this thin reader in Suspense
 * — the fallback renders the un-seeded `SearchBox`, visually identical. On
 * client navigations (`router.push("/?q=…")`) the hook re-renders with the new
 * value and `SearchBox`'s `initialQ` effect re-seeds + opens the dropdown.
 */
export function UrlSeededSearchBox(props: {
  className?: string;
  inputClassName?: string;
}) {
  // `?? null` guard: outside a `/pages` migration this is always non-null, but
  // the API type allows null — degrade to an empty seed, never throw.
  const q = useSearchParams()?.get("q") ?? "";
  return <SearchBox initialQ={q} {...props} />;
}
