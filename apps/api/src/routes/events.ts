/**
 * Discover event feed / tape seed (`GET /v1/events`, api.md).
 *
 * ROOT-CAUSE FIX (robbed-indexer): a graduated token never surfaced as a
 * GRADUATION on the Discover tape. The indexer DOES persist the graduation
 * (`graduations` row + `tokens.graduated`) and publishes a live `graduated` WS
 * message on `global:launches` — but the tape had NO server-side historical
 * seed for GRADUATE/TRADE rows: it seeded LAUNCH rows from `/v1/tokens` and
 * otherwise depended on live WS, which keeps no replay buffer and is
 * backfill-suppressed for already-indexed events. So a graduation indexed during
 * catch-up (or before a browser connected) was durably invisible. This endpoint
 * serves the merged feed the tape's own model note asked for, over the existing
 * indexer tables — no reindex needed, the data is already in Postgres.
 *
 * Newest-first, keyset-paginated over the globally-unique (blockNumber,
 * logIndex). `?type=all|launches|trades|graduations` (default `all`). Each row
 * reuses the shared WS payload shape (launch/trade/graduated) so the frontend
 * maps a seeded row with the same mappers it uses for the live stream.
 */
import { Hono } from "hono";
import { eventFeedFilterSchema, eventsResponseSchema } from "@robbed/shared";
import type { AppDeps } from "../deps";
import { ok } from "../lib/envelope";
import { clampLimit, decodeCursor, encodeCursor } from "../lib/pagination";
import { parse } from "../lib/validate";
import { toEventFeedRow } from "../projections/event";
import { loadProjectionContext } from "./context";

export function eventRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/events", async (c) => {
    // `type` out of the closed enum ⇒ 400 (never reaches SQL); absent ⇒ `all`.
    const filter = parse(eventFeedFilterSchema, c.req.query("type") ?? "all");
    const limit = clampLimit(c.req.query("limit"));
    const cursor = decodeCursor(deps.config.SESSION_SECRET, c.req.query("cursor"));
    const rows = await deps.db.listEvents({
      filter,
      cursorBlock: cursor ? Number(cursor.k) : null,
      cursorLog: cursor ? Number(cursor.i) : null,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const ctx = await loadProjectionContext(deps);
    const events = page.map((r) => toEventFeedRow(r, ctx.wm));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(deps.config.SESSION_SECRET, {
            k: String(last.block_number),
            i: String(last.log_index),
          })
        : null;
    return ok(c, eventsResponseSchema.parse({ events, nextCursor }));
  });

  return app;
}
