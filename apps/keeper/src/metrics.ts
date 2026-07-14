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
}

export class KeeperMetrics {
  private graduated = 0;
  private alreadyGraduated = 0;
  private failedPersistent = 0;
  private transientRetries = 0;
  private sweeps = 0;
  private lastSweepAt: number | null = null;
  private lastSweepScanned: number | null = null;

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

  snapshot(): MetricsSnapshot {
    return {
      graduatedTotal: this.graduated,
      alreadyGraduatedTotal: this.alreadyGraduated,
      failedPersistentTotal: this.failedPersistent,
      transientRetriesTotal: this.transientRetries,
      sweepsTotal: this.sweeps,
      lastSweepAt: this.lastSweepAt,
      lastSweepScanned: this.lastSweepScanned,
    };
  }
}
