/** WS message envelope + per-type schemas (indexer.md §8.2). */
import { describe, expect, it } from "bun:test";
import {
  wsClientOpSchema,
  wsMessageSchema,
} from "../src/ws-messages";

const ADDR = "0x" + "ab".repeat(20);
const TX = "0x" + "12".repeat(32);

const tradeMsg = {
  v: 1,
  type: "trade",
  channel: `token:${ADDR}:trades`,
  seq: 42,
  ts: 1767950000000,
  data: {
    token: ADDR,
    trader: ADDR,
    venue: "curve",
    isBuy: true,
    ethAmount: "1000000000000000000",
    tokenAmount: "123456789000000000000000",
    feeEth: "10000000000000000",
    priceEth: 0.0000000081,
    blockNumber: 12345,
    txHash: TX,
    logIndex: 2,
    blockTimestamp: 1767950000,
    confirmationState: "soft_confirmed",
  },
} as const;

describe("envelope { v:1, type, channel, seq, ts, data }", () => {
  it("parses a valid trade message", () => {
    expect(wsMessageSchema.safeParse(tradeMsg).success).toBe(true);
  });

  it("rejects wrong version / unknown type / missing seq", () => {
    expect(wsMessageSchema.safeParse({ ...tradeMsg, v: 2 }).success).toBe(false);
    expect(wsMessageSchema.safeParse({ ...tradeMsg, type: "swap" }).success).toBe(false);
    const { seq: _seq, ...noSeq } = tradeMsg;
    expect(wsMessageSchema.safeParse(noSeq).success).toBe(false);
  });

  it("uint256 amounts are decimal strings — numbers/hex rejected", () => {
    expect(
      wsMessageSchema.safeParse({
        ...tradeMsg,
        data: { ...tradeMsg.data, ethAmount: 1e18 },
      }).success,
    ).toBe(false);
    expect(
      wsMessageSchema.safeParse({
        ...tradeMsg,
        data: { ...tradeMsg.data, ethAmount: "0xde0b6b3a7640000" },
      }).success,
    ).toBe(false);
  });
});

describe("per-type payloads (indexer.md §8.2)", () => {
  const base = { v: 1, seq: 1, ts: 1767950000000 };

  it("candle", () => {
    const msg = {
      ...base,
      type: "candle",
      channel: `token:${ADDR}:candles:1s`,
      data: {
        token: ADDR, interval: "1s", bucketStart: 1767950000,
        open: 1e-8, high: 1.2e-8, low: 0.9e-8, close: 1.1e-8,
        volumeEth: "5000000000000000000", tradeCount: 7,
      },
    };
    expect(wsMessageSchema.safeParse(msg).success).toBe(true);
    expect(
      wsMessageSchema.safeParse({ ...msg, data: { ...msg.data, interval: "30s" } }).success,
    ).toBe(false); // not in the ratified §12.17 set
  });

  it("launch (token card projection)", () => {
    const msg = {
      ...base,
      type: "launch",
      channel: "global:launches",
      data: {
        address: ADDR, name: "Cash Cat", ticker: "CASHCAT", creator: ADDR,
        createdAt: 1767950000, blockNumber: 12345, confirmationState: "soft_confirmed",
      },
    };
    expect(wsMessageSchema.safeParse(msg).success).toBe(true); // imageUrl optional
    expect(
      wsMessageSchema.safeParse({ ...msg, data: { ...msg.data, imageUrl: "https://cdn.x/i.webp" } }).success,
    ).toBe(true);
  });

  it("graduated", () => {
    const msg = {
      ...base, type: "graduated", channel: `token:${ADDR}:events`,
      data: { token: ADDR, pool: ADDR, blockNumber: 99, ts: 1767950000 },
    };
    expect(wsMessageSchema.safeParse(msg).success).toBe(true);
  });

  it("confirmations watermark + reorg (spec §12.20; indexer.md §5.3)", () => {
    expect(
      wsMessageSchema.safeParse({
        ...base, type: "confirmations", channel: "global:confirmations",
        data: { safeBlock: 1000, finalizedBlock: 500 },
      }).success,
    ).toBe(true);
    expect(
      wsMessageSchema.safeParse({
        ...base, type: "reorg", channel: "global:confirmations", data: { fromBlock: 999 },
      }).success,
    ).toBe(true);
  });

  it("metadata_verified", () => {
    const ok = {
      ...base, type: "metadata_verified", channel: `token:${ADDR}:events`,
      data: { token: ADDR, status: "match" },
    };
    expect(wsMessageSchema.safeParse(ok).success).toBe(true);
    expect(
      wsMessageSchema.safeParse({ ...ok, data: { ...ok.data, status: "verified" } }).success,
    ).toBe(false);
  });
});

describe("client ops (sub/unsub/ping only — api.md §6.5)", () => {
  it("accepts sub/unsub with channel and bare ping", () => {
    expect(wsClientOpSchema.safeParse({ op: "sub", channel: "global:trades" }).success).toBe(true);
    expect(wsClientOpSchema.safeParse({ op: "unsub", channel: `token:${ADDR}:trades` }).success).toBe(true);
    expect(wsClientOpSchema.safeParse({ op: "ping" }).success).toBe(true);
  });

  it("rejects sub without channel and unknown ops", () => {
    expect(wsClientOpSchema.safeParse({ op: "sub" }).success).toBe(false);
    expect(wsClientOpSchema.safeParse({ op: "publish", channel: "global:trades" }).success).toBe(false);
  });
});
