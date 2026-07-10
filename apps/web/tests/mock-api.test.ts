import {
  candlesResponseSchema,
  confirmationsResponseSchema,
  ethUsdResponseSchema,
  holdersResponseSchema,
  kingOfTheHillResponseSchema,
  portfolioActivityResponseSchema,
  portfolioCreatedResponseSchema,
  portfolioHoldingsResponseSchema,
  portfolioSummarySchema,
  searchResponseSchema,
  tokenDetailSchema,
  tokensResponseSchema,
  tradesResponseSchema,
} from "@robbed/shared";
import { describe, expect, it } from "vitest";

import {
  MOCK_HOODCAT_ADDRESS,
  MOCK_PORTFOLIO_ADDRESS,
  resolveMock,
} from "@/shared/mock/mock-api";

/**
 * Task A — demo-mode resolver contract. Every payload the four pages read must
 * parse against the FROZEN `@robbed/shared` schema, so the gated mock can never
 * drift from the production contract (the api client re-parses with these same
 * schemas). Proves the wiring maps the auxiliary arrays correctly and that the
 * strict gate returns valid, complete DTOs.
 */
describe("mock-api · demo payloads satisfy the frozen contract", () => {
  const hoodcat = MOCK_HOODCAT_ADDRESS;

  it("GET /v1/tokens (trending + newest) → TokenCard[]", () => {
    const trending = tokensResponseSchema.parse(
      resolveMock("/v1/tokens?sort=volume24h&filter=all&limit=8"),
    );
    const newest = tokensResponseSchema.parse(
      resolveMock("/v1/tokens?sort=newest&filter=all&limit=40"),
    );
    expect(trending.tokens.length).toBeGreaterThan(0);
    expect(newest.tokens.length).toBeGreaterThanOrEqual(trending.tokens.length);
    // trending order is volume-weighted / API-owned; first card is HOODCAT (#1).
    expect(trending.tokens[0]!.ticker).toBe("HCAT");
  });

  it("GET /v1/tokens/king-of-the-hill → closest-to-graduation pre-grad token", () => {
    const { token } = kingOfTheHillResponseSchema.parse(
      resolveMock("/v1/tokens/king-of-the-hill"),
    );
    expect(token).not.toBeNull();
    expect(token!.graduated).toBe(false);
    // BAGEL (78%) is the highest-progress pre-grad card.
    expect(token!.ticker).toBe("BGL");
  });

  it("GET /v1/tokens/:address → full TokenDetail incl. Trust panel", () => {
    const detail = tokenDetailSchema.parse(resolveMock(`/v1/tokens/${hoodcat}`));
    expect(detail.ticker).toBe("HCAT");
    // exact canonical LP sentence flows straight from the fixture.
    expect(detail.trust.lpCopy).toContain("permanently locked");
    expect(detail.trust.lpCopy).toContain("claimable by treasury");
    expect(detail.trust.metadataVerification.status).toBe("match");
  });

  it("resolves a NON-subject address to a valid detail (no 404 in demo)", () => {
    const plasma = "0xb1a2000000000000000000000000000000005e01";
    const detail = tokenDetailSchema.parse(resolveMock(`/v1/tokens/${plasma}`));
    expect(detail.ticker).toBe("PLSM");
    expect(detail.graduated).toBe(true);
  });

  it("GET /v1/tokens/:address/{trades,candles,holders}", () => {
    const trades = tradesResponseSchema.parse(
      resolveMock(`/v1/tokens/${hoodcat}/trades?limit=50`),
    );
    const candles = candlesResponseSchema.parse(
      resolveMock(`/v1/tokens/${hoodcat}/candles?interval=1m&from=0&to=9`),
    );
    const holders = holdersResponseSchema.parse(
      resolveMock(`/v1/tokens/${hoodcat}/holders?limit=20`),
    );
    expect(trades.trades.length).toBe(3);
    expect(candles.candles.length).toBeGreaterThan(10);
    expect(holders.holderCount).toBe(1204);
    // curve + creator structural flags present.
    expect(holders.holders.some((h) => h.flags.includes("curve"))).toBe(true);
    expect(holders.holders.some((h) => h.flags.includes("creator"))).toBe(true);
  });

  it("GET /v1/search matches name / ticker / address", () => {
    expect(searchResponseSchema.parse(resolveMock("/v1/search?q=hood")).results.length).toBe(1);
    expect(searchResponseSchema.parse(resolveMock("/v1/search?q=PLSM")).results.length).toBe(1);
    expect(searchResponseSchema.parse(resolveMock("/v1/search?q=")).results.length).toBe(0);
  });

  it("GET /v1/eth-usd + /v1/confirmations", () => {
    const eth = ethUsdResponseSchema.parse(resolveMock("/v1/eth-usd"));
    expect(eth.price).toBeGreaterThan(0);
    const conf = confirmationsResponseSchema.parse(resolveMock("/v1/confirmations"));
    // tiers are ordered finalized ≤ safe ≤ latest.
    expect(conf.finalizedBlock).toBeLessThanOrEqual(conf.safeBlock);
    expect(conf.safeBlock).toBeLessThanOrEqual(conf.latestBlock);
  });

  it("GET /v1/portfolio/* → summary + holdings + activity + created", () => {
    const addr = MOCK_PORTFOLIO_ADDRESS;
    const summary = portfolioSummarySchema.parse(resolveMock(`/v1/portfolio/${addr}`));
    expect(summary.tradeCount).toBeGreaterThan(0);
    const holdings = portfolioHoldingsResponseSchema.parse(
      resolveMock(`/v1/portfolio/${addr}/holdings`),
    );
    expect(holdings.holdings.length).toBe(4);
    const activity = portfolioActivityResponseSchema.parse(
      resolveMock(`/v1/portfolio/${addr}/activity`),
    );
    expect(activity.activity.length).toBeGreaterThan(0);
    const created = portfolioCreatedResponseSchema.parse(
      resolveMock(`/v1/portfolio/${addr}/created`),
    );
    expect(created.tokens.length).toBe(2);
  });

  it("throws loud on an unmapped path (fail-fast, never silent)", () => {
    expect(() => resolveMock("/v1/nonsense")).toThrow();
  });
});
