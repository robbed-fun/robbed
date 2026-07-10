/**
 * Side-process boot (M2-6 + M2-7) — starts the confirmation tracker and the
 * metadata verifier inside the indexer container, independent of Ponder's sync
 * (indexer.md §5.1/§6.1). Wired from a Ponder `:setup` handler (runs once before
 * indexing) so no separate entrypoint is needed; every start is guarded, and any
 * failure is logged, NEVER thrown into the indexing pipeline (these loops label
 * and derive — they never gate chain state, §8.4).
 *
 * Transport note (flagged for hoodpad-architect): the Redis publisher + the
 * `control:reverify` subscriber use Bun's native `RedisClient` when
 * `globalThis.Bun` is present (as the API does). Under a pure-Node Ponder
 * runtime they degrade to no-ops (publishes dropped → clients REST-heal; the
 * admin re-verify seam is inert). The container must therefore run these
 * side-processes under Bun, or a Node redis client must be added to
 * `apps/indexer`. This is an infra decision, not silently absorbed.
 */
import { Pool } from "pg";
import { CONTROL_REVERIFY } from "@robbed/shared";
import { config } from "./runtime";
import { getDefaultPublisher } from "./publish";
import { startConfirmationTracker } from "./confirmation";
import { createPgConfirmationStore, createRpcTagFetcher } from "./confirmationStore";
import { startMetadataVerifier, createHttpMetadataFetcher, type ReverifySubscriber } from "./metadata";
import { createPgMetadataStore } from "./metadataStore";
import { loadFlowThresholds } from "./flags/heuristics";
import { buildOwnContractWhitelist, createPgFlowStore } from "./flags/store";
import { startFlowJob, FLOW_JOB_INTERVAL_MS } from "./flags/job";
import { createPgPnlStore } from "./pnl/store";
import { startPnlJob, PNL_JOB_INTERVAL_MS } from "./pnl/job";
import { initClusterShareMetrics, loadClusterAlertThresholds } from "./metrics";
import { createPgMetricsStore } from "./metricsStore";
import { startMetricsServer } from "./metricsServer";
import {
  createPgCompetitorStore,
  startCompetitorSnapshotJob,
  unconfiguredCompetitorSource,
  COMPETITOR_SNAPSHOT_INTERVAL_MS,
} from "./jobs/competitor";

let started = false;

interface BunSubscriberClient {
  subscribe(channel: string, listener: (message: string, channel: string) => void): Promise<void>;
}

/** Bun-native `control:reverify` subscriber (or an inert no-op under Node). */
function createReverifySubscriber(url: string | undefined): ReverifySubscriber {
  const Bun = (globalThis as unknown as { Bun?: { RedisClient?: new (u: string) => BunSubscriberClient } }).Bun;
  if (!url || !Bun?.RedisClient) {
    return {
      async subscribe() {
        console.warn("[indexer sidecar] control:reverify subscriber unavailable (no Bun.RedisClient/REDIS_URL) — admin re-verify seam inert.");
      },
    };
  }
  const client = new Bun.RedisClient(url);
  return {
    async subscribe(channel, handler) {
      await client.subscribe(channel, (message) => handler(message));
    },
  };
}

/**
 * Start both side-processes exactly once. Safe to call from multiple setup
 * hooks (idempotent) and safe to skip when DB/Redis are unconfigured (dev).
 */
export async function startSidecars(): Promise<void> {
  if (started) return;
  started = true;

  if (process.env.INDEXER_SIDECARS === "off") {
    console.log("[indexer sidecar] disabled via INDEXER_SIDECARS=off");
    return;
  }
  if (!config.databaseUrl) {
    console.warn("[indexer sidecar] DATABASE_URL unset — tracker/verifier not started.");
    return;
  }

  const schema = config.databaseSchema ?? "public";
  const pool = new Pool({ connectionString: config.databaseUrl });
  const publisher = getDefaultPublisher();

  try {
    // M2-6 confirmation tracker.
    await startConfirmationTracker({
      store: createPgConfirmationStore(pool, schema),
      fetchTags: createRpcTagFetcher(config.rpcHttp),
      publisher,
    });
    console.log("[indexer sidecar] confirmation tracker started.");

    // M2-7 metadata verifier + control:reverify subscription.
    await startMetadataVerifier(
      {
        store: createPgMetadataStore(pool, schema),
        fetcher: createHttpMetadataFetcher(),
        publisher,
        r2BaseUrl: config.r2MetadataBaseUrl,
      },
      { channel: CONTROL_REVERIFY, subscriber: createReverifySubscriber(config.redisUrl) },
    );
    console.log("[indexer sidecar] metadata verifier started.");

    // M2-13 §8.5 bot/farm flow job (advisory labeling; never gates chain state).
    const flowThresholds = loadFlowThresholds();
    const clusterThresholds = loadClusterAlertThresholds();
    const flowIntervalMs = Number(process.env.FLOW_JOB_INTERVAL_MS) || FLOW_JOB_INTERVAL_MS;
    startFlowJob(
      {
        store: createPgFlowStore(pool, schema),
        thresholds: flowThresholds,
        whitelist: buildOwnContractWhitelist(config),
        clusterThresholds,
      },
      flowIntervalMs,
    );
    console.log("[indexer sidecar] §8.5 flow job started.");

    // Portfolio address_pnl roll-up (spec §5.4). Advisory / read-only derive from
    // trades+transfers+tokens; wallet ETH + unrealized PnL stay live at the API.
    const pnlIntervalMs = Number(process.env.PNL_JOB_INTERVAL_MS) || PNL_JOB_INTERVAL_MS;
    startPnlJob({ store: createPgPnlStore(pool, schema) }, pnlIntervalMs);
    console.log("[indexer sidecar] address_pnl roll-up job started.");

    // M2-14 weekly hood.fun competitor snapshot (source unconfigured → no-op writes).
    const competitorIntervalMs = Number(process.env.COMPETITOR_SNAPSHOT_INTERVAL_MS) || COMPETITOR_SNAPSHOT_INTERVAL_MS;
    startCompetitorSnapshotJob(
      { source: unconfiguredCompetitorSource(), store: createPgCompetitorStore(pool) },
      competitorIntervalMs,
    );
    console.log("[indexer sidecar] hood.fun competitor snapshot job started.");

    // M2-12 gate-7 /metrics server (in-process registry + DB-derived snapshot).
    if (process.env.METRICS_ENABLED !== "off") {
      const metricsPort = Number(process.env.METRICS_PORT) || 9464;
      initClusterShareMetrics(clusterThresholds);
      startMetricsServer({ store: createPgMetricsStore(pool, schema), port: metricsPort });
    }
  } catch (err) {
    console.error("[indexer sidecar] failed to start (indexing continues):", err);
  }
}
