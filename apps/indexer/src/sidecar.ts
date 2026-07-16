/**
 * Side-process boot (M2-6 + M2-7) — starts the confirmation tracker and the
 * metadata verifier inside the indexer container, independent of Ponder's sync
 * (indexer.md). Compose eagerly starts this at handler-module import because
 * `ponder start` crash recovery does not replay `:setup`; the `:setup` handler
 * remains an idempotent fallback. Every start is guarded, and any failure is
 * logged, NEVER thrown into the indexing pipeline (these loops label and derive
 * — they never gate chain state).
 *
 * Transport note (RESOLVED — prod-images.md fix, 2026-07-11) the Redis
 * publisher and the `control:reverify` subscriber are RUNTIME-SELECTED — Bun's
 * native `RedisClient` when `globalThis.Bun` is present (dev/compose, matches
 * the API), node-redis 6.x otherwise (the prod Ponder container runs under
 * Node). No-op fallbacks are gone: `startSidecars` preflights the
 * publish transport BEFORE anything else and exits the process if none can be
 * constructed, so a misconfigured container fails loud at startup instead of
 * silently dropping every realtime publish with the error counter stuck at 0.
 */
import { Pool } from "pg";
import { CONTROL_REVERIFY } from "@robbed/shared";
import { config } from "./runtime";
import { applyMigrationsAtBoot } from "./offchainMigrations";
import { startEventCountLogger } from "./eventCountLogger";
import { createReverifySubscriber, getDefaultPublisher } from "./publish";
import { startConfirmationTracker } from "./confirmation";
import { createPgConfirmationStore, createRpcTagFetcher } from "./confirmationStore";
import { startMetadataVerifier, createHttpMetadataFetcher } from "./metadata";
import { createPgMetadataStore } from "./metadataStore";
import { loadFlowThresholds } from "./flags/heuristics";
import { buildOwnContractWhitelist, createPgFlowStore } from "./flags/store";
import { startFlowJob, FLOW_JOB_INTERVAL_MS } from "./flags/job";
import { createPgPnlStore } from "./pnl/store";
import { startPnlJob, PNL_JOB_INTERVAL_MS } from "./pnl/job";
import { startTokenMetricsCoalescer, WS_METRICS_THROTTLE_MS } from "./tokenMetrics";
import { createPgMetricsCoalescerStore } from "./tokenMetricsStore";
import { initClusterShareMetrics, loadClusterAlertThresholds } from "./metrics";
import { createPgMetricsStore } from "./metricsStore";
import { startMetricsServer } from "./metricsServer";
import {
  createPgCompetitorStore,
  startCompetitorSnapshotJob,
  unconfiguredCompetitorSource,
  COMPETITOR_SNAPSHOT_INTERVAL_MS,
} from "./jobs/competitor";
import { createEthUsdRpc, createPgEthUsdStore, loadEthUsdEnv, startEthUsdPoller } from "./jobs/ethUsd";

let started = false;

/**
 * Start both side-processes exactly once. Safe to call from multiple setup
 * hooks (idempotent) and safe to skip when DB/Redis are unconfigured (dev).
 */
