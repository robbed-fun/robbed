/**
 * Confirmation-state tracker (indexer.md §5, spec §2.1/§12.20; M2-6).
 *
 * A side-process loop (independent of Ponder's sync, §5.1) that:
 *  1. every ~5s polls the L2 `safe` / `finalized` block tags (§5.1 step 1);
 *  2. advances the `confirmation_watermarks` singleton MONOTONICALLY (§5.1 s2);
 *  3. materializes per-row `confirmation_state` with ranged `UPDATE`s (§5.1 s3);
 *  4. broadcasts ONE `global:confirmations` message per advance (§12.20 — O(1),
 *     NOT O(rows); clients upgrade held events locally from the watermark, §5.2);
 *  5. emits a `reorg` notice when the observed head regresses (§5.3).
 *
 * The rule that maps a block to a state lives ONCE in `@robbed/shared`
 * (`stateForBlock`); both the pure `materializeRows` (used by the transition
 * suite) and the ranged SQL predicates below derive from the SAME boundaries, so
 * they can never disagree (asserted by the boundary test).
 *
 * Decide-it-yourself decisions (basis recorded inline):
 *  - **Direct ranged UPDATE vs sidecar (OI-11).** Chosen: direct `UPDATE` of
 *    `confirmation_state` on the Ponder-managed event tables — monotonic,
 *    reorg-compatible, one indexed pass on `block_number` (§7.3 sanctioned single
 *    external write). This is the boring path; if the pinned Ponder version
 *    forbids external writes to its live store the fallback is an
 *    `event_confirmations` sidecar joined at read time (not built here). Verify
 *    against the pinned version at M2-3 (OI-11 still OPEN, §10).
 *  - **Reorg detection.** Watermarks are reorg-IMMUNE by construction (§5.3 —
 *    they only reference L1-posted blocks, never soft-confirmed head), so the
 *    only visible reorg signal is the L2 HEAD moving backwards. We detect
 *    `observed.latest < current.latest` and emit `reorg{ fromBlock: latest+1 }`
 *    so clients drop orphaned soft-confirmed rows; `safe`/`finalized` never
 *    regress. Ponder itself rolls back its onchain tables (§7.1) — we only label.
 *  - **OI-8 tag support.** If the RPC rejects `safe`/`finalized`, the fetcher
 *    returns `null` and the tick no-ops; the L1-watermark fallback (M2-3b) is the
 *    documented seam, NOT built here. OPEN (§10).
 */
import {
  stateForBlock,
  upgradeConfirmationState,
  type ConfirmationState,
} from "@robbed/shared";
import {
  getDefaultPublisher,
  publishConfirmations,
  publishReorg,
  type RedisPublisher,
} from "./publish";
import { setConfirmationLag } from "./metrics";

/** Poll cadence — posting is minutes, finality ~13min, so 5s is ample (§5.1). */
export const TRACKER_POLL_MS = 5_000;

/**
 * Ponder-managed event tables carrying a `confirmation_state` column
 * (indexer.md §3). `balances`/`candles` are derived (no per-event state).
 * Fixed allowlist — interpolated into DDL, never from user input.
 */
export const CONFIRMATION_EVENT_TABLES = [
  "tokens",
  "trades",
  "transfers",
  "graduations",
  "fee_collections",
] as const;
export type ConfirmationEventTable = (typeof CONFIRMATION_EVENT_TABLES)[number];

/** In-memory watermark snapshot (mirrors `confirmation_watermarks`, §3.8). */
export interface WatermarkState {
  latest: number;
  safe: number;
  finalized: number;
}

/** Freshly-polled block tags (§5.1 step 1). */
export interface ObservedTags {
  latest: number;
  safe: number;
  finalized: number;
}

// ── Pure decisions ──────────────────────────────────────────────────────────

/**
 * Monotonic watermark advance. `safe`/`finalized` only ever move forward
 * (reorg-immune, §5.3): we take the max so a transient lower reading never
 * downgrades a materialized row. `latest` may regress on a reorg — handled by
 * `detectReorg`, not here (here we still floor it forward for the steady case).
 * Returns the next state and whether `safe`/`finalized` advanced (the trigger
 * for materialization + broadcast).
 */
export function nextWatermark(
  current: WatermarkState,
  observed: ObservedTags,
): { next: WatermarkState; advanced: boolean } {
  const safe = Math.max(current.safe, observed.safe);
  const finalized = Math.max(current.finalized, observed.finalized);
  const latest = Math.max(current.latest, observed.latest);
  const advanced = safe > current.safe || finalized > current.finalized;
  return { next: { latest, safe, finalized }, advanced };
}

/**
 * Reorg = the observed L2 head is BELOW the last recorded head (§5.3). Returns
 * the orphan floor (`fromBlock`) clients must drop from, or `null` if no regress.
 */
export function detectReorg(currentLatest: number, observedLatest: number): number | null {
  return observedLatest < currentLatest ? observedLatest + 1 : null;
}

/**
 * Pure materialization of the authoritative rule (§3.8) over a set of rows —
 * the reference the transition suite drives (monotonicity, boundary-block).
 * Never downgrades: the new state is `upgrade(current, stateForBlock(...))`.
 */
