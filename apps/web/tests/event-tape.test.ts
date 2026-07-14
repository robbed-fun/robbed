import type {
  EventFeedRow,
  WsGraduatedData,
  WsLaunchData,
  WsTradeData,
} from "@robbed/shared";
import { describe, expect, it } from "vitest";

import {
  type TapeEvent,
  buildRegistry,
  eventFromFeedRow,
  filterEvents,
  graduateToEvent,
  launchToEvent,
  matchesFilter,
  mergeFeed,
  prependCapped,
  seedLaunches,
  tradeToEvent,
} from "@/widgets/event-tape";
import { tokenCard } from "./fixtures";

/**
 * Event-tape domain model (Discover, ROBBED_ redesign). Proves the tape wires
 * LIVE indexer/WS data and never fabricates aggregates :
 *  - a trade event carries ONLY its indexer-supplied `ethAmount` — no mcap/Δ%;
 *  - mcap/Δ% are resolved from the token registry by reference;
 *  - filter tabs partition events by kind; the buffer prepends + caps.
 */

const A1 = "0x00000000000000000000000000000000000000A1";
const A2 = "0x00000000000000000000000000000000000000a2";

function trade(over: Partial<WsTradeData> = {}): WsTradeData {
  return {
    token: A1,
    trader: "0x00000000000000000000000000000000000000ee",
    venue: "curve",
    isBuy: true,
    ethAmount: "420000000000000000",
    tokenAmount: "1200000000000000000000000",
    feeEth: "4200000000000000",
    priceEth: 0.00034,
    blockNumber: 100,
    txHash:
      "0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcab",
    logIndex: 0,
    blockTimestamp: 1_800_000_000,
    confirmationState: "soft_confirmed",
    ...over,
  };
}

function launch(over: Partial<WsLaunchData> = {}): WsLaunchData {
  return {
    address: A2,
    name: "Moonmilk",
    ticker: "MILK",
    creator: "0x00000000000000000000000000000000000000bb",
    createdAt: 1_800_000_001,
    blockNumber: 101,
    confirmationState: "soft_confirmed",
    ...over,
  };
}

function graduated(over: Partial<WsGraduatedData> = {}): WsGraduatedData {
  return {
    token: A1,
    pool: "0x00000000000000000000000000000000000000f0",
    blockNumber: 102,
    ts: 1_800_000_002,
    ...over,
  };
}

describe("event-tape model — no fabricated aggregates", () => {
  it("maps a buy trade to a BUY event carrying only the indexer ethAmount", () => {
    const e = tradeToEvent(trade({ isBuy: true }));
    expect(e.kind).toBe("buy");
    expect(e).toMatchObject({ ethAmount: "420000000000000000", token: A1.toLowerCase() });
    // No aggregate ever leaks onto the trade event.
    expect(e).not.toHaveProperty("mcap");
    expect(e).not.toHaveProperty("change24hPct");
  });

  it("maps a sell trade to a SELL event", () => {
    expect(tradeToEvent(trade({ isBuy: false })).kind).toBe("sell");
  });

  it("maps launch + graduated payloads to their events", () => {
    expect(launchToEvent(launch())).toMatchObject({
      kind: "launch",
      name: "Moonmilk",
      ticker: "MILK",
      token: A2.toLowerCase(),
    });
    expect(graduateToEvent(graduated())).toMatchObject({
      kind: "graduate",
      token: A1.toLowerCase(),
    });
  });

  it("resolves mcap/Δ% from the registry by lowercased address (never from a trade)", () => {
    const reg = buildRegistry([
      tokenCard({ address: A1, change24hPct: 3.1 }),
    ]);
    const info = reg.get(A1.toLowerCase());
    expect(info?.change24hPct).toBe(3.1);
    expect(info?.mcap.usd).toBeDefined();
    // A trade for an unknown token resolves to nothing → row shows "—", not invented.
    expect(reg.get("0x00000000000000000000000000000000000000ff")).toBeUndefined();
  });
});

