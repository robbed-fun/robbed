"use client";

import { useEffect, useState } from "react";

/**
 * Hydration-safe ticking clock (escalated hardening, 2026-07-12 e2e evidence:
 * hydration-text mismatches on Discover/Token pages from age cells rendering a
 * server `Date.now()` against a later client one).
 *
 * DECISION (recorded): returns `null` on the server AND on the first client
 * render — the initial markup is fully deterministic, so no
 * `suppressHydrationWarning` band-aid is needed — then flips to the live
 * epoch-ms after mount and ticks every `intervalMs`. Alternatives considered:
 * quantizing `Date.now()` (still nondeterministic at bucket boundaries) and
 * threading an SSR render-time prop through every callsite (correct but invasive
 * and still wrong for client-initiated renders). Callers render a placeholder
 * for the single pre-mount frame; ages fill immediately after hydration.
 * (React reference: server/client initial render must produce identical markup.)
 */
export function useNowTick(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
