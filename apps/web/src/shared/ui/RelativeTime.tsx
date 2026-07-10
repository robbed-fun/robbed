"use client";

import { useEffect, useState } from "react";

import { formatAge } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * Live-ticking relative age from a unix-seconds block timestamp (indexer time).
 * Client-only + `suppressHydrationWarning`: "age" is inherently request-relative,
 * so the server HTML and the first client paint can legitimately differ by a
 * tick — suppressing avoids a spurious hydration warning without hiding real
 * mismatches elsewhere. Never uses `block.number` (CLAUDE.md) — only timestamps.
 */
export function RelativeTime({
  unixSeconds,
  className,
}: {
  unixSeconds: number;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span suppressHydrationWarning className={cn("tabular-nums", className)}>
      {formatAge(unixSeconds, now)}
    </span>
  );
}
