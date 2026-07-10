/**
 * Gate-7 `/metrics` HTTP server (M2-12). A tiny standalone `node:http` server
 * started as a side-process (alongside the confirmation tracker + flow job) so
 * it shares the in-process metric registry (`metrics.ts`) with the handlers. On
 * each scrape it merges the DB-derived snapshot (`metricsStore.ts`) with the
 * in-process instruments and returns Prometheus text exposition.
 *
 * Runtime-agnostic (`node:http` works under both the Node Ponder container and
 * Bun) so it never touches Ponder's own HTTP server surface — zero risk to the
 * GraphQL/SQL endpoints other tracks may use, and no coupling to a Ponder API
 * version I could not fully pin (docs-first: the api/index.ts + graphql
 * composition for 0.16.6 was not confirmable, so I did not hijack that server).
 *
 * FLAGGED for hoodpad-architect (cross-service): this exposes `/metrics` on
 * `METRICS_PORT` (default 9464), NOT the API's `API_PORT`. The gate-7 series that
 * are genuinely in-process (publish latency, confirmation lag, invariant
 * counters, cluster share) can only be scraped from the indexer process; the
 * final surface (indexer /metrics scraped directly vs the API proxying/
 * re-exposing on API_PORT, api.md) is a cross-service decision. Delivery/alerting
 * is M4.
 */
import { createServer, type Server } from "node:http";
import { renderGate7Metrics, renderRegistry, type Gate7DbSnapshot } from "./metrics";
import type { MetricsStore } from "./metricsStore";

export interface MetricsServerDeps {
  store: Pick<MetricsStore, "snapshot">;
  port: number;
  logger?: Pick<Console, "error" | "log">;
}

export interface MetricsServerHandle {
  stop(): void;
  /** Render once (used by the unit/integration harness without binding a port). */
  render(): Promise<string>;
}

/** Build the exposition text: DB snapshot merged with the in-process registry. */
export async function renderMetricsText(store: Pick<MetricsStore, "snapshot">): Promise<string> {
  let snapshot: Gate7DbSnapshot;
  try {
    snapshot = await store.snapshot();
  } catch {
    // DB unavailable — still serve the in-process registry (never a blank scrape).
    return renderRegistry();
  }
  return renderGate7Metrics(snapshot);
}

export function startMetricsServer(deps: MetricsServerDeps): MetricsServerHandle {
  const log = deps.logger ?? console;
  const render = () => renderMetricsText(deps.store);

  const server: Server = createServer((req, res) => {
    if (req.url && req.url.split("?")[0] === "/metrics") {
      render()
        .then((body) => {
          res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
          res.end(body);
        })
        .catch((err) => {
          log.error("[metrics server] render failed:", err);
          res.writeHead(500, { "content-type": "text/plain" });
          res.end("# metrics render error\n");
        });
      return;
    }
    if (req.url && req.url.split("?")[0] === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok\n");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found\n");
  });

  server.on("error", (err) => log.error("[metrics server] listen error:", err));
  server.listen(deps.port, () => log.log(`[metrics server] gate-7 /metrics on :${deps.port}`));
  (server as unknown as { unref?: () => void }).unref?.();

  return {
    stop() {
      server.close();
    },
    render,
  };
}
