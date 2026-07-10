/**
 * address_pnl scheduled roll-up job (spec §5.4 portfolio; db-rows `AddressPnlRow`).
 *
 * A wall-clock `setInterval` side-process (same pattern as the confirmation
 * tracker / metadata verifier / §8.5 flow job) that periodically recomputes the
 * per-address portfolio roll-up from `trades`+`transfers`+`tokens` via the pure
 * `rollUpAddressPnl`, then TRUNCATE+re-inserts `address_pnl`. Advisory / read-only
 * — nothing here gates a trade, listing, or any chain interaction (§8.4).
 *
 * Decide-it-yourself: periodic wall-clock cadence (default 60s, like the
 * volume_eth_24h decay / flow job, §4.4) rather than a Ponder block-interval
 * source — `address_pnl` is a derived, rebuildable side table that never needs
 * per-block freshness (wallet ETH + unrealized PnL are computed live at the API
 * layer; only the realized roll-up is materialized), and a timer is the boring
 * fit (Ponder `blocks:` is block-denominated — wrong tool for a periodic derive).
 */
import { rollUpAddressPnl } from "./compute";
import type { PnlStore } from "./store";

/** Default cadence (ms) — periodic derive, not hot-path (§4.4). */
export const PNL_JOB_INTERVAL_MS = 60_000;

export interface PnlJobDeps {
  store: PnlStore;
  now?: () => Date;
  logger?: Pick<Console, "error">;
}

/** One tick: load view aggregates → roll up → persist. Never throws into the loop. */
export async function runPnlJobTick(deps: PnlJobDeps): Promise<{ addresses: number } | null> {
  const now = deps.now ?? (() => new Date());
  const log = deps.logger ?? console;
  try {
    const input = await deps.store.loadInput();
    const rows = rollUpAddressPnl(input);
    await deps.store.writeResults(rows, now().toISOString());
    return { addresses: rows.length };
  } catch (err) {
    log.error("[address_pnl job] tick failed (advisory — indexing unaffected):", err);
    return null;
  }
}

export interface JobHandle {
  stop(): void;
}

/** Start the periodic roll-up. Runs once immediately, then every `intervalMs`. */
export function startPnlJob(deps: PnlJobDeps, intervalMs: number = PNL_JOB_INTERVAL_MS): JobHandle {
  void runPnlJobTick(deps);
  const timer = setInterval(() => void runPnlJobTick(deps), intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  return { stop: () => clearInterval(timer) };
}
