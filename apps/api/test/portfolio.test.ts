/**
 * Portfolio endpoints + projections (spec §5.4; api.md §3). Asserts:
 *  - all four routes return the frozen @robbed/shared shapes;
 *  - read-time pricing via curve-quote (previewSell liquidation value);
 *  - unpriceable (never-traded) holdings → null price/value; no-basis → null PnL;
 *  - PnL surfaces as ranges/nullable (no false precision, §5.2);
 *  - wallet ETH comes from the injected RPC reader (chain truth), not the indexer;
 *  - an unknown address is an empty portfolio (not 404);
 *  - advisory/read-only (no chain mutation anywhere in the path).
 */
import { describe, expect, it } from "bun:test";
import {
  ethPnlRangeSchema,
  portfolioActivityResponseSchema,
  portfolioCreatedResponseSchema,
  portfolioHoldingsResponseSchema,
  portfolioSummarySchema,
  previewSell,
  type AddressPnlRow,
  type TradeRowDb,
} from "@robbed/shared";
import { createApp } from "../src/app";
import {
  FakeDb,
  TEST_ADDR,
  TEST_CREATOR,
  TEST_HOLDER,
  fixtureHolding,
  fixtureToken,
  makeTestDeps,
  readJson,
} from "./helpers";
import {
  priceHolding,
  toPortfolioSummary,
  unrealizedFor,
} from "../src/projections/portfolio";

const ETH = 10n ** 18n;

function pnlRow(overrides: Partial<AddressPnlRow> = {}): AddressPnlRow {
  return {
    address: TEST_HOLDER,
    first_seen_at: 1_700_000_000,
    last_active_at: 1_700_000_100,
    trade_count: 5,
    tokens_created: 2,
    total_eth_in: (3n * ETH).toString(),
    total_eth_out: (4n * ETH).toString(),
    realized_pnl_low: (1n * ETH).toString(),
    realized_pnl_high: (1n * ETH).toString(),
    pnl_confidence: "exact",
    updated_at: new Date(1_700_000_100_000).toISOString(),
    ...overrides,
  };
}

function app(db: FakeDb, overrides = {}) {
  return createApp(makeTestDeps({ db, ...overrides }));
}

// ── Summary ──────────────────────────────────────────────────────────────────

describe("GET /v1/portfolio/:address", () => {
  it("returns a PortfolioSummary with wallet ETH from the RPC reader", async () => {
    const db = new FakeDb([]);
    db.pnl.set(TEST_HOLDER, pnlRow());
    db.holdings.set(TEST_HOLDER, [fixtureHolding()]);
    const res = await app(db, {
      walletBalance: { async read() { return (2n * ETH).toString(); } },
    }).request(`/v1/portfolio/${TEST_HOLDER}`);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const summary = portfolioSummarySchema.parse(body.data);
    expect(summary.address).toBe(TEST_HOLDER);
    expect(summary.walletEthBalance).toBe((2n * ETH).toString());
    expect(summary.tradeCount).toBe(5);
    expect(summary.tokensCreated).toBe(2);
    expect(summary.firstSeenAt).toBe(1_700_000_000);
    // totalValueEth = curve liquidation value of the single holding.
    const h = fixtureHolding();
    const { ethOut } = previewSell(BigInt(h.virtual_eth), BigInt(h.virtual_token), BigInt(h.balance), h.trade_fee_bps);
    expect(summary.totalValueEth).toBe(ethOut.toString());
    // pnlAllTime present (realized exact + unrealized exact for a curve token).
    expect(summary.pnlAllTime).not.toBeNull();
    expect(summary.pnlAllTime?.confidence).toBe("exact");
    // USD mirror derived, never a constant.
    expect(summary.totalValue.ethUsd).toBe("2000");
  });

  it("unknown address → empty portfolio (200, not 404); zeros + null PnL", async () => {
    const db = new FakeDb([]);
    const res = await app(db).request(`/v1/portfolio/${TEST_HOLDER}`);
    expect(res.status).toBe(200);
    const summary = portfolioSummarySchema.parse((await readJson(res)).data);
    expect(summary.firstSeenAt).toBeNull();
    expect(summary.tradeCount).toBe(0);
    expect(summary.tokensCreated).toBe(0);
    expect(summary.totalValueEth).toBe("0");
    expect(summary.pnlAllTime).toBeNull();
  });

  it("rejects a malformed address (400)", async () => {
    const res = await app(new FakeDb([])).request("/v1/portfolio/not-an-address");
    expect(res.status).toBe(400);
  });
});

