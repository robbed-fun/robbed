/**
 * Confirmation-state tracker (indexer.md §5, spec §2.1/§12.20/§12.48c; M2-6,
 * reworked at M2-3 per the OI-11 verdict).
 *
 * A side-process loop (independent of Ponder's sync, §5.1) that:
 *  1. every ~5s polls the L2 `safe` / `finalized` block tags (§5.1 step 1);
 *  2. advances the `confirmation_watermarks` singleton MONOTONICALLY (§5.1 s2);
 *  3. broadcasts ONE `global:confirmations` message per advance (§12.20 — O(1),
 *     NOT O(rows); clients upgrade held events locally from the watermark, §5.2);
 *  4. emits a `reorg` notice when the observed head regresses (§5.3).
 *
 * ── OI-11 / §12.48c: sidecar READ-DERIVATION, no per-row writes ─────────────
 * Decision (2026-07-11, basis recorded): per-row `confirmation_state` is NEVER
 * stored on Ponder-managed tables and NEVER written back by this tracker. The
 * previous design (ranged external `UPDATE`s of a `confirmation_state` column)
 * was disproven by the OI-11 verification against the pinned ponder 0.16.8
 * (decisions.md §11, indexer.md §7.3): Ponder's indexing-store cache retains
 * rows in memory across realtime blocks, prefetch never re-reads cached keys,
 * and flush rewrites ALL columns from the cached copy — so an external upgrade
 * on a handler-mutated row (`tokens` on every Trade) is silently reverted and
 * states flap backwards, violating the §5.1 monotonicity invariant. Ponder's
 * own docs are explicit: "Direct SQL queries should not insert, update, or
 * delete rows from Ponder tables" (ponder.sh/docs/query/direct-sql, checked
 * 2026-07-11). §12.48c sanctions the sidecar shape; of the two sidecar
 * variants (per-row `event_confirmations` join table vs pure read-derivation)
 * we chose READ-DERIVATION — the strongest form: the tier of any row is a pure
 * function of `block_number` vs the offchain `confirmation_watermarks`
 * singleton (§3.8, migrations/0002 — the sidecar), derived at read time by
 * every consumer. No write-back exists, so nothing can be reverted or drift;
 * a per-row join table would only re-introduce O(rows) writes for data that is
 * fully determined by two integers. The API derives the tier in its SELECTs
 * (`apps/api/src/lib/confirmation.ts` `confirmationStateSql`) and DTO
 * projections (`projectConfirmation`); both encode the same `stateForBlock`
 * rule from `@robbed/shared`, so they can never disagree.
 *
 * Monotonicity now holds STRUCTURALLY: `stateForBlock(b, wm)` is monotone in
 * `wm`, and `nextWatermark` never lets `safe`/`finalized` regress — therefore a
 * derived tier can never go backwards (asserted by the transition suite).
 *
 * Other decide-it-yourself decisions (basis recorded inline):
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
import { stateForBlock, type ConfirmationState } from "@robbed/shared";
import {
  getDefaultPublisher,
  publishConfirmations,
  publishReorg,
  type RedisPublisher,
} from "./publish";
import { setConfirmationLag } from "./metrics";

/** Poll cadence — posting is minutes, finality ~13min, so 5s is ample (§5.1). */
export const TRACKER_POLL_MS = 5_000;

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
 * (reorg-immune, §5.3): we take the max so a transient lower reading can never
 * regress a derived tier (the ONLY monotonicity anchor under read-derivation).
 * `latest` may regress on a reorg — handled by `detectReorg`, not here (here we
 * still floor it forward for the steady case). Returns the next state and
 * whether `safe`/`finalized` advanced (the trigger for persist + broadcast).
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
 * Pure read-derivation of the authoritative rule (§3.8) over a set of rows —
 * the reference the transition suite drives (monotonicity, boundary-block) and
 * the exact semantics the API's SQL derivation must encode. Stateless: the tier
 * is a pure function of `blockNumber` vs the watermark sidecar; no stored
 * per-row state exists to upgrade or to corrupt (OI-11/§12.48c).
 */
export function deriveConfirmationStates<T extends { blockNumber: number }>(
  rows: T[],
  wm: Pick<WatermarkState, "safe" | "finalized">,
): Array<T & { confirmationState: ConfirmationState }> {
  return rows.map((r) => ({
    ...r,
    confirmationState: stateForBlock(r.blockNumber, {
      safeBlock: wm.safe,
      finalizedBlock: wm.finalized,
    }),
  }));
}

// ── Runtime driver (injectable — the transition suite drives `runTrackerTick`) ─

/**
 * Persistence boundary for the watermark SIDECAR singleton only (Pg impl in
 * `confirmationStore.ts`; fake in tests). Deliberately has NO way to touch
 * Ponder-managed tables (OI-11 — external writes are forbidden).
 */
export interface ConfirmationStore {
  loadWatermarks(): Promise<WatermarkState | null>;
  saveWatermarks(wm: WatermarkState): Promise<void>;
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
 * → persist + O(1) broadcast on advance. No per-row writes of any kind — tiers
 * are derived at read time from the persisted watermark (OI-11/§12.48c). Never
 * throws into the loop.
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
