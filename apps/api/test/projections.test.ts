/**
 * M2-9 projections: TokenCard / TokenDetail validate against the FROZEN shared
 * schemas (never redeclared), status derivation, confirmationState projection,
 * Trust panel (exact LP constant + organic RANGE), and the 5 sort keys.
 */
import { describe, expect, it } from "bun:test";
import { LP_COPY, tokenCardSchema, tokenDetailSchema } from "@robbed/shared";
import { toTokenCard } from "../src/projections/card";
import { toTokenDetail } from "../src/projections/detail";
import { sortKeyForRow } from "../src/search/sort";
import { loadRankingConfig } from "../src/config/ranking";
import { fixtureToken } from "./helpers";

const WM = { safe_block: 100, finalized_block: 50 };
const SNAP = { price_usd: 2000, fetched_at: new Date().toISOString() };

describe("toTokenCard", () => {
  it("produces a schema-valid card with USD mcap carrying asOf (never a constant)", () => {
    const card = toTokenCard(fixtureToken(), WM, SNAP);
    expect(() => tokenCardSchema.parse(card)).not.toThrow();
    expect(card.mcap.asOf).toBe(SNAP.fetched_at);
    expect(card.mcap.ethUsd).toBe("2000");
  });
  it("derives status curve / graduating / graduated", () => {
    expect(toTokenCard(fixtureToken(), WM, SNAP).status).toBe("curve");
    const grad = fixtureToken({ real_eth_reserves: (90n * 10n ** 18n).toString() });
    expect(toTokenCard(grad, WM, SNAP).status).toBe("graduating");
    expect(toTokenCard(fixtureToken({ graduated: true }), WM, SNAP).status).toBe("graduated");
  });
  it("projects confirmationState from watermarks", () => {
    expect(toTokenCard(fixtureToken({ block_number: 120 }), WM, SNAP).confirmationState).toBe("soft_confirmed");
    expect(toTokenCard(fixtureToken({ block_number: 80 }), WM, SNAP).confirmationState).toBe("posted_to_l1");
    expect(toTokenCard(fixtureToken({ block_number: 40 }), WM, SNAP).confirmationState).toBe("finalized");
  });
  it("marks USD stale when the snapshot is old", () => {
    const card = toTokenCard(fixtureToken(), WM, { price_usd: 2000, fetched_at: new Date(0).toISOString() });
    expect(card.mcap.stale).toBe(true);
  });
  it("materializes mcapEth as an exact wei string (ETH-first source, integer-space)", () => {
    // price 3e-8 ETH/token × 1e9 tokens = 30 ETH = 3e19 wei (no float loss).
    const card = toTokenCard(fixtureToken(), WM, SNAP);
    expect(card.mcapEth).toBe((30n * 10n ** 18n).toString());
  });
  it("omits no mcapEth: it is '0' before the first trade (price null)", () => {
    expect(toTokenCard(fixtureToken({ last_price_eth: null }), WM, SNAP).mcapEth).toBe("0");
  });
  it("computes a real (non-null) change24hPct from the shared 24h anchor", () => {
    // §12.40e: (last − anchor)/anchor × 100. Old token, anchor candle close 2.0.
    const now = 1_700_000_300_000;
    const nowSec = Math.floor(now / 1000);
    const card = toTokenCard(
      fixtureToken({ last_price_eth: 3.0, created_at: nowSec - 5 * 86_400 }),
      WM,
      SNAP,
      now,
      { firstTradePrice: 0.5, hourCandles: [{ bucket_start: nowSec - 86_400 - 3600, close: 2.0 }] },
    );
    expect(card.change24hPct).not.toBeNull();
    expect(card.change24hPct).toBeCloseTo(50, 9); // (3 − 2)/2 = +50%
  });
  it("change24hPct is 0 (never null) when no anchor is available", () => {
    const card = toTokenCard(fixtureToken({ last_price_eth: null }), WM, SNAP);
    expect(card.change24hPct).toBe(0);
  });
});

describe("toTokenDetail Trust panel", () => {
  it("emits the exact LP copy constant and a schema-valid detail", () => {
    const detail = toTokenDetail(fixtureToken(), WM, SNAP);
    expect(() => tokenDetailSchema.parse(detail)).not.toThrow();
    expect(detail.trust.lpCopy).toBe(LP_COPY);
    expect(detail.trust.feePolicy.creatorFeeBps).toBe(0);
    expect(detail.creator).toEqual({ address: fixtureToken().creator, tokensCreated: 3 });
  });
  it("sources feePolicy.tradeFeeBps from the per-token column, not global config", () => {
    // An older curve reports ITS own fee (§12.40d), not the factory-current one.
    const legacy = fixtureToken({ trade_fee_bps: 42 });
    expect(toTokenDetail(legacy, WM, SNAP).trust.feePolicy.tradeFeeBps).toBe(42);
  });
  it("organic is null until stats exist, else a RANGE with methodology", () => {
    expect(toTokenDetail(fixtureToken(), WM, SNAP).trust.organic).toBeNull();
    const withFlow = fixtureToken({
      flow: {
        token_address: fixtureToken().address,
        organic_holder_pct_low: 40,
        organic_holder_pct_high: 60,
        organic_volume_pct: 72,
        flagged_cluster_vol_pct_24h: 8,
        updated_at: new Date().toISOString(),
      },
    });
    const organic = toTokenDetail(withFlow, WM, SNAP).trust.organic;
    expect(organic?.holderPctLow).toBe(40);
    expect(organic?.holderPctHigh).toBe(60);
    expect(organic?.methodology).toContain("§8.5");
  });
  it("returns hidden tokens WITH the visibility flag (never a 404 concern here)", () => {
    const hidden = fixtureToken({ m_visibility: "hidden", m_impersonation_flag: true, m_impersonation_ticker: "BTC" });
    const detail = toTokenDetail(hidden, WM, SNAP);
    expect(detail.moderation.visibility).toBe("hidden");
    expect(detail.moderation.impersonationTicker).toBe("BTC");
  });
  it("carries holderCount from tokens.holder_count (TokenHeader Holders stat, restores /holders drop)", () => {
    expect(toTokenDetail(fixtureToken(), WM, SNAP).holderCount).toBe(17); // fixtureToken default
    expect(toTokenDetail(fixtureToken({ holder_count: 0 }), WM, SNAP).holderCount).toBe(0);
    expect(toTokenDetail(fixtureToken({ holder_count: 4231 }), WM, SNAP).holderCount).toBe(4231);
  });
});

describe("sortKeyForRow (5 sorts)", () => {
  const cfg = loadRankingConfig();
  const nowSec = 1_700_010_000;
  it("newest → created_at", () => {
    expect(sortKeyForRow("newest", fixtureToken(), nowSec, cfg)).toBe("1700000000");
  });
  it("volume24h → volume_eth_24h; progress → real_eth_reserves", () => {
    expect(sortKeyForRow("volume24h", fixtureToken(), nowSec, cfg)).toBe((12n * 10n ** 18n).toString());
    expect(sortKeyForRow("progress", fixtureToken(), nowSec, cfg)).toBe((5n * 10n ** 18n).toString());
  });
  it("mcap → last_price_eth; trending decays with age", () => {
    expect(sortKeyForRow("mcap", fixtureToken(), nowSec, cfg)).toBe("3e-8");
    const fresh = sortKeyForRow("trending", fixtureToken({ created_at: nowSec }), nowSec, cfg);
    const stale = sortKeyForRow("trending", fixtureToken({ created_at: nowSec - 3600 * 48 }), nowSec, cfg);
    expect(Number(fresh)).toBeGreaterThan(Number(stale));
  });
});
