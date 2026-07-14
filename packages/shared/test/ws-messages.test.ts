/** WS message envelope + per-type schemas (indexer.md). */
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

describe("per-type payloads (indexer.md)", () => {
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
    ).toBe(false); // not in the ratified set
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

  it("confirmations watermark + reorg (indexer.md)", () => {
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

  it("creator_fee_split parses (post-grad 50/50) — both beneficiaries, both legs", () => {
    const msg = {
      ...base, type: "creator_fee_split", channel: `token:${ADDR}:events`,
      data: {
        token: ADDR, creator: ADDR,
        creatorAmountToken: "50000000000000000000", creatorAmountWeth: "2250000000000000",
        treasuryAmountToken: "50000000000000000000", treasuryAmountWeth: "2250000000000000",
        blockNumber: 12345, blockTimestamp: 1767950000,
        txHash: TX, logIndex: 4, confirmationState: "soft_confirmed",
      },
    };
    expect(wsMessageSchema.safeParse(msg).success).toBe(true);
    // uint256 legs are decimal strings — numbers rejected
    expect(
      wsMessageSchema.safeParse({ ...msg, data: { ...msg.data, creatorAmountWeth: 2250 } }).success,
    ).toBe(false);
  });

  it("creator_fee_claimed parses (post-grad claim) — single ERC20 payout", () => {
    const msg = {
      ...base, type: "creator_fee_claimed", channel: `token:${ADDR}:events`,
      data: {
        creator: ADDR, token: ADDR, // token = the ERC20 claimed (launchToken or WETH)
        amount: "100000000000000000000",
        blockNumber: 12346, blockTimestamp: 1767950001,
        txHash: TX, logIndex: 5, confirmationState: "soft_confirmed",
      },
    };
    expect(wsMessageSchema.safeParse(msg).success).toBe(true);
    // single-asset — the two-leg (amountToken/amountWeth) shape is rejected
    expect(
      wsMessageSchema.safeParse({ ...msg, data: { ...msg.data, amount: 100 } }).success,
    ).toBe(false);
  });

  it("token_metrics (D-70 live aggregate snapshot) — reuses card scalars, ETH-denominated", () => {
    const msg = {
      ...base, type: "token_metrics", channel: "global:metrics",
      data: {
        token: ADDR, priceEth: 8.1e-9, mcapEth: "8100000000000000000",
        volume24h: "9000000000000000000", change24hPct: -3.2, progressPct: 0.425,
        status: "curve", graduated: false, blockNumber: 12345, ts: 1767950000,
      },
    };
    expect(wsMessageSchema.safeParse(msg).success).toBe(true);
    // priceEth/change24hPct are nullable (pre-first-trade)
    expect(
      wsMessageSchema.safeParse({ ...msg, data: { ...msg.data, priceEth: null, change24hPct: null } }).success,
    ).toBe(true);
    // ETH aggregates are decimal strings (uint256 wei) — floats/numbers rejected
    expect(wsMessageSchema.safeParse({ ...msg, data: { ...msg.data, mcapEth: 8.1 } }).success).toBe(false);
    expect(wsMessageSchema.safeParse({ ...msg, data: { ...msg.data, volume24h: 9000 } }).success).toBe(false);
    // status is the SHARED tokenStatusSchema enum (moved to token-status.ts) — junk rejected
    expect(wsMessageSchema.safeParse({ ...msg, data: { ...msg.data, status: "v2" } }).success).toBe(false);
    expect(
      wsMessageSchema.safeParse({ ...msg, data: { ...msg.data, status: "graduated", graduated: true } }).success,
    ).toBe(true);
    // mcapEth is REQUIRED here (indexer always recomputes it) — absent ⇒ reject
    const { mcapEth: _m, ...noMcap } = msg.data;
    expect(wsMessageSchema.safeParse({ ...msg, data: noMcap }).success).toBe(false);
  });

  it("union stays exhaustive — fee-family + token_metrics members are all WsMessageType", () => {
    const types: WsMessage["type"][] = [
      "fee_collected", "creator_fee_split", "creator_fee_claimed", "token_metrics",
    ];
    expect(types).toContain("fee_collected");
    expect(types).toContain("creator_fee_split");
    expect(types).toContain("creator_fee_claimed");
    expect(types).toContain("token_metrics");
  });
});

describe("client ops (sub/unsub/ping only — api.md)", () => {
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
