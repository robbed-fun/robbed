"use client";

import { MonoLabel } from "./MonoText";
import { cn } from "@/shared/lib/utils";

/**
 * Standalone reusable keyset pager. Business-agnostic: it renders Prev /
 * Next affordances and calls back — it NEVER sees or parses the opaque cursor (the
 * caller's `useCursorStack` owns that; note 1). The common `DataTable`
 * integrates this, and any other paged surface can render it directly.
 *
 * Single-page tables render nothing (no `hasPrev`/`hasNext`) so an un-paginated
 * caller pays no visual cost.
 */
export interface PaginationControls {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Disables both controls while a page is in flight (avoids double-advance). */
  isFetching?: boolean;
  /** 0-based page index — rendered as "Page N" between the controls. */
  pageIndex?: number;
}

export function Pagination({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  isFetching = false,
  pageIndex,
  className,
}: PaginationControls & { className?: string }) {
  if (!hasPrev && !hasNext) return null;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex items-center justify-between gap-2 border-t border-border-soft pt-2.5",
        className,
      )}
    >
      <PagerButton onClick={onPrev} disabled={!hasPrev || isFetching}>
        ← Prev
      </PagerButton>
      {pageIndex !== undefined && (
        <MonoLabel size="2xs" className="text-text-tertiary">
          Page {pageIndex + 1}
        </MonoLabel>
      )}
      <PagerButton onClick={onNext} disabled={!hasNext || isFetching}>
        Next →
      </PagerButton>
    </nav>
  );
}

function PagerButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-sm border border-border px-2.5 py-1 text-xs text-text-secondary transition-colors",
        "hover:bg-surface hover:text-text disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}
