/**
 * §8.5 bot/farm scheduled job (M2-13) + its gate-7 cluster-share feed (M2-12).
 *
 * A wall-clock `setInterval` side-process (same pattern as the confirmation
 * tracker / metadata verifier) that periodically recomputes `address_flags` +
 * `token_flow_stats` from `trades`+`transfers` via the pure `runFlowAnalysis`,
 * then feeds the funder-cluster vol-share gauges (gate-7 X%/Y%). Advisory only —
 * nothing here gates a trade, listing, or any chain interaction (§8.4/§8.5).
 *
 * Decide-it-yourself: periodic wall-clock cadence (default 60s, like the
 * volume_eth_24h decay job, §4.4) rather than a Ponder block-interval source —
 * these are derived, rebuildable side tables that never need per-block freshness,
 * and a timer is the boring fit (docs verified: Ponder `blocks:` is
 * block-denominated, wrong tool for a periodic derive).
 */
import {
  runFlowAnalysis,
  computePlatformClusterShare,
  maxTokenClusterShare,
  type FlowThresholds,
} from "./heuristics";
import type { FlowStore } from "./store";
import {
  setClusterShareMetrics,
  type ClusterAlertThresholds,
} from "../metrics";

/** Default flow-job cadence (ms) — periodic derive, not hot-path (§4.4). */
export const FLOW_JOB_INTERVAL_MS = 60_000;

export interface FlowJobDeps {
  store: FlowStore;
  thresholds: FlowThresholds;
  whitelist: ReadonlySet<string>;
  clusterThresholds: ClusterAlertThresholds;
  now?: () => Date;
  logger?: Pick<Console, "error">;
}

/**
 * One flow-job iteration: load aggregates → analyze → persist → feed the gate-7
 * cluster-share gauges. Never throws into the loop (advisory).
 */
export async function runFlowJobTick(deps: FlowJobDeps): Promise<{
  addresses: number;
  tokens: number;
  clusterShareTokenMaxPct: number;
  clusterSharePlatformPct: number;
} | null> {
  const now = deps.now ?? (() => new Date());
  const log = deps.logger ?? console;
  try {
    const input = await deps.store.loadInput();
    const result = runFlowAnalysis(input, deps.thresholds, deps.whitelist);
    await deps.store.writeResults(result, now().toISOString());

    const tokenMax = maxTokenClusterShare(result);
    const platform = computePlatformClusterShare(input, result);
    setClusterShareMetrics(tokenMax, platform, deps.clusterThresholds);

    return {
      addresses: result.addressFlags.length,
      tokens: result.tokenStats.length,
      clusterShareTokenMaxPct: tokenMax,
      clusterSharePlatformPct: platform,
    };
  } catch (err) {
    log.error("[flow job] tick failed (advisory — indexing unaffected):", err);
    return null;
  }
}

export interface JobHandle {
  stop(): void;
}

/** Start the periodic flow job. Runs once immediately, then every `intervalMs`. */
export function startFlowJob(deps: FlowJobDeps, intervalMs: number = FLOW_JOB_INTERVAL_MS): JobHandle {
  void runFlowJobTick(deps);
  const timer = setInterval(() => void runFlowJobTick(deps), intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  return { stop: () => clearInterval(timer) };
}
