/**
 * Trade feed + optimistic-UI reconciliation (§5.2, api.md §3.4). The token feed
 * is SERVER-side sorted + keyset-paginated (§12.59): `?sort` comes from the shared
 * closed allowlist (`tradeListQuerySchema` → 400 on anything else — the ORDER BY
 * security boundary), `?dir` asc|desc, plus the uniform `{ items, nextCursor }`
 * envelope. Each row carries venue + `confirmationState`; `?since` still backfills
 * a WS reconnect heal. `/v1/trades/:txHash` returns all Trade rows in a tx (create-
 * with-initial-buy has one); 404 means "not indexed yet" → client re-polls.
 */
import { Hono } from "hono";
import {
  addressSchema,
  hex32Schema,
  paginatedTradesResponseSchema,
  tradeListQuerySchema,
  txTradesResponseSchema,
} from "@robbed/shared";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { ok } from "../lib/envelope";
import { decodeCursor, encodeCursor } from "../lib/pagination";
import { TRADE_DIR_DEFAULT, TRADE_SORT_DEFAULT, tradeSortKey } from "../lib/listSort";
import { parse, parseQuery } from "../lib/validate";
import { toTradeRow } from "../projections/trade";
import { loadProjectionContext } from "./context";

export function tradeRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/tokens/:address/trades", async (c) => {
    const address = parse(addressSchema, c.req.param("address").toLowerCase());
    if (!(await deps.db.tokenExists(address))) throw errors.notFound("token not found");
    // sort/dir/cursor/limit come from the shared allowlist schema (out-of-allowlist
    // sort or a dir ≠ asc|desc ⇒ 400 before any SQL is built). `since` is read
    // separately — it is a backfill floor, not part of the sort grammar; the shared
    // schema strips it.
    const q = parseQuery(tradeListQuerySchema, c);
    const sort = q.sort ?? TRADE_SORT_DEFAULT;
    const dir = q.dir ?? TRADE_DIR_DEFAULT;
    const cursor = decodeCursor(deps.config.SESSION_SECRET, q.cursor);
    const sinceRaw = c.req.query("since");
    const since = sinceRaw != null ? Number.parseInt(sinceRaw, 10) : null;
    const rows = await deps.db.listTrades({
      token: address,
      since: since != null && Number.isFinite(since) ? since : null,
      sort,
      dir,
      cursorKey: cursor?.k ?? null,
      cursorId: cursor?.i ?? null,
      limit: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const ctx = await loadProjectionContext(deps);
    const items = page.map((r) => toTradeRow(r, ctx.wm));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(deps.config.SESSION_SECRET, { k: tradeSortKey(sort, last), i: last.id })
        : null;
    return ok(c, paginatedTradesResponseSchema.parse({ items, nextCursor }));
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
