/**
 * GET /v1/search (§5.1, api.md §3.3). One endpoint over name/ticker/contract/
 * creator via pg_trgm; address-mode + similarity-mode both handled by the pure
 * builder. Hidden listings excluded there. Results use the same TokenCard
 * projection as /v1/tokens.
 */
import { Hono } from "hono";
import { SEARCH_QUERY_MAX, SEARCH_QUERY_MIN, searchResponseSchema } from "@robbed/shared";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { ok } from "../lib/envelope";
import { clampLimit } from "../lib/pagination";
import { parseQuery } from "../lib/validate";
import { toTokenCard } from "../projections/card";
import { buildSearchQuery } from "../search/builder";
import { loadProjectionContext } from "./context";

const searchQuerySchema = z.object({
  q: z.string().trim().min(SEARCH_QUERY_MIN).max(SEARCH_QUERY_MAX),
  limit: z.string().optional(),
});

export function searchRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/search", async (c) => {
    const { q, limit } = parseQuery(searchQuerySchema, c);
    const nowSec = Math.floor(deps.now() / 1000);
    const built = buildSearchQuery(q, clampLimit(limit ?? "20"), deps.ranking);
    const [rows, ctx] = await Promise.all([
      deps.db.searchTokens(built.query),
      loadProjectionContext(deps),
    ]);
    const anchors = await deps.db.getChange24hAnchors(rows.map((r) => r.address), nowSec);
    const results = rows.map((r) =>
      toTokenCard(r, ctx.wm, ctx.ethUsd, deps.now(), anchors.get(r.address)),
    );
    return ok(c, searchResponseSchema.parse({ results }));
  });

  return app;
}
