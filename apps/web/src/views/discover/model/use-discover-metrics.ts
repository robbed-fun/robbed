"use client";

import { GLOBAL_METRICS } from "@robbed/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { useWsChannel } from "@/shared/lib/ws";

import { ingestMetricMessage } from "./metrics";

/**
 * Subscribe the Discover screen to the coalesced `global:metrics` snapshots and
 * reconcile them into the `tokens` query cache (D-70). Mount ONCE per Discover
 * render (the grid hosts it): a single `useWsChannel(GLOBAL_METRICS, …)` patches
 * EVERY `tokens`-family cache — the grid's infinite query AND the tape registry —
 * by reference via `setQueriesData`, so a swap live-updates every card's
 * mcap / vol / Δ% / progress / status with no refetch and no client math.
 *
 * The `lastBlock` high-water map (ref, survives re-renders) enforces
 * last-write-wins by `blockNumber` across the whole session. On WS reconnect /
 * seq-gap the WsClient invalidates the `tokens` family (LIVE_QUERY_PREFIXES) →
 * REST rebuilds the registry (ERR-11); the map simply resumes from there.
 */
export function useDiscoverMetricsSync(): void {
  const queryClient = useQueryClient();
  const lastBlock = useRef<Map<string, number>>(new Map());

  useWsChannel(GLOBAL_METRICS, (msg) => {
    ingestMetricMessage(queryClient, lastBlock.current, msg);
  });
}
