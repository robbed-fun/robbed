/**
 * Treasury fee dashboard (api.md). `collected` sums indexed
 * `fee_collections`; `uncollected` is a COLD, 60s-cached NPM `tokensOwed` RPC
 * read behind the `UncollectedFeesReader` interface — deliberately kept out of
 * the WS/publish hot path (the <500ms budget is a hot-path constraint; the
 * import-graph test proves no chain client reaches the fanout path).
 */
import { Hono } from "hono";
import { addressSchema, feesResponseSchema } from "@robbed/shared";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { ok } from "../lib/envelope";
import { parse } from "../lib/validate";
import { toCollected } from "../projections/fees";
import { loadProjectionContext } from "./context";

export function feeRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/tokens/:address/fees", async (c) => {
    const address = parse(addressSchema, c.req.param("address").toLowerCase());
    const token = await deps.db.getTokenListRow(address);
    if (!token) throw errors.notFound("token not found");

    // The LP NFT tokenId comes from the indexed graduations row (null pre-grad)
    // — the tokensOwed read is positioned on it, never guessed or re-derived
    // from raw logs.
    const lpTokenId = await deps.db.getLpTokenId(address);
    const [rows, ctx, uncollected] = await Promise.all([
      deps.db.getFeeCollections(address),
      loadProjectionContext(deps),
      deps.uncollectedFees.read({
        token: address,
        pool: token.v3_pool_address ?? "",
        lpTokenId: lpTokenId ?? "",
      }),
    ]);

    const body = feesResponseSchema.parse({
      collected: toCollected(rows, ctx.wm),
      uncollected: {
        token: uncollected.token,
        weth: uncollected.weth,
        asOf: new Date(deps.now()).toISOString(),
      },
    });
    return ok(c, body);
  });

  return app;
}
