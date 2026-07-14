import type { QueryClient } from "@tanstack/react-query";
import type { TokenCard, WsMessage, WsTokenMetricsData } from "@robbed/shared";
import { wsTokenMetricsDataSchema } from "@robbed/shared";

/**
 * Discover live-metrics model (D-70) — the "swap didn't refresh discovery" fix.
 *
 * The indexer publishes a COALESCED per-token `token_metrics` snapshot on the
 * `global:metrics` channel on each indexed trade / graduation (shared
 * `wsTokenMetricsDataSchema` — the authoritative recomputed ETH aggregates). The
 * grid cards + event-tape registry read these aggregates BY REFERENCE from the
 * TanStack Query `tokens` cache; this module patches that cache immutably so a
 * swap live-updates mcap / vol / Δ% / progress / status with:
 *   - NO refetch (WS is a patch stream; REST stays resumable truth on reconnect),
 *   - NO client market math (aggregates are indexer-computed — no-market-metrics),
 *   - last-write-wins by `blockNumber` (a stale, out-of-order snapshot is dropped).
 *
 * PURE + React-free so the reconciliation is unit-testable (tests/discover-metrics).
 * Rejected alternatives (D-70): deriving aggregates client-side from a single
 * `trade` payload (forbidden — a trade can't justify an aggregate and lacks
 * volume24h/progressPct), and a throttled full-list refetch per trade (hammers the
 * API and reorders the grid). Docs-first: TanStack Query v5 `setQueriesData`
 * functional-immutable updater + partial-key filter (verified 2026-07-14).
 */

/** One page of the cursor-paginated `GET /v1/tokens` response (grid + registry). */
export interface TokensPage {
  tokens: TokenCard[];
  nextCursor: string | null;
}

/** The `tokens`-family query-key prefix every Discover cache shares (grid + registry). */
export const TOKENS_QUERY_PREFIX = ["tokens"] as const;

/**
 * Overlay the authoritative ETH aggregates from a `token_metrics` snapshot onto a
 * card. USD `mcap` is deliberately NOT touched — the snapshot is ETH-only and the
 * frontend never fabricates USD (no-market-metrics); the card's live-priced USD
 * mirror carries its own source + timestamp and lags to the next REST refresh.
 */
function mergeMetric(card: TokenCard, m: WsTokenMetricsData): TokenCard {
  return {
    ...card,
    priceEth: m.priceEth,
    mcapEth: m.mcapEth,
    volume24h: m.volume24h,
    change24hPct: m.change24hPct,
    progressPct: m.progressPct,
    status: m.status,
    graduated: m.graduated,
  };
}

/**
 * Apply a metric to a token list, patching ONLY the matching token immutably.
 * Returns the SAME array reference when the token isn't present (so unrelated
 * queries/cards keep their reference and React/memo skip the re-render). Order is
 * preserved verbatim — the grid is server-authoritative and never re-ranked.
 */
export function applyMetricToList(
  list: readonly TokenCard[],
  m: WsTokenMetricsData,
): TokenCard[] | readonly TokenCard[] {
  const addr = m.token.toLowerCase();
  let changed = false;
  const next = list.map((card) => {
    if (card.address.toLowerCase() !== addr) return card;
    changed = true;
    return mergeMetric(card, m);
  });
  return changed ? next : list;
}

type MaybeInfinite = { pages?: unknown; pageParams?: unknown };

/**
 * Immutable updater for any `tokens`-family cache. Handles BOTH shapes the
 * Discover screen stores under `["tokens", …]`:
 *   - the grid's `useInfiniteQuery` — `{ pages: TokensPage[], pageParams }`,
 *   - the tape registry's `useQuery` — a bare `TokensPage`.
 * Returns the SAME reference when nothing changed so `setQueriesData` bails out
 * of a notification for unaffected queries.
 */
export function patchTokensQueryData(old: unknown, m: WsTokenMetricsData): unknown {
  if (!old || typeof old !== "object") return old;

  const infinite = old as MaybeInfinite;
  if (Array.isArray(infinite.pages)) {
    let changed = false;
    const pages = (infinite.pages as TokensPage[]).map((page) => {
      if (!page || !Array.isArray(page.tokens)) return page;
      const tokens = applyMetricToList(page.tokens, m);
      if (tokens === page.tokens) return page;
      changed = true;
      return { ...page, tokens: tokens as TokenCard[] };
    });
    return changed ? { ...infinite, pages } : old;
  }

  const plain = old as { tokens?: unknown };
  if (Array.isArray(plain.tokens)) {
    const tokens = applyMetricToList(plain.tokens as TokenCard[], m);
    return tokens === plain.tokens ? old : { ...(old as object), tokens };
  }

  return old;
}

/**
 * Ingest ONE WS envelope: validate a `token_metrics` message with the shared
 * schema, enforce last-write-wins by `blockNumber` against `lastBlock` (a
 * per-token high-water map), then patch every cached `tokens`-family query by
 * reference. Returns `true` iff the metric was applied (drops stale / malformed /
 * non-metric messages). Kept pure (QueryClient + Map are injected) so the whole
 * reconciliation is testable without a live socket.
 */
export function ingestMetricMessage(
  queryClient: QueryClient,
  lastBlock: Map<string, number>,
  msg: WsMessage,
): boolean {
  if (msg.type !== "token_metrics") return false;
  // The WsClient already parses the envelope with `wsMessageSchema`; re-validate
  // the payload defensively (D-70 instruction — validate with the shared schema).
  const parsed = wsTokenMetricsDataSchema.safeParse(msg.data);
  if (!parsed.success) return false;
  const m = parsed.data;

  const addr = m.token.toLowerCase();
  const prev = lastBlock.get(addr);
  // last-write-wins: apply when blockNumber >= the last applied (equal = a
  // re-delivered coalesced snapshot, harmlessly idempotent); drop older blocks.
  if (prev !== undefined && m.blockNumber < prev) return false;
  lastBlock.set(addr, m.blockNumber);

  queryClient.setQueriesData({ queryKey: TOKENS_QUERY_PREFIX }, (old: unknown) =>
    patchTokensQueryData(old, m),
  );
  return true;
}
