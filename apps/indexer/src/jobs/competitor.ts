/**
 * Weekly hood.fun traction snapshot (indexer.md §8.5.3, spec §3/§13/§14; M2-14).
 *
 * Records a SOURCE + TIMESTAMPED snapshot of hood.fun traction (tokens created/
 * day, graduation count, visible volume) into `competitor_snapshots`, feeding
 * Gate G-A.2 (spec §14). NEVER a hardcoded metric (§2 hard rule): every row
 * carries its `source` and `captured_at`, and if no source is configured the job
 * records NOTHING — it never fabricates a number.
 *
 * hood.fun is a competitor (we don't index their contracts), so the traction
 * numbers come from an EXTERNAL source (a Dune query, §8.5.3) injected as a
 * `CompetitorSource`. Until a Dune source is wired the job logs "unconfigured"
 * and writes no row (manual/Dune interim, §8.5.3). `visible_volume_eth` is an
 * ETH-wei decimal string (avoids float precision loss on aggregated volume).
 *
 * Decide-it-yourself: WEEKLY cadence via a wall-clock `setInterval` side-process
 * (same pattern as the confirmation tracker / flow job), NOT a Ponder
 * block-interval source. Basis: a weekly cadence on a ~100ms L2 would need a
 * ~6M-block interval that drifts with block time; a wall-clock timer is the
 * boring, correct fit for a calendar-week job (docs-first: Ponder `blocks:`
 * intervals are block-denominated — verified against ponder.sh, wrong tool here).
 */
import { Pool } from "pg";
import type { CompetitorSnapshotRow } from "@robbed/shared";

/** Raw traction numbers from the external source (Dune / own indexer). */
export interface CompetitorTraction {
  tokensPerDay: number;
  graduations: number;
  /** ETH-wei decimal string — never a float, never hardcoded. */
  visibleVolumeEthWei: string;
}

/** Injected traction fetcher. Returns `null` when unconfigured (writes nothing). */
export interface CompetitorSource {
  /** Stable source label persisted with the row (e.g. `dune:query/1234567`). */
  readonly label: string;
  fetch(): Promise<CompetitorTraction | null>;
}

const DECIMAL_RE = /^\d+$/;

/**
 * Build a validated, timestamped snapshot row. Throws on a malformed volume
 * string (never silently coerces a bad metric). `capturedAt` is the ISO capture
 * instant — the row is meaningless without it (§2).
 */
export function buildCompetitorSnapshot(
  source: string,
  capturedAt: string,
  traction: CompetitorTraction,
): CompetitorSnapshotRow {
  if (!source || source.trim() === "") throw new Error("[competitor] source is required (never a hardcoded metric, §2)");
  if (!capturedAt) throw new Error("[competitor] capturedAt is required (source+timestamped, §2)");
  if (!DECIMAL_RE.test(traction.visibleVolumeEthWei)) {
    throw new Error(`[competitor] visibleVolumeEthWei must be a wei decimal string, got: ${traction.visibleVolumeEthWei}`);
  }
  if (!Number.isInteger(traction.tokensPerDay) || traction.tokensPerDay < 0) {
    throw new Error(`[competitor] tokensPerDay must be a non-negative integer, got: ${traction.tokensPerDay}`);
  }
  if (!Number.isInteger(traction.graduations) || traction.graduations < 0) {
    throw new Error(`[competitor] graduations must be a non-negative integer, got: ${traction.graduations}`);
  }
  return {
    source,
    captured_at: capturedAt,
    tokens_per_day: traction.tokensPerDay,
    graduations: traction.graduations,
    visible_volume_eth: traction.visibleVolumeEthWei,
  };
}

export interface CompetitorStore {
  write(row: CompetitorSnapshotRow): Promise<void>;
}

export function createPgCompetitorStore(pool: Pool): CompetitorStore {
  return {
    async write(row: CompetitorSnapshotRow): Promise<void> {
      await pool.query(
        `INSERT INTO competitor_snapshots
           (source, captured_at, tokens_per_day, graduations, visible_volume_eth)
         VALUES ($1, $2::timestamptz, $3, $4, $5)
         ON CONFLICT (source, captured_at) DO UPDATE SET
           tokens_per_day = EXCLUDED.tokens_per_day,
           graduations = EXCLUDED.graduations,
           visible_volume_eth = EXCLUDED.visible_volume_eth`,
        [row.source, row.captured_at, row.tokens_per_day, row.graduations, row.visible_volume_eth],
      );
    },
  };
}

/**
 * An unconfigured source — the default until a Dune query is wired. Fetches
 * nothing so the job never fabricates a metric (§8.5.3 "Manual/Dune until the
 * job lands").
 */
export function unconfiguredCompetitorSource(): CompetitorSource {
  return {
    label: "unconfigured",
    async fetch() {
      return null;
    },
  };
}

export interface CompetitorJobDeps {
  source: CompetitorSource;
  store: CompetitorStore;
  now?: () => Date;
  logger?: Pick<Console, "log" | "error">;
}

/** Weekly cadence (ms) — calendar-week traction snapshot (§8.5.3). */
export const COMPETITOR_SNAPSHOT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CompetitorJobHandle {
  stop(): void;
}

/** Start the weekly snapshot job (runs once immediately, then every interval). */
export function startCompetitorSnapshotJob(
  deps: CompetitorJobDeps,
  intervalMs: number = COMPETITOR_SNAPSHOT_INTERVAL_MS,
): CompetitorJobHandle {
  void runCompetitorSnapshotTick(deps);
  const timer = setInterval(() => void runCompetitorSnapshotTick(deps), intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  return { stop: () => clearInterval(timer) };
}

/** One snapshot iteration: fetch → build (validated) → persist a dated row. */
export async function runCompetitorSnapshotTick(deps: CompetitorJobDeps): Promise<CompetitorSnapshotRow | null> {
  const now = deps.now ?? (() => new Date());
  const log = deps.logger ?? console;
  try {
    const traction = await deps.source.fetch();
    if (!traction) {
      log.log(`[competitor] source '${deps.source.label}' unconfigured/empty — no snapshot written (never fabricates a metric, §2).`);
      return null;
    }
    const row = buildCompetitorSnapshot(deps.source.label, now().toISOString(), traction);
    await deps.store.write(row);
    log.log(`[competitor] snapshot written: source=${row.source} at=${row.captured_at}`);
    return row;
  } catch (err) {
    log.error("[competitor] snapshot tick failed (advisory — indexing unaffected):", err);
    return null;
  }
}
