import type {
  EventFeedRow,
  TokenCard,
  WsGraduatedData,
  WsLaunchData,
  WsTradeData,
} from "@robbed/shared";

/**
 * Event-tape domain model (Discover, ROBBED_ redesign —, panel "2d").
 *
 * The tape is a MERGED LIVE feed of protocol events — trades (BUY/SELL),
 * launches, graduations — across all tokens. This module is the pure,
 * React-free core (testable): it defines the event shapes, maps WS payloads to
 * events, seeds an initial snapshot, and filters by tab.
 *
 * PROTOCOL DISCIPLINE (web.md):
 * - A `TapeEvent` carries ONLY the fields the emitting event actually supplies:
 *   a trade carries its `ethAmount` (indexer-supplied), a launch its metadata.
 *   It NEVER carries mcap / Δ% — those are per-token AGGREGATES. The row's
 *   mcap/Δ% are resolved at render time from the token REGISTRY (a snapshot of
 *   indexer `TokenCard`s), so we display live indexer aggregates by reference and
 *   never fabricate them from a single trade — a WS trade may patch ONLY the
 *   indexer-supplied `priceEth`, never derived aggregates. Unknown tokens render
 *   mcap/Δ% as "—", never invented.
 *
 * SEED SOURCE (gap CLOSED — robbed-indexer shipped `GET /v1/events`): the tape
 * now seeds its initial rows from the merged, newest-first, keyset-paginated
 * `GET /v1/events` feed (launches ∪ trades ∪ graduations, listing-gated). Each
 * feed row is shape-identical to the live-WS payload (`eventFeedRowSchema`
 * wraps the SAME `wsLaunchData`/`wsTradeData`/`wsGraduatedData`), so `eventFromFeedRow`
 * reuses the per-type WS mappers verbatim — no second shape is invented
 * (anti-drift). This means historical BUY/SELL/GRADUATE rows (incl. a graduation
 * that landed during indexer catch-up, when WS backfill publishes are suppressed
 * and there is no replay buffer) now paint on first load, not just launches.
 *
 * The `seedLaunches(...)` list from `/v1/tokens` is kept as the SYNCHRONOUS
 * first-paint (SSR-derived, before the async `/v1/events` fetch resolves); the
 * fetched feed is then folded in via `mergeFeed` and live rows keep streaming
 * over WS. Every row carries a STABLE identity (below) so a `/v1/tokens` launch,
 * a `/v1/events` row, and a live-WS row for the same event collapse to ONE row.
 *
 * IDENTITY (dedupe key): the `/v1/events` feed keys on the globally-unique
 * `(blockNumber, logIndex)` composite. We mirror that as each event's `id` so a
 * REST-seeded row and a live-WS row for the same event share an identity and
 * de-dupe. Launch/graduate WS payloads omit `logIndex`, but each token is
 * launched / graduates exactly once, so the token address is its natural
 * (equivalent) identity — trades use `(blockNumber, logIndex)`.
 */

export type TapeFilter = "all" | "launches" | "trades" | "graduations";
export type TapeKind = "buy" | "sell" | "launch" | "graduate";

export type TapeEvent =
  | {
      kind: "buy" | "sell";
      id: string;
      token: string; // lowercased address
      ethAmount: string; // wei decimal string — indexer-supplied
      ts: number; // unix seconds
    }
  | {
      kind: "launch";
      id: string;
      token: string;
      name: string;
      ticker: string;
      imageUrl: string | null;
      creator: string;
      ts: number;
    }
  | {
      kind: "graduate";
      id: string;
      token: string;
      ts: number;
    };

/** Enrichment view of a token — the aggregates the tape reads by reference. */
export type TokenInfo = Pick<
  TokenCard,
  "address" | "name" | "ticker" | "imageUrl" | "mcap" | "change24hPct" | "graduated"
>;

const norm = (a: string) => a.toLowerCase();

/** Registry keyed by lowercased address, for render-time mcap/Δ% lookup. */
export function buildRegistry(tokens: readonly TokenCard[]): Map<string, TokenInfo> {
  const map = new Map<string, TokenInfo>();
  for (const t of tokens) {
    map.set(norm(t.address), {
      address: t.address,
      name: t.name,
      ticker: t.ticker,
      imageUrl: t.imageUrl,
      mcap: t.mcap,
      change24hPct: t.change24hPct,
      graduated: t.graduated,
    });
  }
  return map;
}

/**
 * Seed the tape with real LAUNCH events from the token registry, newest first.
 * These are genuine events (each token was really created at `createdAt`); no
 * synthetic trades are invented to pad the feed.
 */
