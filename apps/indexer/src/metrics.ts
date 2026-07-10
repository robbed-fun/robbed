/**
 * Gate-7 metric registry + hooks (indexer.md §9.4, spec §10 gate 7; M2-12).
 *
 * A tiny, dependency-free Prometheus registry (gauge / counter / histogram) with
 * a text-exposition serializer. PURE and in-process: it imports NO DB client, so
 * the hot-path `publish.ts` invariant is unaffected and the registry is safe to
 * feed from handlers, the confirmation tracker, and the flow job. The DB-derived
 * series (metadata counts, confirmation lag from the watermark table, ETH/USD
 * age, and the funding-cluster vol share from `token_flow_stats`) are computed at
 * SCRAPE time in `metricsStore.ts` and merged into the exposition by the
 * `/metrics` server — no polling, no per-event DB reads.
 *
 * This module EMITS metric hooks only; alert DELIVERY (pager/Alertmanager) is M4
 * (§9.4). Advisory — no metric ever gates chain state (§8.4).
 *
 * Decide-it-yourself:
 *  - **Cluster-share thresholds come from M0 governance** (constants.json
 *    `governance.clusterAlertThresholds`: per-token 25%, platform 10%), surfaced
 *    as env with those defaults — config, not literals (spec §2: these are
 *    governance policy, not market metrics). `evaluateClusterShare` is the pure
 *    comparison the gate-7 breach gauges use; final thresholds + delivery are
 *    tuned with hoodpad-security before beta (constants.json status).
 */

// ── Minimal Prometheus instruments ──────────────────────────────────────────

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join(",");
}

function renderLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return "{" + keys.map((k) => `${k}="${labels[k]}"`).join(",") + "}";
}

class Gauge {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(readonly name: string, readonly help: string) {}
  set(value: number, labels: Labels = {}): void {
    this.values.set(labelKey(labels), { labels, value });
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    if (this.values.size === 0) lines.push(`${this.name} 0`);
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return lines.join("\n");
  }
}

class Counter {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(readonly name: string, readonly help: string) {}
  inc(n = 1, labels: Labels = {}): void {
    const key = labelKey(labels);
    const cur = this.values.get(key) ?? { labels, value: 0 };
    cur.value += n;
    this.values.set(key, cur);
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) lines.push(`${this.name} 0`);
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return lines.join("\n");
  }
}

class Histogram {
  private counts: number[];
  private sum = 0;
  private count = 0;
  constructor(readonly name: string, readonly help: string, readonly buckets: number[]) {
    this.counts = new Array(buckets.length).fill(0);
  }
  observe(value: number): void {
    this.sum += value;
    this.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]!) this.counts[i]! += 1;
    }
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    let cumulative = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      cumulative = this.counts[i]!; // counts are already cumulative (<= bucket)
      lines.push(`${this.name}_bucket{le="${this.buckets[i]}"} ${cumulative}`);
    }
    lines.push(`${this.name}_bucket{le="+Inf"} ${this.count}`);
    lines.push(`${this.name}_sum ${this.sum}`);
    lines.push(`${this.name}_count ${this.count}`);
    return lines.join("\n");
  }
}

// ── Named gate-7 series (§9.4) — pre-registered so a scrape always shows them ─

