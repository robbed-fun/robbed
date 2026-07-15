/**
 * LpFeeCollector — permissionless LPFeeVault.collect(tokenId) automation.
 *
 * Post-graduation swaps accrue Uniswap V3 fees inside the LP NFT. They are not
 * pushed to the treasury Safe / CreatorVault until someone calls
 * `LPFeeVault.collect(tokenId)`, which harvests and splits the fees 50/50. The
 * call is permissionless and cannot redirect funds, so the keeper can safely be
 * the standing caller just like it is for BondingCurve.sweepFees().
 */
import { gasWithBuffer } from "./gas";
import type { KeeperMetrics } from "./metrics";
import type {
  Address,
  ChainPort,
  DbPort,
  KeeperClock,
  KeeperLogger,
  LpFeeCollectResult,
} from "./types";

export interface LpFeeCollectTuning {
  /** LPFeeVault address for this deployment generation. */
  vault: Address;
  /** Collect immediately once the simulated WETH leg reaches this amount. */
  minCollectWethWei: bigint;
  /** Collect smaller nonzero balances at least this often per LP tokenId. */
  maxCollectAgeMs: number;
  /** Absolute gas cap (gas units) for collect(); default matches graduation. */
  gasCap: bigint;
}

export const DEFAULT_LP_FEE_COLLECT_TUNING: Omit<LpFeeCollectTuning, "vault"> = {
  minCollectWethWei: 500_000_000_000_000_000n, // 0.5 WETH
  maxCollectAgeMs: 86_400_000, // 24h
  gasCap: 30_000_000n,
};

export interface LpFeeCollectorDeps {
  chain: ChainPort;
  db: DbPort;
  metrics: KeeperMetrics;
  log: KeeperLogger;
  clock: KeeperClock;
  tuning: Pick<LpFeeCollectTuning, "vault"> & Partial<Omit<LpFeeCollectTuning, "vault">>;
}

export class LpFeeCollector {
  private readonly chain: ChainPort;
  private readonly db: DbPort;
  private readonly metrics: KeeperMetrics;
  private readonly log: KeeperLogger;
  private readonly clock: KeeperClock;
  private readonly tuning: LpFeeCollectTuning;

  private readonly inFlight = new Set<string>();
  private readonly lastCollectAtByTokenId = new Map<string, number>();

  constructor(deps: LpFeeCollectorDeps) {
    this.chain = deps.chain;
    this.db = deps.db;
    this.metrics = deps.metrics;
    this.log = deps.log;
    this.clock = deps.clock;
    this.tuning = { ...DEFAULT_LP_FEE_COLLECT_TUNING, ...deps.tuning };
  }

  async collect(): Promise<LpFeeCollectResult[]> {
    const rows = await this.db.findGraduatedLpPositions();
    this.metrics.recordLpFeeCollectSweep(this.clock.now(), rows.length);
    const results: LpFeeCollectResult[] = [];
    for (const row of rows) {
      results.push(
        await this.collectPosition(row.token, row.pool, row.lpTokenId, row.tokenIsToken0),
      );
    }
    return results;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  private async collectPosition(
    token: Address,
    pool: Address,
    lpTokenIdRaw: bigint,
    tokenIsToken0: boolean,
  ): Promise<LpFeeCollectResult> {
    const lpTokenId = BigInt(lpTokenIdRaw);
    const key = lpTokenId.toString();
    if (this.inFlight.has(key)) return { token, pool, lpTokenId, status: "skipped_in_flight" };
    this.inFlight.add(key);
    try {
      return await this.run(token, pool, lpTokenId, tokenIsToken0);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async run(
    token: Address,
    pool: Address,
    lpTokenId: bigint,
    tokenIsToken0: boolean,
  ): Promise<LpFeeCollectResult> {
    const now = this.clock.now();
    const quote = await this.chain.simulateCollectLpFees(this.tuning.vault, lpTokenId);
    if (quote === null) {
      this.log.warn("lp_fee_collect_read_failed", { token, pool, lpTokenId: lpTokenId.toString() });
      return { token, pool, lpTokenId, status: "fee_read_unavailable" };
    }

    const { amount0, amount1 } = quote;
    const total = amount0 + amount1;
    const wethAmount = tokenIsToken0 ? amount1 : amount0;
    const lastCollectAt = this.lastCollectAtByTokenId.get(lpTokenId.toString());
    if (total === 0n) {
      if (lastCollectAt === undefined) this.lastCollectAtByTokenId.set(lpTokenId.toString(), now);
      return { token, pool, lpTokenId, status: "no_fees", amount0, amount1, wethAmount };
    }

    const dueByThreshold = wethAmount >= this.tuning.minCollectWethWei;
    const dueByAge =
      lastCollectAt === undefined || now - lastCollectAt >= this.tuning.maxCollectAgeMs;
    if (!dueByThreshold && !dueByAge) {
      return { token, pool, lpTokenId, status: "below_threshold", amount0, amount1, wethAmount };
    }

    try {
      const estimate = await this.chain.estimateCollectLpFeesGas(this.tuning.vault, lpTokenId);
      const gas = gasWithBuffer(estimate, this.tuning.gasCap);
      const txHash = await this.chain.sendCollectLpFees(this.tuning.vault, lpTokenId, gas);
      const receipt = await this.chain.waitForReceipt(txHash);
      if (receipt.status !== "success") throw new Error(`LPFeeVault.collect reverted: ${txHash}`);

      this.lastCollectAtByTokenId.set(lpTokenId.toString(), now);
      this.metrics.incLpFeesCollected();
      this.log.info("lp_fees_collected", {
        token,
        pool,
        lpTokenId: lpTokenId.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        wethAmount: wethAmount.toString(),
        txHash,
        reason: dueByThreshold ? "threshold" : "daily",
      });
      return { token, pool, lpTokenId, status: "collected", amount0, amount1, wethAmount, txHash };
    } catch (err) {
      this.metrics.incLpFeeCollectFailure();
      this.log.warn("lp_fee_collect_failed", {
        token,
        pool,
        lpTokenId: lpTokenId.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        wethAmount: wethAmount.toString(),
        kind: this.chain.classifyError(err),
        err: String(err),
      });
      return { token, pool, lpTokenId, status: "failed", amount0, amount1, wethAmount };
    }
  }
}