// ── Holdings ─────────────────────────────────────────────────────────────────

describe("GET /v1/portfolio/:address/holdings", () => {
  it("prices a curve holding via curve-quote; value/PNL non-null", async () => {
    const db = new FakeDb([]);
    db.holdings.set(TEST_HOLDER, [fixtureHolding()]);
    const res = await app(db).request(`/v1/portfolio/${TEST_HOLDER}/holdings`);
    const body = portfolioHoldingsResponseSchema.parse((await readJson(res)).data);
    expect(body.holdings).toHaveLength(1);
    const row = body.holdings[0]!;
    expect(row.token.address).toBe(TEST_ADDR);
    expect(row.token.status).toBe("curve");
    expect(row.priceEth).not.toBeNull();
    const h = fixtureHolding();
    const { ethOut } = previewSell(BigInt(h.virtual_eth), BigInt(h.virtual_token), BigInt(h.balance), h.trade_fee_bps);
    expect(row.valueEth).toBe(ethOut.toString());
    expect(row.value).not.toBeNull();
    // unrealized = value − basis (exact for a curve token) → low == high.
    const u = ethPnlRangeSchema.parse(row.unrealizedPnl);
    expect(u.confidence).toBe("exact");
    expect(u.low).toBe(u.high);
  });

  it("never-traded token → null price/value/PNL (no false precision)", async () => {
    const db = new FakeDb([]);
    db.holdings.set(TEST_HOLDER, [fixtureHolding({ last_price_eth: null })]);
    const res = await app(db).request(`/v1/portfolio/${TEST_HOLDER}/holdings`);
    const body = portfolioHoldingsResponseSchema.parse((await readJson(res)).data);
    const row = body.holdings[0]!;
    expect(row.priceEth).toBeNull();
    expect(row.valueEth).toBeNull();
    expect(row.value).toBeNull();
    expect(row.unrealizedPnl).toBeNull();
  });

  it("pure transfer-in holding (no cost basis) → unrealizedPnl null", async () => {
    const db = new FakeDb([]);
    db.holdings.set(TEST_HOLDER, [
      fixtureHolding({ total_bought_tokens: "0", total_eth_in: "0" }),
    ]);
    const res = await app(db).request(`/v1/portfolio/${TEST_HOLDER}/holdings`);
    const body = portfolioHoldingsResponseSchema.parse((await readJson(res)).data);
    expect(body.holdings[0]!.unrealizedPnl).toBeNull();
  });

  it("paginates: full page yields a nextCursor", async () => {
    const db = new FakeDb([]);
    const many = Array.from({ length: 51 }, (_, i) =>
      fixtureHolding({ token_address: "0x" + (i + 1).toString(16).padStart(40, "0") }),
    );
    db.holdings.set(TEST_HOLDER, many);
    const res = await app(db).request(`/v1/portfolio/${TEST_HOLDER}/holdings`);
    const body = portfolioHoldingsResponseSchema.parse((await readJson(res)).data);
    expect(body.holdings).toHaveLength(50);
    expect(body.nextCursor).not.toBeNull();
  });
});

// ── Activity ─────────────────────────────────────────────────────────────────

