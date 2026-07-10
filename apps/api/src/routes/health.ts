/**
 * Liveness + readiness (gate-7 probes, api.md §3.5). `/v1/healthz` is a pure
 * liveness signal; `/v1/readyz` probes DB + Redis + R2 and returns 503 when any
 * dependency is down so `dev:health` / orchestration can gate startup.
 *
 * NOTE (flagged): openapi types readyz's 503 as `ErrorEnvelope`, but the frozen
 * `error.code` enum has no service-unavailable member. To avoid inventing a code
 * AND to keep the `checks` detail probes need, readyz returns the SAME
 * `{ ok, checks }` data shape with HTTP 503 (envelope `error:null`). Reconcile
 * with hoodpad-shared: either add `upstream_unavailable` to the enum or accept a
 * data-carrying 503 here.
 */
import { Hono } from "hono";
import type { AppDeps } from "../deps";
import { ok } from "../lib/envelope";

export function healthRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/healthz", (c) => ok(c, { ok: true as const }));

  app.get("/v1/readyz", async (c) => {
    const [db, redis, r2] = await Promise.all([
      deps.db.ping().catch(() => false),
      deps.redis.ping().catch(() => false),
      deps.storage.ping().catch(() => false),
    ]);
    const allOk = db && redis && r2;
    return c.json({ data: { ok: allOk, checks: { db, redis, r2 } }, error: null }, allOk ? 200 : 503);
  });

  return app;
}
