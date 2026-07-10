/** WS message envelope + per-type schemas (indexer.md §8.2). */
import { describe, expect, it } from "bun:test";
import {
  wsClientOpSchema,
  wsMessageSchema,
  type WsMessage,
} from "../src/ws-messages";
import { feeCollectionEntrySchema } from "../src/api-types";

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

  it("fee_collected parses (X-6) and its data reconciles with the REST fee entry", () => {
    const msg = {
      ...base, type: "fee_collected", channel: `token:${ADDR}:events`,
      data: {
        token: ADDR, recipient: ADDR,
        amountToken: "123000000000000000000", amountWeth: "4500000000000000",
        blockNumber: 12345, blockTimestamp: 1767950000,
        txHash: TX, logIndex: 3, confirmationState: "soft_confirmed",
      },
    };
    const parsed = wsMessageSchema.safeParse(msg);
    expect(parsed.success).toBe(true);
    // one fee shape: the WS data projects onto the REST feeCollectionEntry (D2 parity)
    const d = msg.data;
    expect(
      feeCollectionEntrySchema.safeParse({
        id: `${d.txHash}-${d.logIndex}`,
        amountToken: d.amountToken, amountWeth: d.amountWeth, recipient: d.recipient,
        blockTimestamp: d.blockTimestamp, txHash: d.txHash, confirmationState: d.confirmationState,
      }).success,
    ).toBe(true);
    // amounts are decimal strings — numbers rejected
    expect(
      wsMessageSchema.safeParse({ ...msg, data: { ...d, amountWeth: 4500 } }).success,
    ).toBe(false);
  });

  it("union stays exhaustive — 'fee_collected' is a member of WsMessageType", () => {
    const t: WsMessage["type"] = "fee_collected";
    expect(t).toBe("fee_collected");
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
