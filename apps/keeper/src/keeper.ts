/**
 * GraduationKeeper — the pure orchestration core (no viem/pg/timer imports; all
 * effects arrive via injected ports). This is the unit-under-test.
 *
 * Guarantees (plan Phase 1 "Execution"):
 *  - IDEMPOTENT: an in-flight set keys one attempt per curve at a time (never
 *    two in-flight txs for one curve), and every attempt RE-READS on-chain
 *    `phase()` before sending — a DB hint or a stale event can never cause a tx
 *    against a curve that is already Graduated or still Trading.
 *  - "ALREADY GRADUATED BY SOMEONE ELSE" == SUCCESS: after any revert (send,
 *    receipt, or estimate) we re-read `phase()`; if it is now `graduated`, that
 *    is a win (the caller reward went to whoever landed first — expected under a
 *    permissionless graduate()), NOT a failure.
 *  - RETRY with backoff (default 3 attempts); a PERSISTENT revert (tx reverts
 * while phase stays `ready`) is the donation-brick signature (
 *    arb-back cannot restore the pool tick) → a distinct loud alert + a cooldown
 * so we do NOT hot-loop. A corrector may fix the tick, so the sweep
 *    retries after the cooldown, but never in a tight spin.
 *
 * Revert-classification rule (recorded):
 *   The AUTHORITATIVE disambiguator after any failure is the re-read `phase()`,
 *   never the error string — phase is on-chain truth. The injected
 *   `classifyError` only splits "the node executed a deterministic revert"
 *   (contract_revert → persistent when phase is still `ready`) from
 *   "RPC/network/nonce hiccup" (transient → retry) in the estimate/send-throw
 *   path where no receipt exists to inspect.
 */
import { gasWithBuffer } from "./gas";
import type {
  Address,
  AttemptResult,
  AttemptSource,
  ChainPort,
  DbPort,
  Hash,
  KeeperClock,
  KeeperLogger,
} from "./types";
import type { KeeperMetrics } from "./metrics";

export interface KeeperTuning {
  /** Total send attempts before declaring a persistent failure. Default 3. */
  maxAttempts: number;
  /** Absolute gas cap (wei of gas units). Default 30_000_000. */
  gasCap: bigint;
  /** Backoff base (ms); attempt n waits base * 2^(n-1). Default 500. */
  backoffBaseMs: number;
  /** After a persistent failure, skip this curve for this long. Default 300_000. */
  failedCooldownMs: number;
}

export const DEFAULT_TUNING: KeeperTuning = {
  maxAttempts: 3,
  gasCap: 30_000_000n,
  backoffBaseMs: 500,
  failedCooldownMs: 300_000,
};

export interface KeeperDeps {
  chain: ChainPort;
  db: DbPort;
  metrics: KeeperMetrics;
  log: KeeperLogger;
  clock: KeeperClock;
  tuning?: Partial<KeeperTuning>;
}

/** Internal per-attempt outcome (before mapping to the public AttemptResult). */
type Outcome =
  | { kind: "success"; txHash: Hash }
  | { kind: "already_graduated"; txHash?: Hash }
  | { kind: "not_ready" }
  | { kind: "phase_unavailable" }
  | { kind: "transient" }
  | { kind: "persistent" };

export class GraduationKeeper {
  private readonly chain: ChainPort;
  private readonly db: DbPort;
  private readonly metrics: KeeperMetrics;
  private readonly log: KeeperLogger;
  private readonly clock: KeeperClock;
  private readonly tuning: KeeperTuning;

  /** Curves with an attempt currently running — the double-send guard. */
  private readonly inFlight = new Set<string>();
  /** curve → epoch-ms until which persistent-failure cooldown suppresses retries. */
  private readonly cooldownUntil = new Map<string, number>();

  constructor(deps: KeeperDeps) {
    this.chain = deps.chain;
    this.db = deps.db;
    this.metrics = deps.metrics;
    this.log = deps.log;
    this.clock = deps.clock;
    this.tuning = { ...DEFAULT_TUNING, ...deps.tuning };
  }

  /** Live-detection entrypoint: a GraduationReady log for `curve`. */
  async onReady(curve: Address): Promise<AttemptResult> {
    return this.attempt(curve, "event");
  }

  /** Fallback sweep: DB hint set → attempt each (sequential; in-flight-skipped). */
  async sweep(): Promise<AttemptResult[]> {
    const ready = await this.db.findReadyCurves();
    this.metrics.recordSweep(this.clock.now(), ready.length);
    const results: AttemptResult[] = [];
    for (const { curve } of ready) {
      results.push(await this.attempt(curve, "sweep"));
    }
    return results;
  }

  /** Test/health introspection. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }
  get cooldownCount(): number {
    let n = 0;
    const now = this.clock.now();
    for (const until of this.cooldownUntil.values()) if (now < until) n += 1;
    return n;
  }

  private inCooldown(curve: string): boolean {
    const until = this.cooldownUntil.get(curve);
    return until !== undefined && this.clock.now() < until;
  }

  /** Dedup + cooldown gate around `run`. */
  private async attempt(curveRaw: Address, source: AttemptSource): Promise<AttemptResult> {
    const curve = curveRaw.toLowerCase() as Address;
    if (this.inFlight.has(curve)) {
      return { curve, status: "skipped_in_flight" };
    }
    if (this.inCooldown(curve)) {
      return { curve, status: "skipped_cooldown" };
    }
    this.inFlight.add(curve);
    try {
      return await this.run(curve, source);
    } finally {
      this.inFlight.delete(curve);
    }
  }