export function materializeRows<T extends { blockNumber: number; confirmationState: ConfirmationState }>(
  rows: T[],
  wm: Pick<WatermarkState, "safe" | "finalized">,
): Array<Omit<T, "confirmationState"> & { confirmationState: ConfirmationState }> {
  return rows.map((r) => ({
    ...r,
    confirmationState: upgradeConfirmationState(
      r.confirmationState,
      stateForBlock(r.blockNumber, { safeBlock: wm.safe, finalizedBlock: wm.finalized }),
    ),
  }));
}

export interface SqlStatement {
  text: string;
  params: unknown[];
}

/**
 * Ranged monotonic `UPDATE`s that materialize `confirmation_state` for one event
 * table. `finalized` runs FIRST so a block `<= finalized` becomes `finalized`
 * and is then excluded from the `posted_to_l1` pass (WHERE `= 'soft_confirmed'`)
 * — encodes exactly the `stateForBlock` boundaries with no downgrade path.
 */
export function materializationStatementsForTable(
  schema: string,
  table: ConfirmationEventTable,
  wm: Pick<WatermarkState, "safe" | "finalized">,
): SqlStatement[] {
  const rel = `"${schema}"."${table}"`;
  return [
    {
      text: `UPDATE ${rel} SET confirmation_state = 'finalized' WHERE block_number <= $1 AND confirmation_state <> 'finalized'`,
      params: [wm.finalized],
    },
    {
      text: `UPDATE ${rel} SET confirmation_state = 'posted_to_l1' WHERE block_number <= $1 AND confirmation_state = 'soft_confirmed'`,
      params: [wm.safe],
    },
  ];
}

/** All ranged statements across every event table (§5.1 step 3). */
export function materializationStatements(
  schema: string,
  wm: Pick<WatermarkState, "safe" | "finalized">,
): SqlStatement[] {
  return CONFIRMATION_EVENT_TABLES.flatMap((t) => materializationStatementsForTable(schema, t, wm));
}

// ── Runtime driver (injectable — the transition suite drives `runTrackerTick`) ─

/** Persistence + materialization boundary (Pg impl below; fake in tests). */
export interface ConfirmationStore {
  loadWatermarks(): Promise<WatermarkState | null>;
  saveWatermarks(wm: WatermarkState): Promise<void>;
  /** Run the ranged `UPDATE`s for the given watermarks (one indexed pass each). */
  materialize(wm: Pick<WatermarkState, "safe" | "finalized">): Promise<void>;
}

/** Polls the L2 block tags; returns `null` if the RPC rejects them (OI-8 seam). */
export type TagFetcher = () => Promise<ObservedTags | null>;

export interface TrackerDeps {
  store: ConfirmationStore;
  fetchTags: TagFetcher;
  publisher: RedisPublisher;
  now?: () => number;
  logger?: Pick<Console, "error" | "warn">;
}

/**
 * One tracker iteration (pure orchestration over injected deps). Returns the
 * next in-memory watermark state. Steps: fetch → reorg check → monotonic advance
 * → materialize + persist + broadcast on advance. Never throws into the loop.
 */
export async function runTrackerTick(current: WatermarkState, deps: TrackerDeps): Promise<WatermarkState> {
  const now = deps.now ?? (() => Date.now());
  const log = deps.logger ?? console;
  let state = current;
  try {
    const observed = await deps.fetchTags();
    if (!observed) return state; // OI-8: tags unsupported this tick — no-op.

    // Reorg notice (§5.3) — head regressed; safe/finalized are immune.
    const orphanFrom = detectReorg(state.latest, observed.latest);
    if (orphanFrom !== null) {
      publishReorg(deps.publisher, orphanFrom, Math.floor(now() / 1000));
      state = { ...state, latest: observed.latest };
    }

    const { next, advanced } = nextWatermark(state, observed);
    state = next;
    // Gate-7 (§9.4): keep the confirmation-lag gauges fresh every tick.
    setConfirmationLag(next.latest, next.safe, next.finalized);
    if (advanced) {
      await deps.store.materialize({ safe: next.safe, finalized: next.finalized });
      await deps.store.saveWatermarks(next);
      publishConfirmations(deps.publisher, next.safe, next.finalized, Math.floor(now() / 1000));
    } else if (orphanFrom !== null) {
      // Reorg only: persist the regressed head so the next tick compares fresh.
      await deps.store.saveWatermarks(next);
    }
  } catch (err) {
    log.error("[confirmation tracker] tick failed:", err);
  }
  return state;
}

export interface TrackerHandle {
  stop(): void;
}

/**
 * Start the tracker loop. Loads (or seeds) the watermark singleton, then ticks
 * every `intervalMs`. Fire-and-forget errors are logged (never crash the loop).
 */
export async function startConfirmationTracker(
  deps: TrackerDeps,
  intervalMs: number = TRACKER_POLL_MS,
): Promise<TrackerHandle> {
  let state =
    (await deps.store.loadWatermarks()) ?? { latest: 0, safe: 0, finalized: 0 };
  let running = true;
  const timer = setInterval(() => {
    if (!running) return;
    void runTrackerTick(state, deps).then((next) => {
      state = next;
    });
  }, intervalMs);
  // `unref` so the loop never keeps a short-lived process alive on its own.
  (timer as unknown as { unref?: () => void }).unref?.();
  return {
    stop() {
      running = false;
      clearInterval(timer);
    },
  };
}

/** Convenience: the process publisher (Redis) shared with the handler path. */
export function trackerPublisher(): RedisPublisher {
  return getDefaultPublisher();
}
