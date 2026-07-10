/**
 * Venue-continuous candles for lightweight-charts (§5.2, api.md §3.4). One
 * unbroken series across graduation (curve trades + V3 swaps — the indexer's
 * unified `trades` table makes this structural). Bucket-aligned range, max 5000
 * buckets/request. Candles are already stored; the API only validates + maps.
 */
import { Hono } from "hono";
import {
  CANDLE_INTERVAL_SECONDS,
  MAX_CANDLE_BUCKETS,
  addressSchema,
  candleIntervalParamSchema,
  candlesResponseSchema,
} from "@robbed/shared";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { ok } from "../lib/envelope";
import { parse, parseQuery } from "../lib/validate";

const candlesQuerySchema = z.object({
  interval: candleIntervalParamSchema,
  from: z.coerce.number().int().nonnegative(),
  to: z.coerce.number().int().nonnegative(),
});

export function candleRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/tokens/:address/candles", async (c) => {
    const address = parse(addressSchema, c.req.param("address").toLowerCase());
    const q = parseQuery(candlesQuerySchema, c);
    if (q.to < q.from) throw errors.validation("`to` must be >= `from`");
    const width = CANDLE_INTERVAL_SECONDS[q.interval];
    const buckets = Math.floor((q.to - q.from) / width) + 1;
    if (buckets > MAX_CANDLE_BUCKETS) {
      throw errors.validation(`range exceeds ${MAX_CANDLE_BUCKETS} buckets`);
    }
    if (!(await deps.db.tokenExists(address))) throw errors.notFound("token not found");
    const rows = await deps.db.getCandles({
      token: address,
      interval: q.interval,
      from: q.from,
      to: q.to,
      limit: MAX_CANDLE_BUCKETS,
    });
    const candles = rows.map((r) => ({
      bucketStart: r.bucket_start,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volumeEth: r.volume_eth,
      volumeToken: r.volume_token,
      tradeCount: r.trade_count,
    }));
    return ok(c, candlesResponseSchema.parse({ candles }));
  });

  return app;
}
