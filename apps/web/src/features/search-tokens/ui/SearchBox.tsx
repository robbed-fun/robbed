"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { TokenAvatar } from "@/shared/ui";
import { Input } from "@/shared/ui";
import { searchTokens } from "@/shared/api";
import { shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { qk } from "@/shared/lib/query-keys";
import { SEARCH_QUERY_MAX, SEARCH_QUERY_MIN } from "@robbed/shared";

/**
 * Search over name/ticker/contract/creator (§5.1; API pg_trgm, `GET /v1/search`).
 *
 * DECISIONS (hoodpad-frontend; basis recorded):
 * - Debounce 200ms (web.md §3.1) via a trailing timer on the input value, so we
 *   fire one request per settled query instead of per keystroke.
 * - `placeholderData: keepPreviousData` (TanStack Query v5, verified 2026-07-10)
 *   keeps the previous result list visible while the next query resolves — no
 *   dropdown flicker between keystrokes.
 * - Enter navigates to the best match = the API's first result (server ranks;
 *   the client never re-ranks). Results are the same `TokenCard` projection as
 *   `/tokens` (api.md §3.3), so no metric is recomputed here (§2).
 * - `initialQ` seeds the box from the URL `?q=` (creator-click deep links,
 *   shareable); the effect re-syncs when the deep link changes.
 */
export function SearchBox({
  initialQ = "",
  className,
  inputClassName,
}: {
  initialQ?: string;
  /** Root override (e.g. the app header drops the sm:max-w-xs cap — mockup 340px). */
  className?: string;
  /** Per-instance Input override (header uses 12px text; kit default untouched). */
  inputClassName?: string;
}) {
  const router = useRouter();
  const [raw, setRaw] = useState(initialQ);
  const [debounced, setDebounced] = useState(initialQ.trim());
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-seed from a new deep link (e.g. a creator-filter navigation).
  useEffect(() => {
    setRaw(initialQ);
    setDebounced(initialQ.trim());
    if (initialQ.trim().length >= SEARCH_QUERY_MIN) setOpen(true);
  }, [initialQ]);

  // Trailing 200ms debounce.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(raw.trim().slice(0, SEARCH_QUERY_MAX)), 200);
    return () => clearTimeout(t);
  }, [raw]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const enabled = debounced.length >= SEARCH_QUERY_MIN;
  const { data, isFetching, isError } = useQuery({
    queryKey: qk.search(debounced),
    queryFn: ({ signal }) => searchTokens(debounced, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

  const results = useMemo(() => data?.results ?? [], [data]);

  function goTo(address: string) {
    setOpen(false);
    router.push(`/t/${address}`);
  }

  return (
    <div ref={containerRef} className={cn("relative w-full sm:max-w-xs", className)}>
      <Input
        type="search"
        className={inputClassName}
        inputMode="search"
        placeholder="/ search tokens, addresses"
        value={raw}
        maxLength={SEARCH_QUERY_MAX}
        onChange={(e) => {
          setRaw(e.target.value);
          setOpen(true);
        }}
        onFocus={() => enabled && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) goTo(results[0].address);
          if (e.key === "Escape") setOpen(false);
        }}
        aria-label="Search tokens"
      />

      {open && enabled && (
        <div className="absolute z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {isError ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Search unavailable.</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {isFetching ? "Searching…" : "No matches."}
            </p>
          ) : (
            results.map((t) => (
              <button
                key={t.address}
                type="button"
                onClick={() => goTo(t.address)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-secondary"
              >
                <TokenAvatar
                  imageUrl={t.imageUrl}
                  name={t.name}
                  ticker={t.ticker}
                  size={24}
                  className="h-6 w-6"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t.name}</span>
                <span className="text-xs uppercase text-muted-foreground">{t.ticker}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {shortAddress(t.address)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
