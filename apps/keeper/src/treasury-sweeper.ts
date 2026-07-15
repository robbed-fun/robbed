/**
 * TreasuryFeeSweeper — permissionless BondingCurve.sweepFees() automation.
 *
 * This is deliberately separate from GraduationKeeper. Graduation liveness and
 * treasury fee collection share a signer and DB, but they are different duties:
 * - graduate() is a lifecycle transition with retry/revert classification.
 * - sweepFees() is a housekeeping tx that drains the curve's treasury fee escrow.
 *
 * The contract already enforces safety: sweepFees() zeroes `accruedFees` and
 * sends to the factory's live treasury Safe. The keeper holds no new authority.
 */
import { gasWithBuffer } from "./gas";
import type { KeeperMetrics } from "./metrics";
import type { Address, ChainPort, DbPort, KeeperClock, KeeperLogger, TreasurySweepResult } from "./types";

export interface TreasurySweepTuning {
  /** Sweep immediately once a curve's accrued treasury fees reach this amount. */
  minSweepWei: bigint;
  /** Sweep smaller nonzero balances at least this often per curve. */
  maxSweepAgeMs: number;
  /** Absolute gas cap (gas units) for sweepFees(); default matches graduation. */
  gasCap: bigint;
}

export const DEFAULT_TREASURY_SWEEP_TUNING: TreasurySweepTuning = {
  minSweepWei: 500_000_000_000_000_000n, // 0.5 ETH
  maxSweepAgeMs: 86_400_000, // 24h
  gasCap: 30_000_000n,
};

export interface TreasurySweeperDeps {
  chain: ChainPort;
  db: DbPort;
  metrics: KeeperMetrics;
  log: KeeperLogger;
  clock: KeeperClock;
  tuning?: Partial<TreasurySweepTuning>;
}

export class TreasuryFeeSweeper {
  private readonly chain: ChainPort;
  private readonly db: DbPort;
  private readonly metrics: KeeperMetrics;
  private readonly log: KeeperLogger;
  private readonly clock: KeeperClock;
  private readonly tuning: TreasurySweepTuning;

  private readonly inFlight = new Set<string>();
  private readonly lastSweepAtByCurve = new Map<string, number>();

  constructor(deps: TreasurySweeperDeps) {
    this.chain = deps.chain;
    this.db = deps.db;
    this.metrics = deps.metrics;
    this.log = deps.log;
    this.clock = deps.clock;
    this.tuning = { ...DEFAULT_TREASURY_SWEEP_TUNING, ...deps.tuning };
  }

  async sweep(): Promise<TreasurySweepResult[]> {
    const rows = await this.db.findTreasuryFeeCurves();
    this.metrics.recordTreasurySweep(this.clock.now(), rows.length);
    const results: TreasurySweepResult[] = [];
    for (const row of rows) {
      results.push(await this.sweepCurve(row.curve, row.token));
    }
    return results;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  private async sweepCurve(curveRaw: Address, token: Address): Promise<TreasurySweepResult> {
    const curve = curveRaw.toLowerCase() as Address;
    if (this.inFlight.has(curve)) return { curve, token, status: "skipped_in_flight" };
    this.inFlight.add(curve);
    try {
      return await this.run(curve, token);
    } finally {
      this.inFlight.delete(curve);
    }
  }

  private async run(curve: Address, token: Address): Promise<TreasurySweepResult> {
    const now = this.clock.now();
    const amountWei = await this.chain.readTreasuryFees(curve);
    if (amountWei === null) {
      this.log.warn("treasury_fee_read_failed", { curve, token });
      return { curve, token, status: "fee_read_unavailable" };
    }

    const lastSweepAt = this.lastSweepAtByCurve.get(curve);
    if (amountWei === 0n) {
      if (lastSweepAt === undefined) this.lastSweepAtByCurve.set(curve, now);
      return { curve, token, status: "no_fees", amountWei };
    }

    const dueByThreshold = amountWei >= this.tuning.minSweepWei;
    const dueByAge = lastSweepAt === undefined || now - lastSweepAt >= this.tuning.maxSweepAgeMs;
    if (!dueByThreshold && !dueByAge) {
      return { curve, token, status: "below_threshold", amountWei };
    }

    try {
      const estimate = await this.chain.estimateSweepFeesGas(curve);
      const gas = gasWithBuffer(estimate, this.tuning.gasCap);
      const txHash = await this.chain.sendSweepFees(curve, gas);
      const receipt = await this.chain.waitForReceipt(txHash);
      if (receipt.status !== "success") throw new Error(`sweepFees reverted: ${txHash}`);

      this.lastSweepAtByCurve.set(curve, now);
      this.metrics.incTreasuryFeesSwept();
      this.log.info("treasury_fees_swept", {
        curve,
        token,
        amountWei: amountWei.toString(),
        txHash,
        reason: dueByThreshold ? "threshold" : "daily",
      });
      return { curve, token, status: "swept", amountWei, txHash };
    } catch (err) {
      this.metrics.incTreasurySweepFailure();
      this.log.warn("treasury_fee_sweep_failed", {
        curve,
        token,
        amountWei: amountWei.toString(),
        kind: this.chain.classifyError(err),
        err: String(err),
      });
      return { curve, token, status: "failed", amountWei };
    }
  }
}
