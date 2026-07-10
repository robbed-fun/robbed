"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SearchBox } from "@/features/search-tokens";
import {
  FILTER_LABELS,
  FILTER_ORDER,
  SORT_LABELS,
  SORT_ORDER,
  type TokenFilter,
  type TokenSort,
  buildDiscoverQuery,
  parseFilter,
  parseSort,
} from "@/entities/token";
import { cn } from "@/shared/lib/utils";

/**
 * Sort/filter tab bars + search (§5.1). URL `searchParams` is the SINGLE source
 * of truth (shareable, back-button correct, SSR-consistent): tab clicks
 * `router.push` the new query with `scroll: false`, the server page re-reads the
 * awaited `searchParams`, and the grid re-seeds from the new SSR page. The same
 * shared parser (`params.ts`) is used here and on the server so the active tab
 * can never disagree with the rendered data.
 */
export function DiscoverControls() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sort = parseSort(searchParams.get("sort") ?? undefined);
  const filter = parseFilter(searchParams.get("filter") ?? undefined);
  const q = searchParams.get("q") ?? "";

  function setSort(next: TokenSort) {
    router.push(`${pathname}${buildDiscoverQuery(next, filter)}`, { scroll: false });
  }
  function setFilter(next: TokenFilter) {
    router.push(`${pathname}${buildDiscoverQuery(sort, next)}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTabs
          ariaLabel="Filter"
          items={FILTER_ORDER}
          labels={FILTER_LABELS}
          active={filter}
          onSelect={setFilter}
        />
        <SearchBox initialQ={q} />
      </div>
      <SegmentedTabs
        ariaLabel="Sort"
        items={SORT_ORDER}
        labels={SORT_LABELS}
        active={sort}
        onSelect={setSort}
      />
    </div>
  );
}

function SegmentedTabs<T extends string>({
  ariaLabel,
  items,
  labels,
  active,
  onSelect,
}: {
  ariaLabel: string;
  items: readonly T[];
  labels: Record<T, string>;
  active: T;
  onSelect: (v: T) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-secondary p-1"
    >
      {items.map((item) => {
        const isActive = item === active;
        return (
          <button
            key={item}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onSelect(item)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              isActive
                ? "bg-background text-foreground shadow"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {labels[item]}
          </button>
        );
      })}
    </div>
  );
}
