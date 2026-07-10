/**
 * Trade feed + optimistic-UI reconciliation (§5.2, api.md §3.4). Token feed
 * carries venue + `confirmationState` per row and supports `since` backfill for
 * WS reconnect heal. `/v1/trades/:txHash` returns all Trade rows in a tx (create-
 * with-initial-buy has one); 404 means "not indexed yet" → client re-polls.
 */
import { Hono } from "hono";
import { addressSchema, hex32Schema, tradesResponseSchema, txTradesResponseSchema } from "@robbed/shared";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { ok } from "../lib/envelope";
import { clampLimit, decodeCursor, encodeCursor } from "../lib/pagination";
import { parse, parseQuery } from "../lib/validate";
import { toTradeRow } from "../projections/trade";
import { loadProjectionContext } from "./context";

const tradesQuerySchema = z.object({
  since: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.string().optional(),
});

export function tradeRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/tokens/:address/trades", async (c) => {
    const address = parse(addressSchema, c.req.param("address").toLowerCase());
    if (!(await deps.db.tokenExists(address))) throw errors.notFound("token not found");
    const q = parseQuery(tradesQuerySchema, c);
    const cursor = decodeCursor(deps.config.SESSION_SECRET, q.cursor);
    const limit = clampLimit(q.limit);
    const since = q.since != null ? Number.parseInt(q.since, 10) : null;
    const rows = await deps.db.listTrades({
      token: address,
      since: since != null && Number.isFinite(since) ? since : null,
      cursorTs: cursor ? Number.parseInt(cursor.k, 10) : null,
      cursorId: cursor?.i ?? null,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const ctx = await loadProjectionContext(deps);
    const trades = page.map((r) => toTradeRow(r, ctx.wm));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(deps.config.SESSION_SECRET, {
            k: String(last.block_timestamp),
            i: last.id,
          })
        : null;
    return ok(c, tradesResponseSchema.parse({ trades, nextCursor }));
  });

  app.get("/v1/trades/:txHash", async (c) => {
    const txHash = parse(hex32Schema, c.req.param("txHash").toLowerCase());
    const rows = await deps.db.getTradesByTx(txHash);
    if (rows.length === 0) throw errors.notFound("transaction not indexed");
    const ctx = await loadProjectionContext(deps);
    const trades = rows.map((r) => toTradeRow(r, ctx.wm));
    return ok(c, txTradesResponseSchema.parse({ trades }));
  });

  return app;
}
