"use client";

import { useWsStatus } from "@/shared/lib/ws";

/**
 * Degraded-mode banner (web.md §2.6): when the WS is not open, the live patch
 * stream is down and views fall back to polling — we disclose that plainly. No
 * settlement/finality claim here (§1); purely a connectivity notice.
 */
export function LiveStatusBanner() {
  const status = useWsStatus();
  if (status === "open") return null;
  const label =
    status === "reconnecting"
      ? "Live updates degraded — reconnecting…"
      : status === "connecting"
        ? "Connecting to live updates…"
        : "Live updates offline — showing latest fetched data.";
  return (
    <div className="border-b border-border bg-soft-confirmed/10 px-4 py-1.5 text-center text-xs text-soft-confirmed">
      {label}
    </div>
  );
}
