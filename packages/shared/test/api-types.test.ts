/** REST DTO schema sanity (api.md §2/§3/§5). */
import { describe, expect, it } from "bun:test";
import {
  apiEnvelopeSchema,
  candleSchema,
  confirmationsResponseSchema,
  ethUsdResponseSchema,
  holderRowSchema,
  metadataRequestSchema,
  tokenCardSchema,
  tokenDetailSchema,
  tokenFilterSchema,
  tokenSortSchema,
  tradeRowSchema,
  usdValueSchema,
} from "../src/api-types";
import { LP_COPY } from "../src/constants";

const ADDR = "0x" + "ab".repeat(20);
const HASH = "0x" + "cd".repeat(32);

const usd = { usd: "12345.67", ethUsd: "3500.12", asOf: "2026-07-09T12:00:00Z" };

const card = {
  address: ADDR,
  name: "Cash Cat",
  ticker: "CASHCAT",
  imageUrl: null,
  creator: ADDR,
  createdAt: 1767950000,
  priceEth: 8.1e-9,
  mcap: usd,
  progressPct: 42.5,
  change24hPct: -3.2,
  volume24h: "9000000000000000000",
  graduated: false,
  status: "curve",
  confirmationState: "soft_confirmed",
  moderation: { visibility: "visible", impersonationFlag: false },
};

describe("envelope (api.md §2)", () => {
  const env = apiEnvelopeSchema(tokenCardSchema);
  it("success: { data, error: null }", () => {
    expect(env.safeParse({ data: card, error: null }).success).toBe(true);
  });
  it("failure: { data: null, error: { code, message } }", () => {
    expect(env.safeParse({ data: null, error: { code: "not_found", message: "nope" } }).success).toBe(true);
  });
  it("rejects data+error both set", () => {
    expect(env.safeParse({ data: card, error: { code: "x", message: "y" } }).success).toBe(false);
  });
});

describe("UsdValue (§2: computed, with asOf; stale flag)", () => {
  it("accepts with and without stale:true, rejects stale:false", () => {
    expect(usdValueSchema.safeParse(usd).success).toBe(true);
    expect(usdValueSchema.safeParse({ ...usd, stale: true }).success).toBe(true);
    expect(usdValueSchema.safeParse({ ...usd, stale: false }).success).toBe(false);
  });
});

describe("TokenCard / TokenDetail (§5.1/§5.2)", () => {
  it("parses a valid card; enforces status and confirmationState enums", () => {
    expect(tokenCardSchema.safeParse(card).success).toBe(true);
    expect(tokenCardSchema.safeParse({ ...card, status: "v2" }).success).toBe(false);
    expect(tokenCardSchema.safeParse({ ...card, confirmationState: "confirmed" }).success).toBe(false);
  });

  const detail = {
    ...card,
    description: "meow",
    links: { website: "https://cashcat.example" },
    curveAddress: ADDR,
    supply: { total: "1000000000000000000000000000", curveHeld: "793100000000000000000000000", lpTranche: "206900000000000000000000000" },
    reserves: { virtualEth: "1", virtualToken: "2", realEth: "3", realToken: "4" },
    graduation: { thresholdEth: "12000000000000000000", progressPct: 42.5 },
    trust: {
      metadataVerification: { status: "match", onchainHash: HASH, computedHash: HASH, verifiedAt: "2026-07-09T12:00:00Z" },
      lpCopy: LP_COPY,
      feePolicy: { tradeFeeBps: 100, creatorFeeBps: 0 },
    },
    creator: { address: ADDR, tokensCreated: 3 },
    moderation: { visibility: "visible", impersonationFlag: false },
  };

  it("parses a full detail incl. Trust panel", () => {
    expect(tokenDetailSchema.safeParse(detail).success).toBe(true);
  });

  it("lpCopy must be the EXACT canonical sentence (spec §12.14 / CLAUDE.md)", () => {
    const wrong = {
      ...detail,
      trust: { ...detail.trust, lpCopy: "LP burned forever" },
    };
    expect(tokenDetailSchema.safeParse(wrong).success).toBe(false);
    // even dropping the trailing period must fail — single string constant
    const noPeriod = {
      ...detail,
      trust: { ...detail.trust, lpCopy: LP_COPY.slice(0, -1) },
    };
    expect(tokenDetailSchema.safeParse(noPeriod).success).toBe(false);
  });

  it("creatorFeeBps is present from day 1 (§7)", () => {
    const { feePolicy: _fp, ...trustNoFee } = detail.trust;
    expect(
      tokenDetailSchema.safeParse({ ...detail, trust: trustNoFee }).success,
    ).toBe(false);
  });
});