/** Publish→head latency (ms); alert p95 > 300ms guards the <500ms budget (§8.3). */
const wsPublishToHeadMs = new Histogram(
  "ws_publish_to_head_ms",
  "Latency from block/head to Redis publish, milliseconds (guards the <500ms budget).",
  [10, 50, 100, 200, 300, 500, 1000, 2000],
);
/** Chain head vs last indexed event (seconds); alert > 10s (§9.4). */
const indexerHeadLagSeconds = new Gauge("indexer_head_lag_seconds", "Seconds between chain head and the last indexed event.");
/** L2 blocks between head and the L1-posted / finalized watermarks (§9.4). */
const confirmationSafeLagBlocks = new Gauge("confirmation_safe_lag_blocks", "L2 blocks between head and the L1-posted (safe) watermark.");
const confirmationFinalizedLagBlocks = new Gauge("confirmation_finalized_lag_blocks", "L2 blocks between head and the finalized watermark.");
/** Metadata verification counts (§9.4 — mismatch > 0 pages review). */
const metadataUnfetchedTotal = new Gauge("metadata_unfetched_total", "Tokens whose metadata is still unfetched.");
const metadataMismatchTotal = new Gauge("metadata_mismatch_total", "Tokens whose metadata hash does not match the on-chain commitment.");
/** Invariant: a V3 Collect to a non-treasury recipient pages immediately (§9.4). */
const feeRecipientMismatchTotal = new Counter("fee_recipient_mismatch_total", "V3 Collect events whose recipient != treasury (gate-7 page).");
/** Invariant: a curve trade whose fee exceeds the 2% ceiling (§6.4). */
const tradeFeeCeilingBreachTotal = new Gauge("trade_fee_ceiling_breach_total", "Curve trades whose fee_eth exceeds 2% of the ETH leg (gate-7 page).");
/** Invariant: a second Graduated for a token (single-fire violation, gate-2/§9.4). */
const graduationDoubleFireTotal = new Counter("graduation_double_fire_total", "Repeat Graduated events for an already-graduated token (gate-7 page).");
/** Redis publish failures (self-healing via REST, but tracked). */
const redisPublishErrorsTotal = new Counter("redis_publish_errors_total", "Fire-and-forget Redis publish failures.");
/** ETH/USD snapshot age (seconds); alert > 5m — USD goes 'dated', never silent (§2). */
const ethUsdSnapshotAgeSeconds = new Gauge("eth_usd_snapshot_age_seconds", "Age of the latest ETH/USD snapshot, seconds.");
/**
 * v1.2 funding-cluster vol share (§8.5 / §10 gate-7 amend). `scope="token_max"`
 * = the largest per-token cluster share; `scope="platform"` = platform-wide.
 * The paired `_threshold_pct` and `_breach` gauges encode the M0 governance
 * thresholds (X% per-token, Y% platform) for the M4 alert delivery.
 */
const fundingClusterVolShare = new Gauge("funding_cluster_vol_share", "Largest funder-cluster share of curve volume, percent, by scope.");
const fundingClusterVolShareThresholdPct = new Gauge("funding_cluster_vol_share_threshold_pct", "Gate-7 cluster-share alert threshold, percent, by scope (M0 governance).");
const fundingClusterVolShareBreach = new Gauge("funding_cluster_vol_share_breach", "1 when the cluster share exceeds its gate-7 threshold, else 0, by scope.");

/** Every registered instrument, in a stable render order. */
const REGISTRY = [
  wsPublishToHeadMs,
  indexerHeadLagSeconds,
  confirmationSafeLagBlocks,
  confirmationFinalizedLagBlocks,
  metadataUnfetchedTotal,
  metadataMismatchTotal,
  feeRecipientMismatchTotal,
  tradeFeeCeilingBreachTotal,
  graduationDoubleFireTotal,
  redisPublishErrorsTotal,
  ethUsdSnapshotAgeSeconds,
  fundingClusterVolShare,
  fundingClusterVolShareThresholdPct,
  fundingClusterVolShareBreach,
] as const;

/** Render the in-process registry as Prometheus text exposition. */
export function renderRegistry(): string {
  return REGISTRY.map((m) => m.render()).join("\n\n") + "\n";
}

// ── Hooks (called from handlers / tracker / job — in-process only) ───────────

/** Confirmation tracker: publish→head latency observed at each realtime publish. */
export function observePublishToHeadMs(ms: number): void {
  if (Number.isFinite(ms) && ms >= 0) wsPublishToHeadMs.observe(ms);
}
/** Confirmation tracker tick: L2 lag between head and the safe/finalized marks. */
export function setConfirmationLag(headBlock: number, safeBlock: number, finalizedBlock: number): void {
  confirmationSafeLagBlocks.set(Math.max(0, headBlock - safeBlock));
  confirmationFinalizedLagBlocks.set(Math.max(0, headBlock - finalizedBlock));
}
/** Collect handler: a non-treasury recipient (gate-7 page). */
export function incFeeRecipientMismatch(): void {
  feeRecipientMismatchTotal.inc();
}
/** Graduated handler: a repeat Graduated for an already-graduated token. */
export function incGraduationDoubleFire(): void {
  graduationDoubleFireTotal.inc();
}
/** Publish path errors (fed by the flow/tracker publishers on failure). */
export function incRedisPublishError(): void {
  redisPublishErrorsTotal.inc();
}

// ── DB-derived snapshot (computed in metricsStore, applied here at scrape) ────

