/**
 * In-memory graduation registry (indexer.md) — routes V3 `Swap`
 * (pool → token + orientation) and filters V3 `Collect` (lp_token_id → our
 * LPFeeVault positions only, since the NonfungiblePositionManager is shared and
 * emits Collect for every position on chain).
 *
 * Steady-state has ZERO per-event DB reads (the requirement) the registry
 * is populated by the `Graduated` handler as tokens graduate, and lazily
 * hydrated ONCE from the `graduations` table on the first Swap/Collect after a
 * process restart (Ponder resumes from a checkpoint and does not re-emit old
 * `Graduated` events, so the in-memory maps would otherwise be cold). One full
 * scan of the small `graduations` table on first use, then never again — the
 * boring, restart-safe, rebuildable-from-raw choice.
 */
export interface GradInfo {
  tokenAddress: string;
  poolAddress: string;
  lpTokenId: bigint;
  tokenIsToken0: boolean;
}

export class GraduationRegistry {
  private readonly byPool = new Map<string, GradInfo>();
  private readonly byLpTokenId = new Map<string, GradInfo>();
  private hydrated = false;

  register(info: GradInfo): void {
    const pool = info.poolAddress.toLowerCase();
    const rec: GradInfo = { ...info, poolAddress: pool, tokenAddress: info.tokenAddress.toLowerCase() };
    this.byPool.set(pool, rec);
    this.byLpTokenId.set(info.lpTokenId.toString(), rec);
  }

  /**
   * One-time hydration from persisted graduations. `loader` returns every
   * graduation row (a full scan of the small table). Idempotent: runs at most
   * once per process.
   */
  async hydrateOnce(loader: () => Promise<GradInfo[]>): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    for (const info of await loader()) this.register(info);
  }

  lookupByPool(pool: string): GradInfo | undefined {
    return this.byPool.get(pool.toLowerCase());
  }

  lookupByLpTokenId(lpTokenId: bigint): GradInfo | undefined {
    return this.byLpTokenId.get(lpTokenId.toString());
  }

  /** Test/introspection helper. */
  get size(): number {
    return this.byPool.size;
  }
}

/** Process-wide singleton shared by the Swap/Collect handlers. */
export const graduationRegistry = new GraduationRegistry();
