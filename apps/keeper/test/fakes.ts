/**
 * Test doubles for the pure keeper core — no live chain / DB / timers.
 */
import type {
  Address,
  ChainPort,
  DbPort,
  ErrorClass,
  Hash,
  KeeperClock,
  KeeperLogger,
  Phase,
  ReadyCurve,
  TreasuryFeeCurve,
} from "../src/types";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}
export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

type Scripted<T> = T | Error;

function take<T>(queue: Scripted<T>[], fallback: T): T {
  const next = queue.length > 0 ? queue.shift()! : fallback;
  if (next instanceof Error) throw next;
  return next;
}

export interface FakeChainOptions {
  phases?: Phase[]; // consumed per readPhase; last value repeats when exhausted
  estimates?: Scripted<bigint>[];
  sends?: Scripted<Hash>[];
  receipts?: Scripted<{ status: "success" | "reverted" }>[];
  treasuryFees?: Scripted<bigint | null>[];
  sweepEstimates?: Scripted<bigint>[];
  sweepSends?: Scripted<Hash>[];
  classify?: (err: unknown) => ErrorClass;
  balanceWei?: bigint;
  /** When set, estimateGraduateGas awaits this before returning (in-flight test). */
  gate?: Deferred<void>;
}

export class FakeChain implements ChainPort {
  phaseReads = 0;
  sendCount = 0;
  estimateCount = 0;
  treasuryFeeReads = 0;
  sweepSendCount = 0;
  sweepEstimateCount = 0;
  private lastPhase: Phase;
  private readonly phases: Phase[];
  private readonly estimates: Scripted<bigint>[];
  private readonly sends: Scripted<Hash>[];
  private readonly receipts: Scripted<{ status: "success" | "reverted" }>[];
  private readonly treasuryFees: Scripted<bigint | null>[];
  private readonly sweepEstimates: Scripted<bigint>[];
  private readonly sweepSends: Scripted<Hash>[];
  private readonly classifyFn: (err: unknown) => ErrorClass;
  private readonly balance: bigint;
  private readonly gate?: Deferred<void>;

  constructor(opts: FakeChainOptions = {}) {
    this.phases = [...(opts.phases ?? ["ready"])];
    this.lastPhase = this.phases[this.phases.length - 1] ?? "ready";
    this.estimates = [...(opts.estimates ?? [])];
    this.sends = [...(opts.sends ?? [])];
    this.receipts = [...(opts.receipts ?? [])];
    this.treasuryFees = [...(opts.treasuryFees ?? [])];
    this.sweepEstimates = [...(opts.sweepEstimates ?? [])];
    this.sweepSends = [...(opts.sweepSends ?? [])];
    this.classifyFn = opts.classify ?? (() => "transient");
    this.balance = opts.balanceWei ?? 1_000_000_000_000_000_000n;
    this.gate = opts.gate;
  }

  async readPhase(): Promise<Phase> {
    this.phaseReads += 1;
    if (this.phases.length > 0) {
      this.lastPhase = this.phases.shift()!;
    }
    return this.lastPhase;
  }

  async estimateGraduateGas(): Promise<bigint> {
    this.estimateCount += 1;
    if (this.gate) await this.gate.promise;
    return take(this.estimates, 500_000n);
  }

  async sendGraduate(): Promise<Hash> {
    this.sendCount += 1;
    return take(this.sends, "0xhash");
  }

  async readTreasuryFees(): Promise<bigint | null> {
    this.treasuryFeeReads += 1;
    return take(this.treasuryFees, 0n);
  }

  async estimateSweepFeesGas(): Promise<bigint> {
    this.sweepEstimateCount += 1;
    return take(this.sweepEstimates, 50_000n);
  }

  async sendSweepFees(): Promise<Hash> {
    this.sweepSendCount += 1;
    return take(this.sweepSends, "0xsweep");
  }

  async waitForReceipt(): Promise<{ status: "success" | "reverted" }> {
    return take(this.receipts, { status: "success" as const });
  }

  async getBalanceWei(): Promise<bigint> {
    return this.balance;
  }

  classifyError(err: unknown): ErrorClass {
    return this.classifyFn(err);
  }
}

export class FakeDb implements DbPort {
  calls = 0;
  treasuryCalls = 0;
  constructor(
    private readonly rows: ReadyCurve[] = [],
    private readonly treasuryRows: TreasuryFeeCurve[] = [],
  ) {}
  async findReadyCurves(): Promise<ReadyCurve[]> {
    this.calls += 1;
    return this.rows;
  }
  async findTreasuryFeeCurves(): Promise<TreasuryFeeCurve[]> {
    this.treasuryCalls += 1;
    return this.treasuryRows;
  }
}

export interface LogLine {
  level: "info" | "warn" | "error";
  event: string;
  fields?: Record<string, unknown>;
}
export class FakeLogger implements KeeperLogger {
  lines: LogLine[] = [];
  info(event: string, fields?: Record<string, unknown>) {
    this.lines.push({ level: "info", event, fields });
  }
  warn(event: string, fields?: Record<string, unknown>) {
    this.lines.push({ level: "warn", event, fields });
  }
  error(event: string, fields?: Record<string, unknown>) {
    this.lines.push({ level: "error", event, fields });
  }
  has(level: LogLine["level"], event: string): boolean {
    return this.lines.some((l) => l.level === level && l.event === event);
  }
}

export class FakeClock implements KeeperClock {
  sleeps: number[] = [];
  constructor(private t = 1_000_000) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
  async sleep(ms: number) {
    this.sleeps.push(ms);
  }
}

export const CURVE = "0xABCdef0000000000000000000000000000000001" as Address;
