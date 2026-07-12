/**
 * Hono app assembly (api.md §2). Wires cross-cutting middleware (rate limiting
 * per route class §6.3, central error→envelope handler, 404), then mounts every
 * route group. All response DTOs are the frozen `@robbed/shared` schemas.
 *
 * NO chain-write capability is importable from any route — the route-inventory
 * test (route-inventory.test.ts) asserts this structurally (§8.4).
 */
import { Hono } from "hono";
import { getConnInfo } from "hono/bun";
import type { Context } from "hono";
import type { AppDeps } from "./deps";
import { errBody, toErrorResponse } from "./lib/envelope";
import { ERROR_CODES } from "@robbed/shared";
import { ROUTE_LIMITS, rateLimit } from "./mw/ratelimit";
import { adminRoutes } from "./admin/routes";
import { candleRoutes } from "./routes/candles";
import { feeRoutes } from "./routes/fees";
import { healthRoutes } from "./routes/health";
import { holderRoutes } from "./routes/holders";
import { internalRoutes } from "./routes/internal";
import { metaRoutes } from "./routes/meta";
import { metadataRoutes } from "./routes/metadata";
import { ogRoutes } from "./routes/og";
import { portfolioRoutes } from "./routes/portfolio";
import { searchRoutes } from "./routes/search";
import { statsRoutes } from "./routes/stats";
import { tokenRoutes } from "./routes/tokens";
import { tradeRoutes } from "./routes/trades";
import { uploadRoutes } from "./routes/uploads";

function connIp(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  const rlDeps = {
    store: deps.rateLimit,
    trustedHeader: deps.config.TRUSTED_PROXY_HEADER,
    connInfoIp: connIp,
    now: deps.now,
  };

  // ── rate limits per route class (§6.3) ────────────────────────────────────
  app.use("/v1/uploads/*", rateLimit(rlDeps, ROUTE_LIMITS.uploadsHour, ROUTE_LIMITS.uploadsMin));
  app.use("/v1/metadata", rateLimit(rlDeps, ROUTE_LIMITS.metadata));
  app.use("/v1/search", rateLimit(rlDeps, ROUTE_LIMITS.search));
  app.use("/v1/admin/*", rateLimit(rlDeps, ROUTE_LIMITS.admin));
  // Internal dashboard (api.md §3.7) — admin-SIWE-gated, same limit class.
  app.use("/internal/*", rateLimit(rlDeps, ROUTE_LIMITS.admin));
  // Reads: everything else under /v1 except health probes (never rate-limited).
  const reads = rateLimit(rlDeps, ROUTE_LIMITS.reads);
  app.use("/v1/tokens", reads);
  app.use("/v1/tokens/*", reads);
  app.use("/v1/trades/*", reads);
  app.use("/v1/portfolio/*", reads);
  app.use("/v1/stats", reads);
  app.use("/v1/confirmations", reads);
  app.use("/v1/eth-usd", reads);
  // OG render is a read; rate-limit it in the reads class (crawler-facing).
  app.use("/v1/og/*", reads);

  // ── central error + 404 ───────────────────────────────────────────────────
  app.onError((err, c) => toErrorResponse(c, err));
  app.notFound((c) => c.json(errBody(ERROR_CODES.not_found, "route not found"), 404));

  // ── route groups ──────────────────────────────────────────────────────────
  app.route("/", healthRoutes(deps));
  app.route("/", metaRoutes(deps));
  app.route("/", searchRoutes(deps));
  app.route("/", tokenRoutes(deps));
  app.route("/", tradeRoutes(deps));
  app.route("/", portfolioRoutes(deps));
  app.route("/", candleRoutes(deps));
  app.route("/", holderRoutes(deps));
  app.route("/", feeRoutes(deps));
  app.route("/", statsRoutes(deps));
  app.route("/", uploadRoutes(deps));
  app.route("/", metadataRoutes(deps));
  app.route("/", ogRoutes(deps));
  app.route("/", adminRoutes(deps));
  app.route("/", internalRoutes(deps));

  return app;
}
