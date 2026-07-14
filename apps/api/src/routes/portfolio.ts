/**
 * Portfolio reads (api.md) — the `/portfolio` page surface:
 *  - GET /v1/portfolio/:address                     → PortfolioSummary
 *  - GET /v1/portfolio/:address/holdings            → HOLDINGS tab (paginated)
 *  - GET /v1/portfolio/:address/activity            → ACTIVITY tab (trade slice)
 *  - GET /v1/portfolio/:address/created             → CREATED tab (token cards)
 *
 * Advisory / read-only: nothing here mutates or depends on mutating chain state
 *. Any address resolves (an unknown address is an empty portfolio, not a
 * 404) — the wallet ETH balance is a live chain read that can be non-zero even
 * for an address the indexer has never seen.
 */
import { Hono } from "hono";
import {
  addressSchema,
  portfolioActivityResponseSchema,
  portfolioCreatedResponseSchema,
  portfolioHoldingsResponseSchema,
  portfolioSummarySchema,
} from "@robbed/shared";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { ok } from "../lib/envelope";
import { clampLimit, decodeCursor, encodeCursor } from "../lib/pagination";
import { parse, parseQuery } from "../lib/validate";
import { toTokenCard } from "../projections/card";
import { toTradeRow } from "../projections/trade";
import { toPortfolioHolding, toPortfolioSummary } from "../projections/portfolio";
import { loadProjectionContext } from "./context";

const pageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.string().optional(),
});

function addressParam(c: { req: { param: (k: string) => string } }): string {
  return parse(addressSchema, c.req.param("address").toLowerCase());
}

export function portfolioRoutes(deps: AppDeps) {
  const app = new Hono();

  // ── summary ───────────────────────────────────────────────────────────────
  app.get("/v1/portfolio/:address", async (c) => {
    const address = addressParam(c);
    // Wallet ETH is a live RPC read (chain truth); the roll-up + holdings are
    // indexer-derived. All fetched in parallel — none in the WS hot path.
    // tradeCount is counted LIVE off `trades` (trades_trader_idx) rather than
    // read from the advisory address_pnl roll-up — the job ticks every ~60s, so
    // the materialized count lags fresh trades and is 0 on a fresh DB before
    // the first tick (PORT-1). firstSeenAt / tokensCreated / realized PnL stay
    // roll-up-sourced (≤ one job interval stale, documented in api.md).
    const [ctx, pnl, holdings, walletEthBalance, tradeCount] = await Promise.all([
      loadProjectionContext(deps),
      deps.db.getAddressPnl(address),
      deps.db.getAllHoldings(address),
      deps.walletBalance.read(address),
      deps.db.countAddressTrades(address),
    ]);
    const summary = toPortfolioSummary({
      address,
      pnl,
      tradeCount,
      holdings,
      walletEthBalance,
      ethUsd: ctx.ethUsd,
      nowMs: deps.now(),
    });
    return ok(c, portfolioSummarySchema.parse(summary));
  });

  // ── holdings (BalanceRow ⋈ tokens; priced read-time via curve-quote) ───────
  app.get("/v1/portfolio/:address/holdings", async (c) => {
    const address = addressParam(c);
    const q = parseQuery(pageQuerySchema, c);
    const cursor = decodeCursor(deps.config.SESSION_SECRET, q.cursor);
    const limit = clampLimit(q.limit);
    const rows = await deps.db.listHoldings({
      address,
      cursorBalance: cursor?.k ?? null,
      cursorToken: cursor?.i ?? null,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const ctx = await loadProjectionContext(deps);
    const holdings = page.map((r) => toPortfolioHolding(r, ctx.ethUsd, deps.now()));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(deps.config.SESSION_SECRET, { k: last.balance, i: last.token_address })
        : null;
    return ok(c, portfolioHoldingsResponseSchema.parse({ holdings, nextCursor }));
  });

  // ── activity (per-address slice of the unified trade feed) ─────────────────
  app.get("/v1/portfolio/:address/activity", async (c) => {
    const address = addressParam(c);
    const q = parseQuery(pageQuerySchema, c);
    const cursor = decodeCursor(deps.config.SESSION_SECRET, q.cursor);
    const limit = clampLimit(q.limit);
    const rows = await deps.db.listAddressTrades({
      address,
      cursorTs: cursor ? Number.parseInt(cursor.k, 10) : null,
      cursorId: cursor?.i ?? null,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const ctx = await loadProjectionContext(deps);
    const activity = page.map((r) => toTradeRow(r, ctx.wm));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(deps.config.SESSION_SECRET, { k: String(last.block_timestamp), i: last.id })
        : null;
    return ok(c, portfolioActivityResponseSchema.parse({ activity, nextCursor }));
  });

  // ── created (tokens whose creator == address; reuse the card projection) ───
  app.get("/v1/portfolio/:address/created", async (c) => {
    const address = addressParam(c);
    const q = parseQuery(pageQuerySchema, c);
    const cursor = decodeCursor(deps.config.SESSION_SECRET, q.cursor);
    const limit = clampLimit(q.limit);
    const nowSec = Math.floor(deps.now() / 1000);
    const rows = await deps.db.listCreatedTokens({
      address,
      cursorTs: cursor ? Number.parseInt(cursor.k, 10) : null,
      cursorToken: cursor?.i ?? null,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const [ctx, anchors] = await Promise.all([
      loadProjectionContext(deps),
      deps.db.getChange24hAnchors(page.map((r) => r.address), nowSec),
    ]);
    const tokens = page.map((r) =>
      toTokenCard(r, ctx.wm, ctx.ethUsd, deps.now(), anchors.get(r.address)),
    );
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(deps.config.SESSION_SECRET, { k: String(last.created_at), i: last.address })
        : null;
    return ok(c, portfolioCreatedResponseSchema.parse({ tokens, nextCursor }));
  });

  return app;
}