describe("TradeRow / Candle / HolderRow", () => {
  it("trade row with venue + confirmationState", () => {
    const row = {
      id: `${"0x" + "12".repeat(32)}-2`,
      token: ADDR, trader: ADDR, venue: "v3", isBuy: false,
      ethAmount: "1000000000000000000", tokenAmount: "5", feeEth: "0",
      priceEth: 1.2e-8, blockNumber: 100, blockTimestamp: 1767950000,
      txHash: "0x" + "12".repeat(32), logIndex: 2, confirmationState: "posted_to_l1",
    };
    expect(tradeRowSchema.safeParse(row).success).toBe(true);
    expect(tradeRowSchema.safeParse({ ...row, venue: "uniswap" }).success).toBe(false);
  });

  it("candle", () => {
    expect(
      candleSchema.safeParse({
        bucketStart: 1767950000, open: 1, high: 2, low: 0.5, close: 1.5,
        volumeEth: "10", volumeToken: "20", tradeCount: 3,
      }).success,
    ).toBe(true);
  });

  it("holder flags restricted to creator|curve|lp_pool|vault (§5.2)", () => {
    expect(
      holderRowSchema.safeParse({ address: ADDR, balance: "1", pct: 0.1, flags: ["creator", "curve"] }).success,
    ).toBe(true);
    expect(
      holderRowSchema.safeParse({ address: ADDR, balance: "1", pct: 0.1, flags: ["whale"] }).success,
    ).toBe(false);
  });
});

describe("misc endpoints", () => {
  it("confirmations (§2.1 SSR initial state)", () => {
    expect(
      confirmationsResponseSchema.safeParse({
        safeBlock: 1000, finalizedBlock: 500, latestBlock: 1200, updatedAt: "2026-07-09T12:00:00Z",
      }).success,
    ).toBe(true);
  });

  it("eth-usd carries source + asOf (§2 hard rule: never a constant)", () => {
    expect(
      ethUsdResponseSchema.safeParse({ price: 3500.12, source: "chainlink:4663", asOf: "2026-07-09T12:00:00Z" }).success,
    ).toBe(true);
    expect(ethUsdResponseSchema.safeParse({ price: 3500.12 }).success).toBe(false);
  });

  it("sorts and filters (§5.1)", () => {
    for (const s of ["trending", "newest", "mcap", "volume24h", "progress"]) {
      expect(tokenSortSchema.safeParse(s).success).toBe(true);
    }
    for (const f of ["pregrad", "graduated", "all"]) {
      expect(tokenFilterSchema.safeParse(f).success).toBe(true);
    }
    expect(tokenSortSchema.safeParse("holders").success).toBe(false);
  });

  it("metadata request body (api.md §3.2 limits)", () => {
    const body = { name: "Cash Cat", ticker: "CASHCAT", imageUrl: "https://cdn.x/i.webp", imageHash: HASH };
    expect(metadataRequestSchema.safeParse(body).success).toBe(true);
    expect(metadataRequestSchema.safeParse({ ...body, ticker: "ELEVENCHARS" }).success).toBe(false);
    expect(metadataRequestSchema.safeParse({ ...body, links: { telegram: "not-a-url" } }).success).toBe(false);
  });
});
