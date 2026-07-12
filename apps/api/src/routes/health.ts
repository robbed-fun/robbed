/**
 * Liveness + readiness (gate-7 probes, api.md §3.5). `/v1/healthz` is a pure
 * liveness signal; `/v1/readyz` probes DB + Redis + R2 and returns 503 when any
 * dependency is down so `dev:health` / orchestration can gate startup.
 *
 * Envelope (NORMATIVE — api.md §3.5, 2026-07-12 W3/M2-2 reconcile): the 200 arm
 * carries the structured `{ ok: true, checks }` breakdown; the 503 arm is the
 * STANDARD shared ErrorEnvelope with the closed-enum code `upstream_unavailable`
 * (ratified 2026-07-10 with the explicit "readyz-503 dependency-down"
 * disposition) and the failing dependency names in `message`. One envelope shape
 * for every non-2xx response — the prior data-carrying-503 special case is
 * superseded (openapi.yaml updated in lockstep). Orchestration gates on the HTTP
 * status alone.
 */
import { Hono } from "hono";
import { ERROR_CODES } from "@robbed/shared";
import type { AppDeps } from "../deps";
import { errBody, ok } from "../lib/envelope";

export function healthRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/healthz", (c) => ok(c, { ok: true as const }));

  app.get("/v1/readyz", async (c) => {
    const [db, redis, r2] = await Promise.all([
      deps.db.ping().catch(() => false),
      deps.redis.ping().catch(() => false),
      deps.storage.ping().catch(() => false),
    ]);
    if (db && redis && r2) {
      return ok(c, { ok: true as const, checks: { db, redis, r2 } });
    }
    const failing = Object.entries({ db, redis, r2 })
      .filter(([, up]) => !up)
      .map(([name]) => name)
      .join(", ");
    return c.json(
      errBody(ERROR_CODES.upstream_unavailable, `not ready: ${failing}`),
      503,
    );
  });

  return app;
}