export async function startSidecars(): Promise<void> {
  if (started) return;
  started = true;

  // Transport preflight (prod-images.md) construct the publish transport
  // NOW — this hook runs before indexing, so REDIS_URL unset / an
  // unconstructible client kills the process at startup instead of dropping
  // every realtime publish invisibly (`redis_publish_errors_total` stuck at 0,
  // unalertable). Runs BEFORE the INDEXER_SIDECARS gate: handler publishes
  // happen even with the tracker/verifier loops off, so the transport is
  // required regardless. env-inventory.md: REDIS_URL is required in every env.
  let publisher: ReturnType<typeof getDefaultPublisher>;
  try {
    publisher = getDefaultPublisher();
  } catch (err) {
    console.error("[indexer sidecar] FATAL: no Redis publish transport constructible — refusing to run as a silent no-op:", err);
    process.exit(1);
  }

  if (!config.databaseUrl) {
    console.warn("[indexer sidecar] DATABASE_URL unset — migrations/tracker/verifier not started.");
    return;
  }

  const schema = config.databaseSchema ?? "public";
  // Bounded pool + explicit idle reaping + close-on-shutdown. ROOT CAUSE of the 2026-07-13
  // chart outage: an UNBOUNDED pool re-created on every `ponder dev` hot-reload orphaned its
  // clients and leaked ~95 idle connections, exhausting Postgres `max_connections=100`
  // (`sorry, too many clients already` → crash loop). A small `max` caps each pool's footprint,
  // the 10s idle timeout reaps orphaned-pool clients, and the shutdown hook releases it on a
  // clean restart. The sidecar is low-throughput (migrations + tracker/verifier/jobs) — 5 is ample.
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 5,
    idleTimeoutMillis: 10_000,
  });
  let stopEventCountLogger: (() => void) | undefined;
  const closeSidecarPool = () => {
    stopEventCountLogger?.();
    void pool.end().catch(() => {});
  };
  process.once("SIGTERM", closeSidecarPool);
  process.once("SIGINT", closeSidecarPool);

  // Offchain migrations, BOTH phases (first-class home of the post-Ponder
  // re-run — replaces the I-5b compose /ready-polling stopgap; design + ponder
  // 0.16.8 source basis in offchainMigrations.ts): the `:setup` hook runs after
  // Ponder's own `database.migrate()` built its tables, so the phase-2 view/GIN
  // migrations over them apply deterministically here — on EVERY boot, because
  // a dev schema rebuild CASCADE-drops the external views. Runs BEFORE the
  // INDEXER_SIDECARS gate (the 0003 search GIN indexes serve the API even with
  // the sidecar loops off) and BEFORE any job starts (the pnl/flow jobs read the
  // phase-2 views — fresh-DB ordering, PORT-1 root cause). Never throws into
  // indexing; failure logs loudly and returns false.
  await applyMigrationsAtBoot(pool, schema);
  stopEventCountLogger = startEventCountLogger(pool, schema, { chainId: config.chainId });

  if (process.env.INDEXER_SIDECARS === "off") {
    console.log("[indexer sidecar] disabled via INDEXER_SIDECARS=off");
    stopEventCountLogger();
    await pool.end();
    return;
  }

  try {
    // M2-6 confirmation tracker (watermark sidecar only — no writes into
    // Ponder-managed tables; tiers derived at read time, OI-11).
    await startConfirmationTracker({
      store: createPgConfirmationStore(pool),
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
        // Dev seam: rewrite the browser-visible object-URL prefix to the
        // container-internal minio service DNS (config.ts, METADATA_FETCH_REWRITE_*).
        urlRewrite: config.metadataFetchRewrite,
      },
      { channel: CONTROL_REVERIFY, subscriber: createReverifySubscriber(config.redisUrl) },
    );
    console.log("[indexer sidecar] metadata verifier started.");

    // M2-13 bot/farm flow job (advisory labeling; never gates chain state).
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
    console.log("[indexer sidecar] flow job started.");

    // Portfolio address_pnl roll-up. Advisory / read-only derive from
    // trades+transfers+tokens; wallet ETH + unrealized PnL stay live at the API.
    const pnlIntervalMs = Number(process.env.PNL_JOB_INTERVAL_MS) || PNL_JOB_INTERVAL_MS;
    startPnlJob({ store: createPgPnlStore(pool, schema) }, pnlIntervalMs);
    console.log("[indexer sidecar] address_pnl roll-up job started.");

    // D-70 token_metrics coalescer: handlers enqueue per indexed trade + graduation
    // (in-memory, no DB); this trailing-edge flush does the ONE batched 24h-anchor
    // read per window and publishes coalesced `token_metrics` on GLOBAL_METRICS.
    // Gated by the sidecar (needs the throttled anchor read); with INDEXER_SIDECARS
    // =off the coalescer is unarmed, so handler enqueues no-op (no leak, no publish).
    const metricsThrottleMs = Number(process.env.WS_METRICS_THROTTLE_MS) || WS_METRICS_THROTTLE_MS;
    startTokenMetricsCoalescer(
      { store: createPgMetricsCoalescerStore(pool, schema), publisher },
      metricsThrottleMs,
    );
    console.log(`[indexer sidecar] token_metrics coalescer started (throttle ${metricsThrottleMs}ms).`);

    // ETH/USD snapshot poller (hard rule; Chainlink branch).
    // Own try/catch: a assertion failure is FAIL-CLOSED for the poller —
    // NO poller starts (the HTTP fallback must not mask a misconfigured feed
    // address) and eth_usd_snapshot_age_seconds pages (>5m alert) — but
    // indexing itself continues (sidecar principle: label, never gate).
    try {
      const ethUsdEnv = loadEthUsdEnv();
      const rpc = createEthUsdRpc(config.rpcHttp);
      const poller = await startEthUsdPoller({
        store: createPgEthUsdStore(pool),
        getChainId: rpc.getChainId,
        chainlinkClient: rpc.reader,
        env: ethUsdEnv,
      });
      console.log(
        `[indexer sidecar] eth/usd poller started (branch: ${poller.usingChainlink ? "chainlink:4663" : "http fallback"}, interval ${ethUsdEnv.pollIntervalMs}ms).`,
      );
    } catch (err) {
      console.error("[indexer sidecar] eth/usd poller FAIL-CLOSED () — no snapshots will be written; age alert will page:", err);
    }

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