export interface Gate7DbSnapshot {
  headLagSeconds: number | null;
  metadataUnfetched: number;
  metadataMismatch: number;
  tradeFeeCeilingBreaches: number;
  ethUsdSnapshotAgeSeconds: number | null;
}

export interface ClusterAlertThresholds {
  perTokenPct: number;
  platformPct: number;
}

/** M0 governance defaults (constants.json.governance.clusterAlertThresholds). */
export const DEFAULT_CLUSTER_ALERT_THRESHOLDS: ClusterAlertThresholds = {
  perTokenPct: 25,
  platformPct: 10,
};

export function loadClusterAlertThresholds(env: Record<string, string | undefined> = process.env): ClusterAlertThresholds {
  const num = (name: string, dflt: number) => {
    const v = env[name];
    if (v === undefined || v === "") return dflt;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`[metrics] ${name} must be a non-negative number, got: ${v}`);
    return n;
  };
  return {
    perTokenPct: num("CLUSTER_ALERT_PER_TOKEN_PCT", DEFAULT_CLUSTER_ALERT_THRESHOLDS.perTokenPct),
    platformPct: num("CLUSTER_ALERT_PLATFORM_PCT", DEFAULT_CLUSTER_ALERT_THRESHOLDS.platformPct),
  };
}

/** Pure gate-7 cluster-share breach decision (advisory alert, never a gate). */
export function evaluateClusterShare(
  share: { clusterShareTokenMaxPct: number; clusterSharePlatformPct: number },
  thresholds: ClusterAlertThresholds,
): { tokenBreach: boolean; platformBreach: boolean } {
  return {
    tokenBreach: share.clusterShareTokenMaxPct > thresholds.perTokenPct,
    platformBreach: share.clusterSharePlatformPct > thresholds.platformPct,
  };
}

/**
 * Register the cluster-share thresholds and seed the share/breach gauges at 0 so
 * both scopes ALWAYS appear in a scrape even before the flow job first runs.
 * Called once at /metrics-server startup.
 */
export function initClusterShareMetrics(thresholds: ClusterAlertThresholds): void {
  fundingClusterVolShareThresholdPct.set(thresholds.perTokenPct, { scope: "token_max" });
  fundingClusterVolShareThresholdPct.set(thresholds.platformPct, { scope: "platform" });
  fundingClusterVolShare.set(0, { scope: "token_max" });
  fundingClusterVolShare.set(0, { scope: "platform" });
  fundingClusterVolShareBreach.set(0, { scope: "token_max" });
  fundingClusterVolShareBreach.set(0, { scope: "platform" });
}

/**
 * Flow-job hook (M2-13 → gate-7): set the funder-cluster vol-share gauges +
 * breach flags from the freshly-computed shares. In-process — the flow job runs
 * in the indexer process alongside the /metrics server.
 */
export function setClusterShareMetrics(
  clusterShareTokenMaxPct: number,
  clusterSharePlatformPct: number,
  thresholds: ClusterAlertThresholds,
): void {
  fundingClusterVolShare.set(clusterShareTokenMaxPct, { scope: "token_max" });
  fundingClusterVolShare.set(clusterSharePlatformPct, { scope: "platform" });
  const breach = evaluateClusterShare({ clusterShareTokenMaxPct, clusterSharePlatformPct }, thresholds);
  fundingClusterVolShareBreach.set(breach.tokenBreach ? 1 : 0, { scope: "token_max" });
  fundingClusterVolShareBreach.set(breach.platformBreach ? 1 : 0, { scope: "platform" });
}

/**
 * Merge the DB-derived snapshot into the registry gauges and render the full
 * gate-7 exposition (in-process instruments + DB series). Called by the /metrics
 * server at scrape time; the DB read is done by the caller (metricsStore). The
 * cluster-share gauges are fed separately by the flow job (setClusterShareMetrics).
 */
export function renderGate7Metrics(snapshot: Gate7DbSnapshot): string {
  if (snapshot.headLagSeconds !== null) indexerHeadLagSeconds.set(snapshot.headLagSeconds);
  metadataUnfetchedTotal.set(snapshot.metadataUnfetched);
  metadataMismatchTotal.set(snapshot.metadataMismatch);
  tradeFeeCeilingBreachTotal.set(snapshot.tradeFeeCeilingBreaches);
  if (snapshot.ethUsdSnapshotAgeSeconds !== null) ethUsdSnapshotAgeSeconds.set(snapshot.ethUsdSnapshotAgeSeconds);
  return renderRegistry();
}
