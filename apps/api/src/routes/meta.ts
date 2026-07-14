/**
 * Confirmation watermarks + ETH/USD (api.md). Both feed SSR initial state
 * and the USD convention. ETH/USD is ALWAYS from `eth_usd_snapshots` — never
 * a constant.
 */
import { Hono } from "hono";
import { confirmationsResponseSchema, ethUsdResponseSchema } from "@robbed/shared";
import type { z } from "zod";
import type { AppDeps } from "../deps";
import { errBody, ok } from "../lib/envelope";
import { INTERNAL_ERROR_CODE } from "../lib/errors";

type ConfirmationsResponseT = z.infer<typeof confirmationsResponseSchema>;
type EthUsdResponseT = z.infer<typeof ethUsdResponseSchema>;

export function metaRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/confirmations", async (c) => {
    const wm = await deps.db.getWatermarks();
    const body: ConfirmationsResponseT = wm
      ? {
          safeBlock: wm.safe_block,
          finalizedBlock: wm.finalized_block,
          latestBlock: wm.latest_block,
          updatedAt: wm.updated_at,
        }
      : {
          safeBlock: 0,
          finalizedBlock: 0,
          latestBlock: 0,
          updatedAt: new Date(deps.now()).toISOString(),
        };
    return ok(c, body);
  });

  app.get("/v1/eth-usd", async (c) => {
    const snap = await deps.db.getLatestEthUsd();
    if (!snap) {
      // No snapshot ⇒ no price. Never fabricate a constant.
      return c.json(errBody(INTERNAL_ERROR_CODE, "no eth/usd snapshot available"), 503);
    }
    const body: EthUsdResponseT = {
      price: snap.price_usd,
      source: snap.source,
      asOf: snap.fetched_at,
    };
    return ok(c, body);
  });

  return app;
}
