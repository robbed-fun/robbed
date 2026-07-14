/** REST DTO schema sanity (api.md). */
import { describe, expect, it } from "bun:test";
import {
  apiEnvelopeSchema,
  candleSchema,
  claimCreatorFeeTxMetaSchema,
  claimCreatorTokenFeeTxMetaSchema,
  clampListLimit,
  confirmationsResponseSchema,
  creatorClaimableSchema,
  creatorTokenClaimableSchema,
  ERROR_CODE_VALUES,
  ERROR_CODES,
  errorCodeSchema,
  ethPnlRangeSchema,
  ethUsdResponseSchema,
  feePolicySchema,
  holderListQuerySchema,
  holderRowSchema,
  holderSortFieldSchema,
  keysetCursorSchema,
  listQueryParamsSchema,
  metadataRequestSchema,
  paginatedHoldersResponseSchema,
  paginatedResponseSchema,
  paginatedTradesResponseSchema,
  portfolioActivityResponseSchema,
  portfolioCreatedResponseSchema,
  portfolioHoldingSchema,
  portfolioHoldingsResponseSchema,
  portfolioSummarySchema,
  sortDirSchema,
  tokenCardSchema,
  tokenDetailSchema,
  tokenFilterSchema,
  tokenRefSchema,
  tokenSortSchema,
  tokenStatusSchema,
  tradeListQuerySchema,
  tradeRowSchema,
  tradeSortFieldSchema,
  usdValueSchema,
} from "../src/api-types";
import { LP_COPY, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX } from "../src/constants";

const ADDR = "0x" + "ab".repeat(20);
const HASH = "0x" + "cd".repeat(32);

const usd = { usd: "12345.67", ethUsd: "3500.12", asOf: "2026-07-09T12:00:00Z" };

