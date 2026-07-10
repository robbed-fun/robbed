/**
 * Token reads (§5.1, §5.2, api.md §3.4): list (5 sorts / 3 filters), King of the
 * Hill, and detail with the full Trust-panel payload. Hidden tokens are returned
 * on direct fetch WITH `moderation.visibility = 'hidden'` — never 404 (§12.21).
 */
import { Hono } from "hono";
import {
  addressSchema,
  kingOfTheHillResponseSchema,
  tokenFilterSchema,
  tokenSortSchema,
  tokensResponseSchema,
} from "@robbed/shared";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { ok } from "../lib/envelope";
import { clampLimit, decodeCursor, encodeCursor } from "../lib/pagination";
import { parse, parseQuery } from "../lib/validate";
import { toTokenCard } from "../projections/card";
import { toTokenDetail } from "../projections/detail";
import { sortKeyForRow } from "../search/sort";
import { loadProjectionContext } from "./context";

const listQuerySchema = z.object({
  sort: tokenSortSchema.default("trending"),
  filter: tokenFilterSchema.default("all"),
  cursor: z.string().optional(),
  limit: z.string().optional(),
});
const addressParamSchema = z.object({ address: addressSchema });

export function tokenRoutes(deps: AppDeps) {
  const app = new Hono();

  // ── list ────────────────────────────────────────────────────────────────
  app.get("/v1/tokens", async (c) => {
    const q = parseQuery(listQuerySchema, c);
    const cursor = decodeCursor(deps.config.SESSION_SECRET, q.cursor);
    const limit = clampLimit(q.limit);
    const nowSec = Math.floor(deps.now() / 1000);
    const rows = await deps.db.listTokens({
      sort: q.sort,
      filter: q.filter,
      cursorSortKey: cursor?.k ?? null,
      cursorId: cursor?.i ?? null,
      limit: limit + 1, // fetch one extra to detect a next page
      nowSec,
      trendingHalfLifeSeconds: deps.ranking.trendingHalfLifeHours * 3600,
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
        ? encodeCursor(deps.config.SESSION_SECRET, {
            k: sortKeyForRow(q.sort, last, nowSec, deps.ranking),
            i: last.address,
          })
        : null;
    return ok(c, tokensResponseSchema.parse({ tokens, nextCursor }));
  });

  // ── King of the Hill ──────────────────────────────────────────────────────
  app.get("/v1/tokens/king-of-the-hill", async (c) => {
    const nowSec = Math.floor(deps.now() / 1000);
    const [row, ctx] = await Promise.all([
      deps.db.kingOfTheHill(),
      loadProjectionContext(deps),
    ]);
    const anchor = row
      ? (await deps.db.getChange24hAnchors([row.address], nowSec)).get(row.address)
      : undefined;
    const token = row ? toTokenCard(row, ctx.wm, ctx.ethUsd, deps.now(), anchor) : null;
    return ok(c, kingOfTheHillResponseSchema.parse({ token }));
  });

  // ── detail ────────────────────────────────────────────────────────────────
  app.get("/v1/tokens/:address", async (c) => {
    const { address } = parse(addressParamSchema, { address: c.req.param("address").toLowerCase() });
    const nowSec = Math.floor(deps.now() / 1000);
    const row = await deps.db.getTokenDetailRow(address);
    if (!row) throw errors.notFound("token not found");
    const [ctx, anchors] = await Promise.all([
      loadProjectionContext(deps),
      deps.db.getChange24hAnchors([row.address], nowSec),
    ]);
    const detail = toTokenDetail(row, ctx.wm, ctx.ethUsd, deps.now(), anchors.get(row.address));
    return ok(c, detail);
  });

  return app;
}
