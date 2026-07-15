/**
 * In-memory keeper metrics (pure — no I/O). Surfaced in the /healthz body and
 * logged; a persistent-revert increment is the donation-brick early-warning
 * (gate 7 monitoring, deploy.md H.5 stuck-graduation alert).
 */
export interface MetricsSnapshot {
  graduatedTotal: number;
  alreadyGraduatedTotal: number;
  failedPersistentTotal: number;
  transientRetriesTotal: number;
  sweepsTotal: number;
  lastSweepAt: number | null; // epoch ms
  lastSweepScanned: number | null;
  treasurySweepsTotal: number;
  treasuryFeesSweptTotal: number;
  treasurySweepFailuresTotal: number;
  lastTreasurySweepAt: number | null; // epoch ms
  lastTreasurySweepScanned: number | null;
  lpFeeCollectSweepsTotal: number;
  lpFeesCollectedTotal: number;
  lpFeeCollectFailuresTotal: number;
  lastLpFeeCollectSweepAt: number | null; // epoch ms
  lastLpFeeCollectSweepScanned: number | null;
}

export class KeeperMetrics {
  private graduated = 0;
  private alreadyGraduated = 0;
  private failedPersistent = 0;
  private transientRetries = 0;
  private sweeps = 0;
  private lastSweepAt: number | null = null;
  private lastSweepScanned: number | null = null;
  private treasurySweeps = 0;
  private treasuryFeesSwept = 0;
  private treasurySweepFailures = 0;
  private lastTreasurySweepAt: number | null = null;
  private lastTreasurySweepScanned: number | null = null;
  private lpFeeCollectSweeps = 0;
  private lpFeesCollected = 0;
  private lpFeeCollectFailures = 0;
  private lastLpFeeCollectSweepAt: number | null = null;
  private lastLpFeeCollectSweepScanned: number | null = null;

  incGraduated(): void {
    this.graduated += 1;
  }
  incAlreadyGraduated(): void {
    this.alreadyGraduated += 1;
  }
  incFailedPersistent(): void {
    this.failedPersistent += 1;
  }
  incTransientRetry(): void {
    this.transientRetries += 1;
  }
  recordSweep(at: number, scanned: number): void {
    this.sweeps += 1;
    this.lastSweepAt = at;
    this.lastSweepScanned = scanned;
  }
  recordTreasurySweep(at: number, scanned: number): void {
    this.treasurySweeps += 1;
    this.lastTreasurySweepAt = at;
    this.lastTreasurySweepScanned = scanned;
  }
  incTreasuryFeesSwept(): void {
    this.treasuryFeesSwept += 1;
  }
  incTreasurySweepFailure(): void {
    this.treasurySweepFailures += 1;
  }
  recordLpFeeCollectSweep(at: number, scanned: number): void {
    this.lpFeeCollectSweeps += 1;
    this.lastLpFeeCollectSweepAt = at;
    this.lastLpFeeCollectSweepScanned = scanned;
  }
  incLpFeesCollected(): void {
    this.lpFeesCollected += 1;
  }
  incLpFeeCollectFailure(): void {
    this.lpFeeCollectFailures += 1;
  }

  snapshot(): MetricsSnapshot {
    return {
      graduatedTotal: this.graduated,
      alreadyGraduatedTotal: this.alreadyGraduated,
      failedPersistentTotal: this.failedPersistent,
      transientRetriesTotal: this.transientRetries,
      sweepsTotal: this.sweeps,
      lastSweepAt: this.lastSweepAt,
      lastSweepScanned: this.lastSweepScanned,
      treasurySweepsTotal: this.treasurySweeps,
      treasuryFeesSweptTotal: this.treasuryFeesSwept,
      treasurySweepFailuresTotal: this.treasurySweepFailures,
      lastTreasurySweepAt: this.lastTreasurySweepAt,
      lastTreasurySweepScanned: this.lastTreasurySweepScanned,
      lpFeeCollectSweepsTotal: this.lpFeeCollectSweeps,
      lpFeesCollectedTotal: this.lpFeesCollected,
      lpFeeCollectFailuresTotal: this.lpFeeCollectFailures,
      lastLpFeeCollectSweepAt: this.lastLpFeeCollectSweepAt,
      lastLpFeeCollectSweepScanned: this.lastLpFeeCollectSweepScanned,
    };
  }
}
