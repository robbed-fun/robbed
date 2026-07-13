import type {
  TokenCard,
  WsGraduatedData,
  WsLaunchData,
  WsTradeData,
} from "@robbed/shared";

/**
 * Event-tape domain model (Discover, ROBBED_ redesign — spec §12.50, panel "2d").
 *
 * The tape is a MERGED LIVE feed of protocol events — trades (BUY/SELL),
 * launches, graduations — across all tokens. This module is the pure,
 * React-free core (testable): it defines the event shapes, maps WS payloads to
 * events, seeds an initial snapshot, and filters by tab.
 *
 * PROTOCOL DISCIPLINE (§2, web.md §7):
 * - A `TapeEvent` carries ONLY the fields the emitting event actually supplies:
 *   a trade carries its `ethAmount` (indexer-supplied), a launch its metadata.
 *   It NEVER carries mcap / Δ% — those are per-token AGGREGATES. The row's
 *   mcap/Δ% are resolved at render time from the token REGISTRY (a snapshot of
 *   indexer `TokenCard`s), so we display live indexer aggregates by reference and
 *   never fabricate them from a single trade — a WS trade may patch ONLY the
 *   indexer-supplied `priceEth`, never derived aggregates. Unknown tokens render
 *   mcap/Δ% as "—", never invented.
 *
 * GAP (reported to hoodpad-indexer via the orchestrator): there is no global
 * recent-activity REST endpoint (only per-token `/v1/tokens/:address/trades`), so
 * the server-side initial snapshot can only seed LAUNCH rows (derivable from the
 * `/v1/tokens` registry); historical BUY/SELL/GRADUATE rows arrive live over WS.
 * A `GET /v1/events` (enriched, mixed, cursor-paginated) would let the tape paint
 * a full mixed snapshot server-side. Until then the tape seeds launches + streams.
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

/** Enrichment view of a token — the aggregates the tape reads by reference (§2). */
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
      id: `seed-launch-${norm(t.address)}`,
      token: norm(t.address),
      name: t.name,
      ticker: t.ticker,
      imageUrl: t.imageUrl,
      creator: t.creator,
      ts: t.createdAt,
    }));
}

export function tradeToEvent(d: WsTradeData, seq: number): TapeEvent {
  return {
    kind: d.isBuy ? "buy" : "sell",
    id: `t-${d.txHash}-${d.logIndex}-${seq}`,
    token: norm(d.token),
    ethAmount: d.ethAmount,
    ts: d.blockTimestamp,
  };
}

export function launchToEvent(d: WsLaunchData, seq: number): TapeEvent {
  return {
    kind: "launch",
    id: `l-${norm(d.address)}-${seq}`,
    token: norm(d.address),
    name: d.name,
    ticker: d.ticker,
    imageUrl: d.imageUrl ?? null,
    creator: d.creator,
    ts: d.createdAt,
  };
}

export function graduateToEvent(d: WsGraduatedData, seq: number): TapeEvent {
  return {
    kind: "graduate",
    id: `g-${norm(d.token)}-${seq}`,
    token: norm(d.token),
    ts: d.ts,
  };
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

/** Prepend a new event and cap the in-memory buffer (newest first). */
export function prependCapped(
  events: readonly TapeEvent[],
  next: TapeEvent,
  cap = 60,
): TapeEvent[] {
  return [next, ...events].slice(0, cap);
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
