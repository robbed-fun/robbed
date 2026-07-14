/** Channel taxonomy builders (indexer.md). */
import { describe, expect, it } from "bun:test";
import {
  CONTROL_REVERIFY,
  GLOBAL_CHANNELS,
  GLOBAL_CONFIRMATIONS,
  GLOBAL_LAUNCHES,
  GLOBAL_METRICS,
  GLOBAL_TRADES,
  TOKEN_CHANNEL_PATTERN,
  channelSeqKey,
  controlReverifySchema,
  tokenCandles,
  tokenEvents,
  tokenTrades,
} from "../src/channels";

const ADDR = "0xAbCdEf0123456789aBcDeF0123456789ABCDef01";
const LOWER = ADDR.toLowerCase();

describe("channel taxonomy (indexer.md — ratified names)", () => {
  it("global channels", () => {
    expect(GLOBAL_LAUNCHES).toBe("global:launches");
    expect(GLOBAL_TRADES).toBe("global:trades");
    expect(GLOBAL_CONFIRMATIONS).toBe("global:confirmations");
    expect(GLOBAL_METRICS).toBe("global:metrics"); // D-70 live-metrics channel
    expect(GLOBAL_CHANNELS).toEqual([
      "global:launches",
      "global:trades",
      "global:confirmations",
      "global:metrics",
    ]);
    // the WS server explicit-SUBSCRIBEs GLOBAL_CHANNELS — the new channel must be in the set
    expect(GLOBAL_CHANNELS).toContain(GLOBAL_METRICS);
    expect(TOKEN_CHANNEL_PATTERN).toBe("token:*");
  });

  it("per-token builders lowercase the address", () => {
    expect(tokenTrades(ADDR)).toBe(`token:${LOWER}:trades`);
    expect(tokenEvents(ADDR)).toBe(`token:${LOWER}:events`);
    expect(tokenCandles(ADDR, "15s")).toBe(`token:${LOWER}:candles:15s`);
    expect(tokenCandles(LOWER, "1h")).toBe(`token:${LOWER}:candles:1h`);
  });

  it("per-channel seq key (INCR channel:seq at publish, indexer.md)", () => {
    expect(channelSeqKey("global:trades")).toBe("global:trades:seq");
    expect(channelSeqKey(tokenTrades(ADDR))).toBe(`token:${LOWER}:trades:seq`);
  });

  it("control:reverify admin seam (X-9) — channel name + { token } payload", () => {
    expect(CONTROL_REVERIFY).toBe("control:reverify");
    expect(controlReverifySchema.safeParse({ token: LOWER }).success).toBe(true);
    expect(controlReverifySchema.safeParse({ token: "0xNOTHEX" }).success).toBe(false);
    expect(controlReverifySchema.safeParse({}).success).toBe(false);
  });
});
