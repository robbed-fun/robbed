/**
 * Gate-7 metrics suite (indexer.md, gate 7; M2-12). Asserts the
 * named series are exposed (incl. the v1.2 funding-cluster share), the cluster
 * threshold logic (M0 governance X%/Y%), the in-process hooks, and that the
 * /metrics render merges the DB snapshot. Advisory — no metric gates chain state.
 */
import { describe, expect, it } from "bun:test";
import {
  renderRegistry,
  renderGate7Metrics,
  evaluateClusterShare,
  loadClusterAlertThresholds,
  DEFAULT_CLUSTER_ALERT_THRESHOLDS,
  initClusterShareMetrics,
  setClusterShareMetrics,
  setConfirmationLag,
  observePublishToHeadMs,
  incFeeRecipientMismatch,
  type Gate7DbSnapshot,
} from "../src/metrics";
import { renderMetricsText } from "../src/metricsServer";

const NAMED_SERIES = [
  "indexer_head_lag_seconds",
  "ws_publish_to_head_ms",
  "confirmation_safe_lag_blocks",
  "confirmation_finalized_lag_blocks",
  "metadata_unfetched_total",
  "metadata_mismatch_total",
  "fee_recipient_mismatch_total",
  "eth_usd_snapshot_age_seconds",
  "redis_publish_errors_total",
  "funding_cluster_vol_share",
];

describe("registry exposition", () => {
  it("exposes every named gate-7 series (incl. cluster share)", () => {
    const text = renderRegistry();
    for (const name of NAMED_SERIES) expect(text).toContain(name);
  });

  it("ws_publish_to_head_ms renders as a histogram (buckets + sum + count)", () => {
    observePublishToHeadMs(120);
    const text = renderRegistry();
    expect(text).toContain("ws_publish_to_head_ms_bucket");
    expect(text).toContain('le="+Inf"');
    expect(text).toContain("ws_publish_to_head_ms_count");
  });
});

describe("cluster-share thresholds (M0 governance)", () => {
  it("defaults are X%=25 per-token, Y%=10 platform", () => {
    expect(DEFAULT_CLUSTER_ALERT_THRESHOLDS).toEqual({ perTokenPct: 25, platformPct: 10 });
    expect(loadClusterAlertThresholds({})).toEqual({ perTokenPct: 25, platformPct: 10 });
  });
  it("env overrides both thresholds", () => {
    expect(loadClusterAlertThresholds({ CLUSTER_ALERT_PER_TOKEN_PCT: "40", CLUSTER_ALERT_PLATFORM_PCT: "15" })).toEqual({
      perTokenPct: 40,
      platformPct: 15,
    });
  });
  it("evaluateClusterShare flags a breach strictly above the threshold", () => {
    const t = { perTokenPct: 25, platformPct: 10 };
    expect(evaluateClusterShare({ clusterShareTokenMaxPct: 30, clusterSharePlatformPct: 5 }, t)).toEqual({
      tokenBreach: true,
      platformBreach: false,
    });
    expect(evaluateClusterShare({ clusterShareTokenMaxPct: 25, clusterSharePlatformPct: 12 }, t)).toEqual({
      tokenBreach: false, // == threshold is not a breach
      platformBreach: true,
    });
  });
});

describe("in-process hooks + cluster-share gauges", () => {
  it("setClusterShareMetrics renders both scopes with the breach flag", () => {
    const thresholds = { perTokenPct: 25, platformPct: 10 };
    initClusterShareMetrics(thresholds);
    setClusterShareMetrics(30, 5, thresholds);
    const text = renderRegistry();
    expect(text).toContain('funding_cluster_vol_share{scope="token_max"} 30');
    expect(text).toContain('funding_cluster_vol_share{scope="platform"} 5');
    expect(text).toContain('funding_cluster_vol_share_breach{scope="token_max"} 1');
    expect(text).toContain('funding_cluster_vol_share_breach{scope="platform"} 0');
    expect(text).toContain('funding_cluster_vol_share_threshold_pct{scope="token_max"} 25');
  });

  it("setConfirmationLag + fee-recipient counter surface", () => {
    setConfirmationLag(100, 90, 80);
    incFeeRecipientMismatch();
    const text = renderRegistry();
    expect(text).toContain("confirmation_safe_lag_blocks 10");
    expect(text).toContain("confirmation_finalized_lag_blocks 20");
    expect(text).toMatch(/fee_recipient_mismatch_total \d+/);
  });
});

describe("renderGate7Metrics + /metrics server merge the DB snapshot", () => {
  const snapshot: Gate7DbSnapshot = {
    headLagSeconds: 7,
    metadataUnfetched: 3,
    metadataMismatch: 1,
    tradeFeeCeilingBreaches: 0,
    ethUsdSnapshotAgeSeconds: 42,
  };

  it("renderGate7Metrics applies DB-derived series", () => {
    const text = renderGate7Metrics(snapshot);
    expect(text).toContain("indexer_head_lag_seconds 7");
    expect(text).toContain("metadata_unfetched_total 3");
    expect(text).toContain("metadata_mismatch_total 1");
    expect(text).toContain("eth_usd_snapshot_age_seconds 42");
  });

  it("metricsServer.renderMetricsText serves the full exposition", async () => {
    const text = await renderMetricsText({ snapshot: async () => snapshot });
    for (const name of NAMED_SERIES) expect(text).toContain(name);
    expect(text).toContain("indexer_head_lag_seconds 7");
    expect(text).toContain("funding_cluster_vol_share");
  });

  it("a DB failure still serves the in-process registry (never a blank scrape)", async () => {
    const text = await renderMetricsText({
      snapshot: async () => {
        throw new Error("db down");
      },
    });
    expect(text).toContain("ws_publish_to_head_ms");
    expect(text).toContain("funding_cluster_vol_share");
  });
});
