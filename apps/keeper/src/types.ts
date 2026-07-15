/**
 * Keeper port interfaces + shared value types.
 *
 * DELIBERATELY dependency-free (no viem / pg / @robbed/shared imports) so the
 * pure orchestration core (`keeper.ts`) and its unit tests never pull a live
 * client into scope. The viem-backed `chain.ts` and pg-backed `db.pg.ts`
 * implement these ports; tests inject fakes.
 *
 * `Hex`/`Address`/`Hash` are structurally identical to viem's branded
 * `` `0x${string}` `` types, so the runtime adapters assign cleanly without an
 * import here.
 */

export type Hex = `0x${string}`;
export type Address = Hex;
export type Hash = Hex;

/**
 * BondingCurve lifecycle (contracts/src/interfaces/IBondingCurve.sol `Phase`):
 * on-chain `uint8` — Trading=0, ReadyToGraduate=1, Graduated=2. `unknown` is a
 * keeper-local sentinel for "the phase read failed" (RPC down) — it is NEVER an
 * on-chain value, so the loop treats it as retry-later, never as terminal.
 */
export type Phase = "trading" | "ready" | "graduated" | "unknown";

/**
 * How a caught chain error is shaped. `contract_revert` = the node returned a
 * deterministic execution revert (the tx/estimate would revert again on the
 * same state → a candidate donation-brick, arb-back failure).
 * `transient` = RPC/network/nonce/timeout — safe to retry.
 */
export type ErrorClass = "contract_revert" | "transient";

/** The chain surface the keeper needs — curve graduation + permissionless fee calls. */
export interface ChainPort {
  /** Read `BondingCurve.phase()`; never throws (maps RPC failure → 'unknown'). */
  readPhase(curve: Address): Promise<Phase>;
  /** `estimateContractGas(graduate)`; THROWS on revert (caller disambiguates). */
  estimateGraduateGas(curve: Address): Promise<bigint>;
  /** Send `graduate()` with an explicit gas limit; returns the tx hash. */
  sendGraduate(curve: Address, gas: bigint): Promise<Hash>;
  /** Read unswept treasury ETH-leg fees; never throws (maps RPC failure → null). */
  readTreasuryFees(curve: Address): Promise<bigint | null>;
  /** `estimateContractGas(sweepFees)`; THROWS on revert. */
  estimateSweepFeesGas(curve: Address): Promise<bigint>;
  /** Send permissionless `sweepFees()` with an explicit gas limit; returns tx hash. */
  sendSweepFees(curve: Address, gas: bigint): Promise<Hash>;
  /** Simulate `LPFeeVault.collect(tokenId)`; never throws (maps RPC/simulation failure → null). */
  simulateCollectLpFees(
    vault: Address,
    tokenId: bigint,
  ): Promise<{ amount0: bigint; amount1: bigint } | null>;
  /** `estimateContractGas(LPFeeVault.collect)`; THROWS on revert. */
  estimateCollectLpFeesGas(vault: Address, tokenId: bigint): Promise<bigint>;
  /** Send permissionless `LPFeeVault.collect(tokenId)` with an explicit gas limit; returns tx hash. */
  sendCollectLpFees(vault: Address, tokenId: bigint, gas: bigint): Promise<Hash>;
  /** Wait for the receipt; `reverted` is a normal (non-throwing) outcome. */
  waitForReceipt(hash: Hash): Promise<{ status: "success" | "reverted" }>;
  /** Keeper wallet balance (wei) — for the balance-watch alert + healthz. */
  getBalanceWei(): Promise<bigint>;
  /** Classify a caught error (viem BaseError.walk in the real adapter). */
  classifyError(err: unknown): ErrorClass;
}

/** One `{ token, curve }` row from the fallback sweep (addresses lowercased). */
export interface ReadyCurve {
  token: Address;
  curve: Address;
}

/** One fee-bearing curve row for the treasury fee sweeper. */
export interface TreasuryFeeCurve {
  token: Address;
  curve: Address;
}

/** One graduated LP position whose fees can be permissionlessly collected. */
export interface GraduatedLpPosition {
  token: Address;
  pool: Address;
  lpTokenId: bigint;
  /** true when the launch token is token0, so the WETH leg is amount1. */
  tokenIsToken0: boolean;
}

/** The DB surface the fallback sweeps need. */
export interface DbPort {
  /** Tokens crossed to ReadyToGraduate but not yet Graduated (see db.ts SQL). */
  findReadyCurves(): Promise<ReadyCurve[]>;
  /** Curves that can accrue treasury ETH-leg fees (see db.ts SQL). */
  findTreasuryFeeCurves(): Promise<TreasuryFeeCurve[]>;
  /** Graduated LP positions whose V3 fees can be split by LPFeeVault.collect(). */
  findGraduatedLpPositions(): Promise<GraduatedLpPosition[]>;
}

/** Injected clock — deterministic in tests (no real timers/sleep). */
export interface KeeperClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** Structured logger surface (index.ts wires the JSON logger; tests capture). */
export interface KeeperLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/** Terminal status of a single graduation attempt. */
export type AttemptStatus =
  | "graduated" // we mined a successful graduate()
  | "already_graduated" // someone (or an earlier tx) graduated it first → SUCCESS
  | "not_ready" // phase is Trading (stale DB row / signal) → benign skip
  | "phase_unavailable" // RPC could not read phase → retry next sweep
  | "skipped_in_flight" // another attempt for this curve is running
  | "skipped_cooldown" // persistent-revert cooldown active (no hot-loop)
  | "failed_persistent"; // exhausted retries, still ReadyToGraduate → donation-brick alert

export interface AttemptResult {
  curve: Address;
  status: AttemptStatus;
  txHash?: Hash;
}

/** Why an attempt was triggered — for logs/metrics only. */
export type AttemptSource = "event" | "sweep";

/** Terminal status of a single treasury fee sweep decision. */
export type TreasurySweepStatus =
  "swept" | "no_fees" | "below_threshold" | "fee_read_unavailable" | "skipped_in_flight" | "failed";

export interface TreasurySweepResult {
  curve: Address;
  token?: Address;
  status: TreasurySweepStatus;
  amountWei?: bigint;
  txHash?: Hash;
}

/** Terminal status of a single LP fee collect decision. */
export type LpFeeCollectStatus =
  | "collected"
  | "no_fees"
  | "below_threshold"
  | "fee_read_unavailable"
  | "skipped_in_flight"
  | "failed";

export interface LpFeeCollectResult {
  token: Address;
  pool: Address;
  lpTokenId: bigint;
  status: LpFeeCollectStatus;
  amount0?: bigint;
  amount1?: bigint;
  wethAmount?: bigint;
  txHash?: Hash;
}
