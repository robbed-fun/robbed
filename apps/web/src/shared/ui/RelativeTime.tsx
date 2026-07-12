"use client";

import { formatAge } from "@/shared/lib/format";
import { useNowTick } from "@/shared/lib/use-now";
import { cn } from "@/shared/lib/utils";

/**
 * Live-ticking relative age from a unix-seconds block timestamp (indexer time).
 * Hydration-safe (hardening fix, 2026-07-12): the server and the first client
 * render emit a deterministic placeholder — never a `Date.now()`-derived string,
 * which mismatched between SSR and hydration — and the real age fills right
 * after mount via `useNowTick` (no `suppressHydrationWarning` band-aid).
 * Never uses `block.number` (CLAUDE.md) — only timestamps.
 */
export function RelativeTime({
  unixSeconds,
  className,
}: {
  unixSeconds: number;
  className?: string;
}) {
  const now = useNowTick(30_000);
  return (
    <span className={cn("tabular-nums", className)}>
      {now === null ? "…" : formatAge(unixSeconds, now)}
    </span>
  );
}
