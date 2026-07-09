/** Channel taxonomy builders (indexer.md §8.1). */
import { describe, expect, it } from "bun:test";
import {
  GLOBAL_CHANNELS,
  GLOBAL_CONFIRMATIONS,
  GLOBAL_LAUNCHES,
  GLOBAL_TRADES,
  TOKEN_CHANNEL_PATTERN,
  channelSeqKey,
  tokenCandles,
  tokenEvents,
  tokenTrades,
} from "../src/channels";

const ADDR = "0xAbCdEf0123456789aBcDeF0123456789ABCDef01";
const LOWER = ADDR.toLowerCase();

describe("channel taxonomy (indexer.md §8.1 — ratified names)", () => {
  it("global channels", () => {
    expect(GLOBAL_LAUNCHES).toBe("global:launches");
    expect(GLOBAL_TRADES).toBe("global:trades");
    expect(GLOBAL_CONFIRMATIONS).toBe("global:confirmations");
    expect(GLOBAL_CHANNELS).toEqual(["global:launches", "global:trades", "global:confirmations"]);
    expect(TOKEN_CHANNEL_PATTERN).toBe("token:*");
  });

  it("per-token builders lowercase the address", () => {
    expect(tokenTrades(ADDR)).toBe(`token:${LOWER}:trades`);
    expect(tokenEvents(ADDR)).toBe(`token:${LOWER}:events`);
    expect(tokenCandles(ADDR, "15s")).toBe(`token:${LOWER}:candles:15s`);
    expect(tokenCandles(LOWER, "1h")).toBe(`token:${LOWER}:candles:1h`);
  });

  it("per-channel seq key (INCR channel:seq at publish, indexer.md §8.2)", () => {
    expect(channelSeqKey("global:trades")).toBe("global:trades:seq");
    expect(channelSeqKey(tokenTrades(ADDR))).toBe(`token:${LOWER}:trades:seq`);
  });
});
