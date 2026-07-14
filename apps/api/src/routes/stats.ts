/**
 * Global stats (api.md). Tokens launched, graduations, 24h volume, treasury
 * fees — all COMPUTED from indexed data; USD via the convention (from
 * `eth_usd_snapshots`, never a constant).
 */
import { Hono } from "hono";
import { statsResponseSchema } from "@robbed/shared";
import type { AppDeps } from "../deps";
import { ok } from "../lib/envelope";
import { usdFromWei } from "../lib/usd";
import { resolveSnapshot } from "../projections/common";
import { loadProjectionContext } from "./context";

export function statsRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/stats", async (c) => {
    const nowSec = Math.floor(deps.now() / 1000);
    const [stats, ctx] = await Promise.all([
      deps.db.getStats(nowSec),
      loadProjectionContext(deps),
    ]);
    const snap = resolveSnapshot(ctx.ethUsd);
    const body = statsResponseSchema.parse({
      tokensLaunched: stats.tokensLaunched,
      graduations: stats.graduations,
      volume24hEth: stats.volume24hEthWei,
      volume24h: usdFromWei(stats.volume24hEthWei, snap, deps.now()),
      treasuryFeesCollectedWeth: stats.treasuryFeesCollectedWeth,
      treasuryFeesCollected: usdFromWei(stats.treasuryFeesCollectedWeth, snap, deps.now()),
    });
    return ok(c, body);
  });

  return app;
}
