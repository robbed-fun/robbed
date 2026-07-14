"use client";

import type { TokenCard } from "@robbed/shared";
import { useQuery } from "@tanstack/react-query";

import { getTokens } from "@/shared/api";
import { qk } from "@/shared/lib/query-keys";
import { EventTape } from "@/widgets/event-tape";

import type { TokensPage } from "../model/metrics";

/**
 * Discover event-tape composition (D-70). The `<EventTape>` widget is UNCHANGED
 * (still takes `tokens: TokenCard[]`); this thin discover-local wrapper routes
 * its enrichment registry through the shared `tokens` query cache so the same
 * `global:metrics` patch that live-updates the grid ALSO reaches the tape's
 * mcap/status registry BY REFERENCE (D-70 "patch the cached tokens list + tape
 * registry"). No new widget behavior — only the data source moves from a static
 * server prop to a WS-patchable cache seeded by that same SSR snapshot.
 */

/** Registry refresh source on reconnect — newest is the dominant tape source. */
const REGISTRY_LIMIT = 40;

export function DiscoverTape({ registryTokens }: { registryTokens: TokenCard[] }) {
  const { data } = useQuery<TokensPage>({
    // A `tokens`-family key → `useDiscoverMetricsSync`'s `setQueriesData` patches
    // it, and the reconnect invalidation (LIVE_QUERY_PREFIXES) heals it via REST.
    queryKey: qk.tokens({ scope: "discover-registry" }),
    queryFn: () => getTokens({ sort: "newest", filter: "all", limit: REGISTRY_LIMIT }),
    initialData: { tokens: registryTokens, nextCursor: null },
    // Live-ness comes from WS metric patches, not polling; refetch only on the
    // reconnect/seq-gap invalidation. Long stale time avoids a focus refetch that
    // would reorder the registry between metric snapshots.
    staleTime: 30_000,
  });

  return <EventTape tokens={data?.tokens ?? registryTokens} />;
}
