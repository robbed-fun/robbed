import type { WsGraduatedData, WsLaunchData, WsTradeData } from "@robbed/shared";
import { describe, expect, it } from "vitest";

import {
  type TapeEvent,
  buildRegistry,
  filterEvents,
  graduateToEvent,
  launchToEvent,
  matchesFilter,
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
    const e = tradeToEvent(trade({ isBuy: true }), 1);
    expect(e.kind).toBe("buy");
    expect(e).toMatchObject({ ethAmount: "420000000000000000", token: A1.toLowerCase() });
    // No aggregate ever leaks onto the trade event.
    expect(e).not.toHaveProperty("mcap");
    expect(e).not.toHaveProperty("change24hPct");
  });

  it("maps a sell trade to a SELL event", () => {
    expect(tradeToEvent(trade({ isBuy: false }), 2).kind).toBe("sell");
  });

  it("maps launch + graduated payloads to their events", () => {
    expect(launchToEvent(launch(), 3)).toMatchObject({
      kind: "launch",
      name: "Moonmilk",
      ticker: "MILK",
      token: A2.toLowerCase(),
    });
    expect(graduateToEvent(graduated(), 4)).toMatchObject({
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
    tradeToEvent(trade({ isBuy: true }), 1),
    tradeToEvent(trade({ isBuy: false }), 2),
    launchToEvent(launch(), 3),
    graduateToEvent(graduated(), 4),
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
      buf = prependCapped(buf, tradeToEvent(trade({ logIndex: i }), i), 3);
    }
    expect(buf).toHaveLength(3);
    // last inserted is at the head
    expect(buf[0]!.id).toContain("-4-4");
  });
});