export function seedLaunches(tokens: readonly TokenCard[], cap = 24): TapeEvent[] {
  return [...tokens]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, cap)
    .map((t) => ({
      kind: "launch" as const,
      // Same stable identity as `launchToEvent` so a `/v1/tokens` seed launch
      // and its `/v1/events` (or live-WS) row collapse to one row on dedupe.
      id: launchId(norm(t.address)),
      token: norm(t.address),
      name: t.name,
      ticker: t.ticker,
      imageUrl: t.imageUrl,
      creator: t.creator,
      ts: t.createdAt,
    }));
}

// Stable per-event identities (see module note). REST seed, `/v1/events`, and
// live WS all produce the SAME id for the same event, so dedupe is a set on `id`.
const tradeId = (blockNumber: number, logIndex: number) =>
  `trade:${blockNumber}:${logIndex}`;
const launchId = (token: string) => `launch:${token}`;
const graduateId = (token: string) => `graduate:${token}`;

export function tradeToEvent(d: WsTradeData): TapeEvent {
  return {
    kind: d.isBuy ? "buy" : "sell",
    id: tradeId(d.blockNumber, d.logIndex),
    token: norm(d.token),
    ethAmount: d.ethAmount,
    ts: d.blockTimestamp,
  };
}

export function launchToEvent(d: WsLaunchData): TapeEvent {
  return {
    kind: "launch",
    id: launchId(norm(d.address)),
    token: norm(d.address),
    name: d.name,
    ticker: d.ticker,
    imageUrl: d.imageUrl ?? null,
    creator: d.creator,
    ts: d.createdAt,
  };
}

export function graduateToEvent(d: WsGraduatedData): TapeEvent {
  return {
    kind: "graduate",
    id: graduateId(norm(d.token)),
    token: norm(d.token),
    ts: d.ts,
  };
}

/**
 * Map one `GET /v1/events` row → a `TapeEvent`. The feed row `data` IS the live
 * WS payload (`eventFeedRowSchema` reuses the ws schemas), so we dispatch to the
 * exact same per-type mappers the WS path uses — one shape, one mapper set.
 */
export function eventFromFeedRow(row: EventFeedRow): TapeEvent {
  switch (row.type) {
    case "launch":
      return launchToEvent(row.data);
    case "trade":
      return tradeToEvent(row.data);
    case "graduated":
      return graduateToEvent(row.data);
  }
}

export function matchesFilter(kind: TapeKind, filter: TapeFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "launches":
      return kind === "launch";
    case "trades":
      return kind === "buy" || kind === "sell";
    case "graduations":
      return kind === "graduate";
  }
}

export function filterEvents(events: readonly TapeEvent[], filter: TapeFilter): TapeEvent[] {
  return events.filter((e) => matchesFilter(e.kind, filter));
}

/**
 * Prepend a new (live-WS) event and cap the in-memory buffer (newest first).
 * De-dupes by stable `id`: a live-WS event that the REST seed already painted
 * (the boundary overlap between the `/v1/events` snapshot and the live stream)
 * is dropped rather than added twice — it is the same indexed event, so no row
 * is lost and none is duplicated.
 */
export function prependCapped(
  events: TapeEvent[],
  next: TapeEvent,
  cap = 60,
): TapeEvent[] {
  // Same-reference bail-out on a dropped duplicate → React skips the re-render.
  if (events.some((e) => e.id === next.id)) return events;
  return [next, ...events].slice(0, cap);
}

/**
 * Fold a `/v1/events` seed into the current buffer (newest first, capped).
 * `incoming` (the REST feed) wins on `id` collision — identical content, but its
 * canonical `(blockNumber, logIndex)` order is authoritative — while any live-WS
 * rows already in `existing` (that arrived before the fetch resolved, or are
 * newer than the fetched window) are preserved, never dropped. Ordering is by
 * `ts` desc (the visible age signal); the sort is stable so equal-`ts` rows keep
 * the incoming-before-existing order.
 */
export function mergeFeed(
  existing: readonly TapeEvent[],
  incoming: readonly TapeEvent[],
  cap = 60,
): TapeEvent[] {
  const byId = new Map<string, TapeEvent>();
  for (const e of incoming) if (!byId.has(e.id)) byId.set(e.id, e);
  for (const e of existing) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.ts - a.ts).slice(0, cap);
}

export const TAPE_FILTER_ORDER: readonly TapeFilter[] = [
  "all",
  "launches",
  "trades",
  "graduations",
];

export const TAPE_FILTER_LABELS: Record<TapeFilter, string> = {
  all: "ALL",
  launches: "LAUNCHES",
  trades: "TRADES",
  graduations: "GRADUATIONS",
};
