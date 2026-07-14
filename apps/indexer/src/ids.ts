/**
 * Idempotency key (indexer.md, decide-it-yourself "Idempotency dedup key"):
 * every event row is keyed `(tx_hash, log_index)` as `${txHash}-${logIndex}`.
 * All handlers guard their derived increments on this id so a re-delivered log
 * (reorg replay / restart overlap) is a no-op — it can never double-count.
 */
export function eventId(txHash: string, logIndex: number): string {
  return `${txHash.toLowerCase()}-${logIndex}`;
}

/** Lower-cased address (indexer.md conventions: addresses stored lowercase). */
export function lower(addr: string): string {
  return addr.toLowerCase();
}

/**
 * Position comparator for the high-water idempotency guard: is `(aBlock,aLog)`
 * at or before `(bBlock,bLog)`? Used by the candle pipeline (skip re-apply) and
 * anywhere increments must not run twice.
 */
export function positionLte(aBlock: number, aLog: number, bBlock: number, bLog: number): boolean {
  if (aBlock !== bBlock) return aBlock < bBlock;
  return aLog <= bLog;
}
