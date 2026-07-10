import type {
  TokenCard,
  WsGraduatedData,
  WsLaunchData,
  WsTradeData,
} from "@robbed/shared";

/**
 * Event-tape domain model (Discover, ROBBED_ redesign — docs/Robbed.html "2d").
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
 *   never fabricate them from a single trade (mirrors token-grid's priceEth-only
 *   patch rule). Unknown tokens render mcap/Δ% as "—", never invented.
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

/**
 * DEMO-ONLY per-event display overrides (task A). The live path NEVER sets these
 * (a single trade can't justify a mcap/Δ% aggregate — §2); they exist so the
 * gated mock tape can reproduce the mockup's per-row amount + Δ% exactly. When
 * absent, the row resolves Δ% from the token registry as before.
 */
type DemoOverrides = {
  /** Per-event Δ% shown in the last column (mock only). */
  deltaPct?: number | null;
  /** Amount shown for launch/graduate rows too (mock only). */
  ethAmount?: string;
};

export type TapeEvent =
  | ({
      kind: "buy" | "sell";
      id: string;
      token: string; // lowercased address
      ethAmount: string; // wei decimal string — indexer-supplied
      ts: number; // unix seconds
    } & DemoOverrides)
  | ({
      kind: "launch";
      id: string;
      token: string;
      name: string;
      ticker: string;
      imageUrl: string | null;
      creator: string;
      ts: number;
    } & DemoOverrides)
  | ({
      kind: "graduate";
      id: string;
      token: string;
      ts: number;
    } & DemoOverrides);

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

/**
 * DEMO-ONLY (task A): build the mockup's mixed tape (BUY/LAUNCH/SELL/GRADUATE)
 * from the gated `discover.eventTape` fixture. Each row carries its own amount +
 * Δ% override so the demo reproduces docs/Robbed.html "2d" verbatim; the live
 * tape never uses this path. `ageLabel` ("4s"/"1m") is converted to a `ts`
 * relative to `nowSec` so the age column reads the mockup's values on first paint.
 */
export type MockTapeEntry = {
  ageLabel: string;
  kind: string; // "BUY" | "SELL" | "LAUNCH" | "GRADUATE"
  ticker: string;
  tokenAddress: string;
  ethAmount: string;
  changePct: number | null;
};

function parseAgeSeconds(label: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(label.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2];
  return unit === "s" ? n : unit === "m" ? n * 60 : unit === "h" ? n * 3600 : n * 86400;
}

export function mockTapeEvents(
  entries: readonly MockTapeEntry[],
  tokens: readonly TokenCard[],
  nowSec: number = Math.floor(Date.now() / 1000),
): TapeEvent[] {
  const byAddr = new Map(tokens.map((t) => [norm(t.address), t]));
  return entries.map((e, i): TapeEvent => {
    const token = norm(e.tokenAddress);
    const ts = nowSec - parseAgeSeconds(e.ageLabel);
    const kind = e.kind.toLowerCase();
    if (kind === "launch") {
      const t = byAddr.get(token);
      return {
        kind: "launch",
        id: `mock-l-${token}-${i}`,
        token,
        name: t?.name ?? e.ticker,
        ticker: t?.ticker ?? e.ticker,
        imageUrl: t?.imageUrl ?? null,
        creator: t?.creator ?? token,
        ts,
        ethAmount: e.ethAmount,
        deltaPct: e.changePct,
      };
    }
    if (kind === "graduate") {
      return {
        kind: "graduate",
        id: `mock-g-${token}-${i}`,
        token,
        ts,
        ethAmount: e.ethAmount,
        deltaPct: e.changePct,
      };
    }
    return {
      kind: kind === "sell" ? "sell" : "buy",
      id: `mock-t-${token}-${i}`,
      token,
      ethAmount: e.ethAmount,
      ts,
      deltaPct: e.changePct,
    };
  });
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