  private async run(curve: Address, source: AttemptSource): Promise<AttemptResult> {
    // Idempotent pre-check: never send unless the chain says ReadyToGraduate.
    const phase = await this.chain.readPhase(curve);
    if (phase === "graduated") {
      this.metrics.incAlreadyGraduated();
      return { curve, status: "already_graduated" };
    }
    if (phase === "trading") {
      // Stale DB row / stale event — benign. Sweep re-checks later.
      return { curve, status: "not_ready" };
    }
    if (phase === "unknown") {
      this.log.warn("phase_read_failed", { curve, source });
      return { curve, status: "phase_unavailable" };
    }

    for (let attempt = 1; attempt <= this.tuning.maxAttempts; attempt++) {
      const outcome = await this.tryGraduateOnce(curve);
      switch (outcome.kind) {
        case "success":
          this.metrics.incGraduated();
          this.log.info("graduated", { curve, source, txHash: outcome.txHash, attempt });
          return { curve, status: "graduated", txHash: outcome.txHash };
        case "already_graduated":
          this.metrics.incAlreadyGraduated();
          this.log.info("already_graduated_by_other", { curve, source, attempt });
          return { curve, status: "already_graduated", ...(outcome.txHash ? { txHash: outcome.txHash } : {}) };
        case "not_ready":
          return { curve, status: "not_ready" };
        case "phase_unavailable":
          return { curve, status: "phase_unavailable" };
        case "transient":
        case "persistent": {
          const last = attempt >= this.tuning.maxAttempts;
          this.metrics.incTransientRetry();
          this.log.warn("graduate_attempt_failed", { curve, source, attempt, kind: outcome.kind, willRetry: !last });
          if (!last) await this.clock.sleep(this.backoff(attempt));
          break;
        }
      }
    }

    // Exhausted: still ReadyToGraduate + tx keeps reverting → donation-brick.
    this.cooldownUntil.set(curve, this.clock.now() + this.tuning.failedCooldownMs);
    this.metrics.incFailedPersistent();
    // DISTINCT, loud alert — do NOT hot-loop (cooldown set above).
    this.log.error("graduation_failed_persistent", {
      curve,
      source,
      attempts: this.tuning.maxAttempts,
      alert: "donation_brick_suspected",
      hint: "graduate() reverts while phase stays ReadyToGraduate — pool tick likely outside arb-back tolerance; a corrector swap can restore it. Escalate per keeper runbook.",
    });
    return { curve, status: "failed_persistent" };
  }

  /** One estimate→send→receipt cycle; classifies the result. */
  private async tryGraduateOnce(curve: Address): Promise<Outcome> {
    // 1) Estimate (reverts here if the migrator cannot mint on current state).
    let gas: bigint;
    try {
      const estimate = await this.chain.estimateGraduateGas(curve);
      gas = gasWithBuffer(estimate, this.tuning.gasCap);
    } catch (err) {
      return this.classifyFailure(curve, err);
    }

    // 2) Send with the explicit doubled gas limit.
    let txHash: Hash;
    try {
      txHash = await this.chain.sendGraduate(curve, gas);
    } catch (err) {
      return this.classifyFailure(curve, err);
    }

    // 3) Await receipt. A fetch error is transient (the tx may still land — the
    //    next attempt/sweep reconciles via phase()).
    let receipt: { status: "success" | "reverted" };
    try {
      receipt = await this.chain.waitForReceipt(txHash);
    } catch {
      return { kind: "transient" };
    }
    if (receipt.status === "success") return { kind: "success", txHash };

    // Reverted on-chain → phase() is the arbiter.
    const phase = await this.chain.readPhase(curve);
    if (phase === "graduated") return { kind: "already_graduated", txHash };
    if (phase === "trading") return { kind: "not_ready" };
    if (phase === "unknown") return { kind: "transient" };
    return { kind: "persistent" }; // still ready but our tx reverted
  }

  /**
   * Map an estimate/send throw to an Outcome. Phase is authoritative:
   *  graduated → success (someone won); trading → benign not_ready; unknown →
   *  transient. Only when phase is STILL `ready` do we consult classifyError:
   *  a contract_revert is the persistent (donation-brick) path; anything else is
   *  a transient RPC/nonce hiccup worth retrying.
   */
  private async classifyFailure(curve: Address, err: unknown): Promise<Outcome> {
    const phase = await this.chain.readPhase(curve);
    if (phase === "graduated") return { kind: "already_graduated" };
    if (phase === "trading") return { kind: "not_ready" };
    if (phase === "unknown") return { kind: "transient" };
    return this.chain.classifyError(err) === "contract_revert" ? { kind: "persistent" } : { kind: "transient" };
  }

  private backoff(attempt: number): number {
    return this.tuning.backoffBaseMs * 2 ** (attempt - 1);
  }
}
