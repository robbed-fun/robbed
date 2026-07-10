import {
  LP_COPY,
  type HolderRow,
  type OrganicFlow,
  type TokenCard,
  type TokenDetail,
  type TradeRow,
  type UsdValue,
} from "@robbed/shared";

/**
 * Test fixtures for Discover (§5.1). Values mirror the frozen `@robbed/shared`
 * shapes exactly — no field is invented. Metrics are supplied indexer values
 * (mcap carries source+asOf; volume/Δ% are aggregates), never computed here.
 */

export function usdValue(over: Partial<UsdValue> = {}): UsdValue {
  return {
    usd: "12345",
    ethUsd: "3450",
    asOf: "2026-07-10T00:00:00Z",
    ...over,
  };
}

export function tokenCard(over: Partial<TokenCard> = {}): TokenCard {
  const address =
    over.address ?? "0x00000000000000000000000000000000000000aa";
  return {
    address,
    name: "Hoodie Coin",
    ticker: "HOODIE",
    imageUrl: null,
    creator: "0x00000000000000000000000000000000000000bb",
    createdAt: Math.floor(Date.now() / 1000) - 300,
    priceEth: 0.00021,
    mcap: usdValue(),
    progressPct: 42.5,
    change24hPct: 12.34,
    volume24h: "1500000000000000000",
    graduated: false,
    status: "curve",
    confirmationState: "soft_confirmed",
    moderation: { visibility: "visible", impersonationFlag: false },
    ...over,
  };
}

export function organicFlow(over: Partial<OrganicFlow> = {}): OrganicFlow {
  return {
    holderPctLow: 55,
    holderPctHigh: 70,
    volumePct: 62,
    flaggedClusterVolPct24h: 18,
    methodology: "heuristic — see §8.5",
    updatedAt: "2026-07-10T00:00:00Z",
    ...over,
  };
}

export function tokenDetail(over: Partial<TokenDetail> = {}): TokenDetail {
  const base = tokenCard(over as Partial<TokenCard>);
  return {
    ...base,
    description: "A community memecoin on ROBBED_.",
    links: { website: "https://example.com", x: "https://x.com/hoodie" },
    curveAddress: "0x00000000000000000000000000000000000000c0",
    supply: {
      total: "1000000000000000000000000000",
      curveHeld: "800000000000000000000000000",
      lpTranche: "206900000000000000000000000",
    },
    reserves: {
      // Deliberately DIFFERENT from the on-chain reads in tests, to prove the
      // Trust panel renders the live read, not this cached API value.
      virtualEth: "1000000000000000000",
      virtualToken: "1073000000000000000000000000",
      realEth: "9999000000000000000",
      realToken: "500000000000000000000000000",
    },
    graduation: { thresholdEth: "8076868822140981824", progressPct: 42.5 },
    trust: {
      metadataVerification: {
        status: "match",
        onchainHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
      lpCopy: LP_COPY,
      feePolicy: { tradeFeeBps: 100, creatorFeeBps: 0 },
      organic: organicFlow(),
    },
    creator: {
      address: base.creator,
      tokensCreated: 3,
    },
    moderation: { visibility: "visible", impersonationFlag: false },
    ...over,
  };
}

export function holderRow(over: Partial<HolderRow> = {}): HolderRow {
  return {
    address: "0x00000000000000000000000000000000000000d1",
    balance: "50000000000000000000000000",
    pct: 5,
    flags: [],
    ...over,
  };
}

export function tradeRow(over: Partial<TradeRow> = {}): TradeRow {
  return {
    id: "0xabc-0",
    token: "0x00000000000000000000000000000000000000aa",
    trader: "0x00000000000000000000000000000000000000ee",
    venue: "curve",
    isBuy: true,
    ethAmount: "500000000000000000",
    tokenAmount: "1200000000000000000000000",
    feeEth: "5000000000000000",
    priceEth: 0.00021,
    blockNumber: 100,
    blockTimestamp: Math.floor(Date.now() / 1000) - 30,
    txHash:
      "0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcab",
    logIndex: 0,
    confirmationState: "soft_confirmed",
    ...over,
  };
}