describe("GET /v1/portfolio/:address/activity", () => {
  it("returns the address's trade slice (reuses TradeRow)", async () => {
    const db = new FakeDb([]);
    const trade: TradeRowDb = {
      id: "0xdead-0",
      token_address: TEST_ADDR,
      trader: TEST_HOLDER,
      venue: "curve",
      is_buy: true,
      eth_amount: ETH.toString(),
      token_amount: (1000n * ETH).toString(),
      fee_eth: "0",
      price_eth: 0.00000003,
      block_number: 120,
      block_timestamp: 1_700_000_050,
      tx_hash: "0x" + "de".repeat(32),
      log_index: 0,
      confirmation_state: "soft_confirmed",
    };
    db.addressTrades = [trade];
    const res = await app(db).request(`/v1/portfolio/${TEST_HOLDER}/activity`);
    const body = portfolioActivityResponseSchema.parse((await readJson(res)).data);
    expect(body.activity).toHaveLength(1);
    expect(body.activity[0]!.trader).toBe(TEST_HOLDER);
    // confirmationState recomputed from the watermark (block 120 ≤ safe 100? no → soft).
    expect(body.activity[0]!.confirmationState).toBe("soft_confirmed");
  });
});

// ── Created ──────────────────────────────────────────────────────────────────

describe("GET /v1/portfolio/:address/created", () => {
  it("returns tokens whose creator == address as TokenCards", async () => {
    const mine = fixtureToken({ address: TEST_ADDR, creator: TEST_CREATOR });
    const notMine = fixtureToken({
      address: "0x9999999999999999999999999999999999999999",
      creator: "0x8888888888888888888888888888888888888888",
    });
    const db = new FakeDb([mine, notMine]);
    const res = await app(db).request(`/v1/portfolio/${TEST_CREATOR}/created`);
    const body = portfolioCreatedResponseSchema.parse((await readJson(res)).data);
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]!.creator).toBe(TEST_CREATOR);
    expect(body.tokens[0]!.address).toBe(TEST_ADDR);
  });
});

// ── Projection units (graduated pricing + estimated PnL range) ───────────────

describe("portfolio projection units", () => {
  it("graduated holding is marked-to-spot and its PnL range is 'estimated'", () => {
    const row = fixtureHolding({ graduated: true, last_price_eth: 0.0000001 });
    const { valueEth } = priceHolding(row);
    // spot × qty, wei.
    const expected = (BigInt(Math.round(0.0000001 * 1e18)) * BigInt(row.balance)) / ETH;
    expect(valueEth).toBe(expected);
    const u = unrealizedFor(row, valueEth)!;
    expect(u.confidence).toBe("estimated");
    // estimated band brackets [value − basis, value] → low ≤ high, high == value.
    expect(BigInt(u.low) <= BigInt(u.high)).toBe(true);
    expect(u.high).toBe(valueEth!.toString());
  });

  it("summary PnL null only when no realized AND no unrealized basis", () => {
    const summary = toPortfolioSummary({
      address: TEST_HOLDER,
      pnl: null,
      holdings: [fixtureHolding({ total_bought_tokens: "0", total_eth_in: "0" })],
      walletEthBalance: "0",
      ethUsd: null,
    });
    expect(summary.pnlAllTime).toBeNull();
    // totalValueEth still counts the priceable holding's liquidation value.
    expect(summary.totalValueEth).not.toBe("0");
  });

  it("estimated realized (address_pnl) propagates to summary confidence", () => {
    const summary = toPortfolioSummary({
      address: TEST_HOLDER,
      pnl: pnlRow({ pnl_confidence: "estimated", realized_pnl_low: "0", realized_pnl_high: (2n * ETH).toString() }),
      holdings: [],
      walletEthBalance: "0",
      ethUsd: null,
    });
    expect(summary.pnlAllTime?.confidence).toBe("estimated");
    expect(summary.pnlAllTime?.low).toBe("0");
    expect(summary.pnlAllTime?.high).toBe((2n * ETH).toString());
  });
});