describe("event-tape model — filters + buffer", () => {
  const events: TapeEvent[] = [
    tradeToEvent(trade({ isBuy: true, logIndex: 1 })),
    tradeToEvent(trade({ isBuy: false, logIndex: 2 })),
    launchToEvent(launch()),
    graduateToEvent(graduated()),
  ];

  it("matchesFilter partitions by kind", () => {
    expect(matchesFilter("buy", "trades")).toBe(true);
    expect(matchesFilter("sell", "trades")).toBe(true);
    expect(matchesFilter("launch", "trades")).toBe(false);
    expect(matchesFilter("launch", "launches")).toBe(true);
    expect(matchesFilter("graduate", "graduations")).toBe(true);
    expect(matchesFilter("graduate", "all")).toBe(true);
  });

  it("filterEvents returns the right subsets", () => {
    expect(filterEvents(events, "all")).toHaveLength(4);
    expect(filterEvents(events, "trades")).toHaveLength(2);
    expect(filterEvents(events, "launches")).toHaveLength(1);
    expect(filterEvents(events, "graduations")).toHaveLength(1);
  });

  it("seedLaunches emits real LAUNCH events, newest first", () => {
    const seeded = seedLaunches([
      tokenCard({ address: A1, createdAt: 100 }),
      tokenCard({ address: A2, createdAt: 200 }),
    ]);
    expect(seeded.every((e) => e.kind === "launch")).toBe(true);
    expect(seeded[0]!.token).toBe(A2.toLowerCase()); // newest first
    expect(seeded[1]!.token).toBe(A1.toLowerCase());
  });

  it("prependCapped adds newest-first and caps the buffer", () => {
    let buf: TapeEvent[] = [];
    for (let i = 0; i < 5; i++) {
      buf = prependCapped(buf, tradeToEvent(trade({ logIndex: i })), 3);
    }
    expect(buf).toHaveLength(3);
    // last inserted is at the head (stable `(blockNumber, logIndex)` identity)
    expect(buf[0]!.id).toBe("trade:100:4");
  });

  it("prependCapped de-dupes a live-WS row already present from the REST seed", () => {
    // Same event over REST seed and live WS → same stable id → one row.
    const g = graduated();
    const seeded = graduateToEvent(g);
    const live = graduateToEvent(g);
    expect(live.id).toBe(seeded.id);
    const buf = prependCapped([seeded], live, 60);
    expect(buf).toHaveLength(1);
  });
});

describe("event-tape model — /v1/events seed (historical graduations)", () => {
  it("maps each feed row via the per-type mappers (shape-identical to WS)", () => {
    const rows: EventFeedRow[] = [
      { type: "launch", data: launch() },
      { type: "trade", data: trade() },
      { type: "graduated", data: graduated() },
    ];
    const mapped = rows.map(eventFromFeedRow);
    expect(mapped.map((e) => e.kind)).toEqual(["launch", "buy", "graduate"]);
    // A GRADUATED feed row carries the `graduate` kind the GRADUATIONS tab filters on.
    expect(filterEvents(mapped, "graduations")).toHaveLength(1);
    expect(filterEvents(mapped, "graduations")[0]!.token).toBe(A1.toLowerCase());
  });

  it("a graduation feed row shares its id with the live-WS row → merges to one", () => {
    const g = graduated();
    const fromFeed = eventFromFeedRow({ type: "graduated", data: g });
    const fromWs = graduateToEvent(g);
    expect(fromFeed.id).toBe(fromWs.id);
  });

  it("mergeFeed folds the seed newest-first, de-dupes, and keeps live-only rows", () => {
    // Existing buffer: a launch seeded from /v1/tokens + a live-WS trade that
    // arrived before the /v1/events fetch resolved.
    const seedLaunch = launchToEvent(launch({ createdAt: 1_000 }));
    const liveTrade = tradeToEvent(
      trade({ logIndex: 9, blockNumber: 200, blockTimestamp: 3_000 }),
    );
    const existing: TapeEvent[] = [liveTrade, seedLaunch];

    // Incoming /v1/events snapshot: a historical graduation + the SAME launch.
    const incoming = [
      eventFromFeedRow({ type: "graduated", data: graduated({ ts: 2_000 }) }),
      eventFromFeedRow({ type: "launch", data: launch({ createdAt: 1_000 }) }),
    ];

    const merged = mergeFeed(existing, incoming);
    // The duplicate launch collapses (3 unique, not 4).
    expect(merged).toHaveLength(3);
    // Newest-first by ts: live trade (3000) → graduation (2000) → launch (1000).
    expect(merged.map((e) => e.kind)).toEqual(["buy", "graduate", "launch"]);
    // The live-only trade survives the fold (never dropped).
    expect(merged.some((e) => e.id === liveTrade.id)).toBe(true);
  });
});