const card = {
  address: ADDR,
  name: "Cash Cat",
  ticker: "CASHCAT",
  imageUrl: null,
  description: "a community memecoin on ROBBED_", // NEW card field (D-70) — present-but-nullable
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

describe("envelope (api.md)", () => {
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

describe("UsdValue (computed, with asOf; stale flag)", () => {
  it("accepts with and without stale:true, rejects stale:false", () => {
    expect(usdValueSchema.safeParse(usd).success).toBe(true);
    expect(usdValueSchema.safeParse({ ...usd, stale: true }).success).toBe(true);
    expect(usdValueSchema.safeParse({ ...usd, stale: false }).success).toBe(false);
  });
});

describe("TokenCard / TokenDetail ", () => {
  it("parses a valid card; enforces status and confirmationState enums", () => {
    expect(tokenCardSchema.safeParse(card).success).toBe(true);
    expect(tokenCardSchema.safeParse({ ...card, status: "v2" }).success).toBe(false);
    expect(tokenCardSchema.safeParse({ ...card, confirmationState: "confirmed" }).success).toBe(false);
  });

  it("card description (D-70) is present-but-nullable — string|null ok, missing/number rejected", () => {
    expect(tokenCardSchema.safeParse({ ...card, description: null }).success).toBe(true);
    expect(tokenCardSchema.safeParse({ ...card, description: "gm" }).success).toBe(true);
    const { description: _d, ...noDescription } = card;
    // required key (matches TokenDetail's `z.string().nullable()`) — absent ⇒ every producer must emit it
    expect(tokenCardSchema.safeParse(noDescription).success).toBe(false);
    expect(tokenCardSchema.safeParse({ ...card, description: 123 }).success).toBe(false);
  });

  it("tokenStatusSchema is re-exported from api-types after the D-70 move", () => {
    for (const s of ["curve", "graduating", "graduated"]) {
      expect(tokenStatusSchema.safeParse(s).success).toBe(true);
    }
    expect(tokenStatusSchema.safeParse("v2").success).toBe(false);
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
      organic: null, // stats not yet computed
    },
    creator: { address: ADDR, tokensCreated: 3 },
    moderation: { visibility: "visible", impersonationFlag: false },
  };

  it("parses a full detail incl. Trust panel (organic null)", () => {
    expect(tokenDetailSchema.safeParse(detail).success).toBe(true);
  });

  it("accepts a populated organic block; requires the key present ", () => {
    const withOrganic = {
      ...detail,
      trust: {
        ...detail.trust,
        organic: {
          holderPctLow: 41.2, holderPctHigh: 58.7, volumePct: 63.0,
          flaggedClusterVolPct24h: 22.5, methodology: "heuristic — see ",
          updatedAt: "2026-07-10T00:00:00Z",
        },
      },
    };
    expect(tokenDetailSchema.safeParse(withOrganic).success).toBe(true);
    // organic key is required (may be null, but must be present)
    const { organic: _o, ...trustNoOrganic } = detail.trust;
    expect(tokenDetailSchema.safeParse({ ...detail, trust: trustNoOrganic }).success).toBe(false);
  });

  it("lpCopy must be the EXACT canonical sentence (/ CLAUDE.md)", () => {
    const wrong = {
      ...detail,
      trust: { ...detail.trust, lpCopy: "LP principal locked; fees to treasury" },
    };
    expect(tokenDetailSchema.safeParse(wrong).success).toBe(false);
    // even dropping the trailing period must fail — single string constant
    const noPeriod = {
      ...detail,
      trust: { ...detail.trust, lpCopy: LP_COPY.slice(0, -1) },
    };
    expect(tokenDetailSchema.safeParse(noPeriod).success).toBe(false);
  });

  it("lpTokenId is optional (pre-grad absent) and a decimal string when present", () => {
    // Pre-graduation detail carries no lpTokenId — the base fixture omits it.
    expect(tokenDetailSchema.safeParse(detail).success).toBe(true);
    // Graduated detail surfaces the Graduated event's LP NFT tokenId verbatim.
    expect(tokenDetailSchema.safeParse({ ...detail, lpTokenId: "12345" }).success).toBe(true);
    // uint256-as-decimal-string convention — hex/garbage must fail.
    expect(tokenDetailSchema.safeParse({ ...detail, lpTokenId: "0xabc" }).success).toBe(false);
    expect(tokenDetailSchema.safeParse({ ...detail, lpTokenId: 12345 }).success).toBe(false);
  });

  it("creatorFeeBps is present from day 1 ", () => {
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

  it("holder flags restricted to creator|curve|lp_pool|vault ", () => {
    expect(
      holderRowSchema.safeParse({ address: ADDR, balance: "1", pct: 0.1, flags: ["creator", "curve"] }).success,
    ).toBe(true);
    expect(
      holderRowSchema.safeParse({ address: ADDR, balance: "1", pct: 0.1, flags: ["whale"] }).success,
    ).toBe(false);
  });

  it("holder botFlags/clusterId optional; botFlags restricted to vocabulary", () => {
    expect(
      holderRowSchema.safeParse({
        address: ADDR, balance: "1", pct: 0.1, flags: [],
        botFlags: ["farm", "sniper", "arb_exit"], clusterId: "cluster-7",
      }).success,
    ).toBe(true);
    // absent botFlags/clusterId is valid (unflagged holder)
    expect(
      holderRowSchema.safeParse({ address: ADDR, balance: "1", pct: 0.1, flags: [] }).success,
    ).toBe(true);
    expect(
      holderRowSchema.safeParse({ address: ADDR, balance: "1", pct: 0.1, flags: [], botFlags: ["bot"] }).success,
    ).toBe(false);
  });

  it("holder rank is optional, 1-based positive int (additive; stable under any sort)", () => {
    // absent rank stays valid (legacy top-20 projection never sets it)
    expect(holderRowSchema.safeParse({ address: ADDR, balance: "1", pct: 0.1, flags: [] }).success).toBe(true);
    expect(holderRowSchema.safeParse({ address: ADDR, balance: "1", pct: 0.1, flags: [], rank: 3 }).success).toBe(true);
    // 1-based positive integer only
    expect(holderRowSchema.safeParse({ address: ADDR, balance: "1", pct: 0.1, flags: [], rank: 0 }).success).toBe(false);
    expect(holderRowSchema.safeParse({ address: ADDR, balance: "1", pct: 0.1, flags: [], rank: -1 }).success).toBe(false);
    expect(holderRowSchema.safeParse({ address: ADDR, balance: "1", pct: 0.1, flags: [], rank: 1.5 }).success).toBe(false);
  });
});

describe("Sortable + keyset-paginated list tables (api.md; redesign)", () => {
  const tradeRow = {
    id: `${"0x" + "12".repeat(32)}-1`,
    token: ADDR, trader: ADDR, venue: "curve", isBuy: true,
    ethAmount: "1000000000000000000", tokenAmount: "5", feeEth: "10000000000000000",
    priceEth: 1.2e-8, blockNumber: 100, blockTimestamp: 1767950000,
    txHash: "0x" + "12".repeat(32), logIndex: 1, confirmationState: "soft_confirmed",
  };
  const holderRow = { address: ADDR, balance: "1", pct: 0.1, flags: [], rank: 1 };

  it("SortDir is the closed asc|desc enum", () => {
    expect(sortDirSchema.safeParse("asc").success).toBe(true);
    expect(sortDirSchema.safeParse("desc").success).toBe(true);
    expect(sortDirSchema.safeParse("ascending").success).toBe(false);
    expect(sortDirSchema.safeParse("up").success).toBe(false);
  });

  it("TradeSortField allowlist = age|side|trader|amount|price (rejects arbitrary columns)", () => {
    for (const f of ["age", "side", "trader", "amount", "price"]) {
      expect(tradeSortFieldSchema.safeParse(f).success).toBe(true);
    }
    // the security boundary: nothing outside the enum reaches ORDER BY
    expect(tradeSortFieldSchema.safeParse("id").success).toBe(false);
    expect(tradeSortFieldSchema.safeParse("block_timestamp").success).toBe(false);
    expect(tradeSortFieldSchema.safeParse("eth_amount; DROP TABLE trades").success).toBe(false);
  });

  it("HolderSortField allowlist = rank|address|label|amount|percent (rejects columns)", () => {
    for (const f of ["rank", "address", "label", "amount", "percent"]) {
      expect(holderSortFieldSchema.safeParse(f).success).toBe(true);
    }
    // `balance` is the physical column, NOT a sort-field label — must be rejected
    expect(holderSortFieldSchema.safeParse("balance").success).toBe(false);
    expect(holderSortFieldSchema.safeParse("holder").success).toBe(false);
  });

  it("keyset cursor payload = { k, i } strings (sort key + stable tiebreak)", () => {
    expect(keysetCursorSchema.safeParse({ k: "1767950000", i: `${"0x" + "12".repeat(32)}-1` }).success).toBe(true);
    expect(keysetCursorSchema.safeParse({ k: "1", i: ADDR }).success).toBe(true);
    // both members required; both strings (opaque transport form)
    expect(keysetCursorSchema.safeParse({ k: "1" }).success).toBe(false);
    expect(keysetCursorSchema.safeParse({ k: 1, i: "x" }).success).toBe(false);
  });

  it("clampListLimit mirrors apps/api clampLimit: clamps, never throws, defaults", () => {
    expect(clampListLimit(undefined)).toBe(PAGE_LIMIT_DEFAULT);
    expect(clampListLimit("abc")).toBe(PAGE_LIMIT_DEFAULT);
    expect(clampListLimit("0")).toBe(PAGE_LIMIT_DEFAULT);
    expect(clampListLimit("-3")).toBe(PAGE_LIMIT_DEFAULT);
    expect(clampListLimit(0)).toBe(PAGE_LIMIT_DEFAULT);
    expect(clampListLimit("20")).toBe(20);
    expect(clampListLimit(20)).toBe(20);
    // over-large clamps DOWN (never a 400)
    expect(clampListLimit("200")).toBe(PAGE_LIMIT_MAX);
    expect(clampListLimit(10_000)).toBe(PAGE_LIMIT_MAX);
    // fractional floors
    expect(clampListLimit("20.9")).toBe(20);
  });

  it("list query: sort/dir/cursor optional, limit always a bounded number", () => {
    // empty query → only the defaulted limit; optionals absent
    const empty = tradeListQuerySchema.parse({});
    expect(empty).toEqual({ limit: PAGE_LIMIT_DEFAULT });
    // full query, limit as a string (query params arrive as strings) → clamped number
    const full = tradeListQuerySchema.parse({ sort: "amount", dir: "asc", cursor: "c1", limit: "20" });
    expect(full).toEqual({ sort: "amount", dir: "asc", cursor: "c1", limit: 20 });
    // over-large limit clamps rather than 400s
    expect(tradeListQuerySchema.parse({ limit: "999" }).limit).toBe(PAGE_LIMIT_MAX);
    // allowlist enforced through the factory (rejects arbitrary sort / dir)
    expect(tradeListQuerySchema.safeParse({ sort: "bogus" }).success).toBe(false);
    expect(tradeListQuerySchema.safeParse({ dir: "up" }).success).toBe(false);
  });

  it("holder list query uses the holder field enum (rank ok, balance rejected)", () => {
    expect(holderListQuerySchema.parse({ sort: "rank", dir: "desc" })).toEqual({
      sort: "rank", dir: "desc", limit: PAGE_LIMIT_DEFAULT,
    });
    expect(holderListQuerySchema.safeParse({ sort: "balance" }).success).toBe(false);
  });

  it("generic factory + concrete envelopes are structurally identical", () => {
    // the factory called ad-hoc equals the exported concrete schema
    const adhoc = listQueryParamsSchema(tradeSortFieldSchema);
    expect(adhoc.safeParse({ sort: "price", limit: "5" }).success).toBe(true);
    // { items, nextCursor } envelope over the shared row schemas
    expect(paginatedTradesResponseSchema.safeParse({ items: [tradeRow], nextCursor: null }).success).toBe(true);
    expect(paginatedHoldersResponseSchema.safeParse({ items: [holderRow], nextCursor: "c1" }).success).toBe(true);
    // wrong row type is rejected by the item schema
    expect(paginatedTradesResponseSchema.safeParse({ items: [holderRow], nextCursor: null }).success).toBe(false);
    // nextCursor is string | null, never absent
    expect(paginatedTradesResponseSchema.safeParse({ items: [tradeRow] }).success).toBe(false);
    // generic factory works over any shared row schema
    const generic = paginatedResponseSchema(tradeRowSchema);
    expect(generic.safeParse({ items: [tradeRow], nextCursor: "next" }).success).toBe(true);
  });
});

describe("Portfolio (ROBBED_ redesign page 4)", () => {
  const holding = {
    token: { address: ADDR, name: "Cash Cat", ticker: "CASHCAT", imageUrl: null, graduated: false, status: "curve" },
    balance: "1000000000000000000000",
    priceEth: 8.1e-9,
    valueEth: "8100000000000",
    value: usd,
    unrealizedPnl: { low: "-2000000000000", high: "1500000000000", confidence: "estimated" },
  };

  it("tokenRef is the card `.pick` subset (single source, no extra keys)", () => {
    expect(tokenRefSchema.safeParse(holding.token).success).toBe(true);
    // fields outside the picked set are stripped, not an error (structural subset)
    expect(tokenRefSchema.safeParse({ ...holding.token, priceEth: 1 }).success).toBe(true);
    expect(tokenRefSchema.safeParse({ ...holding.token, status: "v2" }).success).toBe(false);
  });

  it("ethPnlRange enforces low ≤ high (bigint) and the confidence enum", () => {
    expect(ethPnlRangeSchema.safeParse({ low: "-5", high: "5", confidence: "exact" }).success).toBe(true);
    // equal bound = precisely-known point value
    expect(ethPnlRangeSchema.safeParse({ low: "42", high: "42", confidence: "exact" }).success).toBe(true);
    // low > high rejected — compared as bigint (beyond 2^53)
    expect(
      ethPnlRangeSchema.safeParse({ low: "10000000000000000000000", high: "9999999999999999999999", confidence: "estimated" }).success,
    ).toBe(false);
    expect(ethPnlRangeSchema.safeParse({ low: "-5", high: "5", confidence: "guess" }).success).toBe(false);
    // non-integer / float strings rejected (signed decimal only)
    expect(ethPnlRangeSchema.safeParse({ low: "1.5", high: "5", confidence: "exact" }).success).toBe(false);
  });

  it("summary carries LOOT/value/first-seen; no confirmationState (aggregate)", () => {
    const summary = {
      address: ADDR,
      firstSeenAt: 1767950000,
      tradeCount: 12,
      tokensCreated: 2,
      walletEthBalance: "500000000000000000",
      totalValueEth: "8100000000000",
      totalValue: usd,
      pnlAllTime: { low: "-2000000000000", high: "1500000000000", confidence: "estimated" },
    };
    expect(portfolioSummarySchema.safeParse(summary).success).toBe(true);
    // pnlAllTime nullable (no cost basis at all), firstSeenAt nullable (never seen)
    expect(portfolioSummarySchema.safeParse({ ...summary, pnlAllTime: null, firstSeenAt: null }).success).toBe(true);
    // key must be present even when null
    const { pnlAllTime: _p, ...noPnl } = summary;
    expect(portfolioSummarySchema.safeParse(noPnl).success).toBe(false);
    // confirmationState is NOT part of the aggregate shape — extra key stripped, still valid
    expect(portfolioSummarySchema.safeParse({ ...summary, confirmationState: "soft_confirmed" }).success).toBe(true);
  });

  it("holding: priceable row vs unpriceable (nulls, no false precision)", () => {
    expect(portfolioHoldingSchema.safeParse(holding).success).toBe(true);
    // never-traded token: price/value/pnl all null, balance still exact
    const unpriceable = { ...holding, priceEth: null, valueEth: null, value: null, unrealizedPnl: null };
    expect(portfolioHoldingSchema.safeParse(unpriceable).success).toBe(true);
    // balance is required Transfer-truth
    const { balance: _b, ...noBalance } = holding;
    expect(portfolioHoldingSchema.safeParse(noBalance).success).toBe(false);
  });

  it("responses: holdings/activity(reuses TradeRow)/created(reuses TokenCard)", () => {
    expect(portfolioHoldingsResponseSchema.safeParse({ holdings: [holding], nextCursor: null }).success).toBe(true);
    const trade = {
      id: `${"0x" + "12".repeat(32)}-1`,
      token: ADDR, trader: ADDR, venue: "curve", isBuy: true,
      ethAmount: "1000000000000000000", tokenAmount: "5", feeEth: "10000000000000000",
      priceEth: 1.2e-8, blockNumber: 100, blockTimestamp: 1767950000,
      txHash: "0x" + "12".repeat(32), logIndex: 1, confirmationState: "soft_confirmed",
    };
    expect(portfolioActivityResponseSchema.safeParse({ activity: [trade], nextCursor: "c1" }).success).toBe(true);
    expect(portfolioCreatedResponseSchema.safeParse({ tokens: [card], nextCursor: null }).success).toBe(true);
  });
});

describe("creator-fee claim surface ", () => {
  const claimable = {
    creator: ADDR,
    vault: ADDR,
    claimableEth: "7500000000000000",
    claimable: usd,
    totalAccruedEth: "9000000000000000",
    totalClaimedEth: "1500000000000000",
    asOf: "2026-07-13T00:00:00Z",
  };

  it("claimable balance DTO: wei decimal strings + usd mirror, no confirmationState", () => {
    expect(creatorClaimableSchema.safeParse(claimable).success).toBe(true);
    // uint256-as-decimal convention — hex/number rejected
    expect(creatorClaimableSchema.safeParse({ ...claimable, claimableEth: "0xabc" }).success).toBe(false);
    expect(creatorClaimableSchema.safeParse({ ...claimable, claimableEth: 7500 }).success).toBe(false);
    // aggregate roll-up carries no confirmationState — extra key stripped, still valid
    expect(
      creatorClaimableSchema.safeParse({ ...claimable, confirmationState: "soft_confirmed" }).success,
    ).toBe(true);
    // usd mirror is required (derived)
    const { claimable: _c, ...noUsd } = claimable;
    expect(creatorClaimableSchema.safeParse(noUsd).success).toBe(false);
  });

  it("CLAIM_CREATOR_FEE tx metadata: literal-tagged, address + wei amount", () => {
    const meta = { type: "CLAIM_CREATOR_FEE", creator: ADDR, vault: ADDR, amountEth: "7500000000000000" };
    expect(claimCreatorFeeTxMetaSchema.safeParse(meta).success).toBe(true);
    // the literal tag is fixed (seeds a future discriminated union)
    expect(claimCreatorFeeTxMetaSchema.safeParse({ ...meta, type: "CLAIM" }).success).toBe(false);
    // amount is a uint256 decimal string, not a float / number
    expect(claimCreatorFeeTxMetaSchema.safeParse({ ...meta, amountEth: "0.0075" }).success).toBe(false);
    expect(claimCreatorFeeTxMetaSchema.safeParse({ ...meta, creator: "not-an-address" }).success).toBe(false);
  });
});

describe("feePolicy additive cap (un-frozen creator leg)", () => {
  it("accepts the mainnet default: tradeFeeBps 100 + creatorFeeBps 50 (=150 ≤ 200)", () => {
    expect(feePolicySchema.safeParse({ tradeFeeBps: 100, creatorFeeBps: 50 }).success).toBe(true);
    // legacy/testnet-only v1 curve reads 0 — still valid (backward-compatible)
    expect(feePolicySchema.safeParse({ tradeFeeBps: 100, creatorFeeBps: 0 }).success).toBe(true);
    // exactly the cap is allowed (gate-2 boundary)
    expect(feePolicySchema.safeParse({ tradeFeeBps: 100, creatorFeeBps: 100 }).success).toBe(true);
  });

  it("rejects a combined fee over the 200-bps hard cap (drift-proof vs contract)", () => {
    expect(feePolicySchema.safeParse({ tradeFeeBps: 150, creatorFeeBps: 100 }).success).toBe(false);
    expect(feePolicySchema.safeParse({ tradeFeeBps: 200, creatorFeeBps: 1 }).success).toBe(false);
    // non-integer / negative bps still rejected by the field schema
    expect(feePolicySchema.safeParse({ tradeFeeBps: 100, creatorFeeBps: -1 }).success).toBe(false);
    expect(feePolicySchema.safeParse({ tradeFeeBps: 100, creatorFeeBps: 1.5 }).success).toBe(false);
  });
});

describe("post-grad creator LP-fee split surface (50/50, Option-B custody)", () => {
  // per-(creator, ERC20-token) SINGLE-asset — matches claimERC20(creator, token) 1:1.
  const tokenClaimable = {
    creator: ADDR,
    token: ADDR, // the ERC20: a graduated launch token OR WETH
    vault: ADDR,
    claimable: "100000000000000000000",
    claimableUsd: usd,
    totalAccrued: "123000000000000000000",
    totalClaimed: "23000000000000000000",
    asOf: "2026-07-13T00:00:00Z",
  };

  it("per-(creator,ERC20) single-asset claimable DTO: wei decimal strings, no confirmationState", () => {
    expect(creatorTokenClaimableSchema.safeParse(tokenClaimable).success).toBe(true);
    // uint256-as-decimal convention — hex/number rejected
    expect(creatorTokenClaimableSchema.safeParse({ ...tokenClaimable, claimable: "0xabc" }).success).toBe(false);
    expect(creatorTokenClaimableSchema.safeParse({ ...tokenClaimable, claimable: 7500 }).success).toBe(false);
    // the ERC20 token dimension is required (distinguishes from the per-creator native-ETH roll-up)
    const { token: _t, ...noToken } = tokenClaimable;
    expect(creatorTokenClaimableSchema.safeParse(noToken).success).toBe(false);
    // usd mirror is nullable (only WETH legs are ETH-priced; launch-token legs are null)
    expect(creatorTokenClaimableSchema.safeParse({ ...tokenClaimable, claimableUsd: null }).success).toBe(true);
  });

  it("CLAIM_CREATOR_TOKEN_FEE tx metadata: literal-tagged, single-asset expected payout", () => {
    const meta = {
      type: "CLAIM_CREATOR_TOKEN_FEE",
      creator: ADDR,
      token: ADDR,
      vault: ADDR,
      amount: "100000000000000000000",
    };
    expect(claimCreatorTokenFeeTxMetaSchema.safeParse(meta).success).toBe(true);
    // distinct literal tag from the pre-grad native-ETH claim
    expect(claimCreatorTokenFeeTxMetaSchema.safeParse({ ...meta, type: "CLAIM_CREATOR_FEE" }).success).toBe(false);
    expect(claimCreatorTokenFeeTxMetaSchema.safeParse({ ...meta, amount: "0.0075" }).success).toBe(false);
  });
});

describe("error codes (closed enum, single source — X-9/api)", () => {
  it("apiError.code accepts only the enumerated codes", () => {
    const env = apiEnvelopeSchema(tokenCardSchema);
    expect(env.safeParse({ data: null, error: { code: "rate_limited", message: "slow down" } }).success).toBe(true);
    expect(env.safeParse({ data: null, error: { code: "teapot", message: "x" } }).success).toBe(false);
  });

  it("ERROR_CODES map and errorCodeSchema derive from the same tuple", () => {
    for (const c of ERROR_CODE_VALUES) {
      expect(errorCodeSchema.safeParse(c).success).toBe(true);
      expect(ERROR_CODES[c]).toBe(c);
    }
  });

  it("includes the ratified upstream_unavailable + conflict members (api.md)", () => {
    // These must stay in lockstep with openapi.yaml Error.code (removing either
    // breaks this assertion): upstream_unavailable = 500 / readyz-503 path,
    // conflict = stored-state conflict (e.g. unknown imageHash).
    expect(ERROR_CODE_VALUES).toContain("upstream_unavailable");
    expect(ERROR_CODE_VALUES).toContain("conflict");
    expect(errorCodeSchema.safeParse("upstream_unavailable").success).toBe(true);
    expect(errorCodeSchema.safeParse("conflict").success).toBe(true);
  });
});

describe("misc endpoints", () => {
  it("confirmations (SSR initial state)", () => {
    expect(
      confirmationsResponseSchema.safeParse({
        safeBlock: 1000, finalizedBlock: 500, latestBlock: 1200, updatedAt: "2026-07-09T12:00:00Z",
      }).success,
    ).toBe(true);
  });

  it("eth-usd carries source + asOf (hard rule: never a constant)", () => {
    expect(
      ethUsdResponseSchema.safeParse({ price: 3500.12, source: "chainlink:4663", asOf: "2026-07-09T12:00:00Z" }).success,
    ).toBe(true);
    expect(ethUsdResponseSchema.safeParse({ price: 3500.12 }).success).toBe(false);
  });

  it("sorts and filters ", () => {
    for (const s of ["trending", "newest", "mcap", "volume24h", "progress"]) {
      expect(tokenSortSchema.safeParse(s).success).toBe(true);
    }
    for (const f of ["pregrad", "graduated", "all"]) {
      expect(tokenFilterSchema.safeParse(f).success).toBe(true);
    }
    expect(tokenSortSchema.safeParse("holders").success).toBe(false);
  });

  it("metadata request body — name ≤32 BYTES / ticker ≤10 BYTES ", () => {
    const body = { name: "Cash Cat", ticker: "CASHCAT", imageUrl: "https://cdn.x/i.webp", imageHash: HASH };
    expect(metadataRequestSchema.safeParse(body).success).toBe(true);
    // ASCII boundary
    expect(metadataRequestSchema.safeParse({ ...body, name: "x".repeat(32) }).success).toBe(true);
    expect(metadataRequestSchema.safeParse({ ...body, name: "x".repeat(33) }).success).toBe(false);
    expect(metadataRequestSchema.safeParse({ ...body, ticker: "y".repeat(10) }).success).toBe(true);
    expect(metadataRequestSchema.safeParse({ ...body, ticker: "ELEVENCHARS" }).success).toBe(false);
    // multibyte: under char-limit, over byte-limit → reject (same gate as the doc schema)
    expect(metadataRequestSchema.safeParse({ ...body, ticker: "Ü".repeat(6) }).success).toBe(false);
    expect(metadataRequestSchema.safeParse({ ...body, name: "🚀".repeat(9) }).success).toBe(false);
    expect(metadataRequestSchema.safeParse({ ...body, links: { telegram: "not-a-url" } }).success).toBe(false);
  });
});
