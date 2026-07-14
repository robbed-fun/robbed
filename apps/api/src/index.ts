/**
 * HTTP entrypoint (api.md). Bun serves the Hono app; the moderation worker
 * subscribes to `global:launches` (X-10) alongside. The WS fanout host
 * (`apps/api/src/ws.ts`) is a SEPARATE process authored under indexer M2-8 — not
 * started here.
 */
import { createApp } from "./app";
import { getConfig } from "./config";
import { createBunDb } from "./lib/db.bun";
import { buildDeps } from "./deps";
import { assertVendorsBootable } from "./moderation/vendors";
import { startModerationWorker } from "./moderation/worker";

const config = getConfig();
const deps = buildDeps(createBunDb);

// Prod boot guard: refuse to run on stub moderation vendors.
assertVendorsBootable(deps.vendors, config.API_ENV, config.MODERATION_ALLOW_STUBS);

// X-10 moderation seam — subscribe to launches (best-effort; logs on failure).
void startModerationWorker(deps).catch((err) =>
  console.error("[api] moderation worker failed to start:", err),
);

const app = createApp(deps);

console.log(`[api] listening on :${config.API_PORT} (env=${config.API_ENV})`);

export default {
  port: config.API_PORT,
  fetch: app.fetch,
};
