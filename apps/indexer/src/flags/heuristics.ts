/**
 * Bot/farm detection — PURE heuristics (indexer.md, v1.2; M2-13).
 *
 * This module is DB-free and fully unit-testable: it is the single source of the
 * heuristic math. `src/flags/store.ts` runs the SQL views (`views.sql`) to
 * gather the aggregates below, calls `runFlowAnalysis`, and upserts the results
 * into `address_flags` + `token_flow_stats`. The whole pipeline is rebuildable
 * from `trades` + `transfers` (indexer.md).
 *
 * STRICTLY ADVISORY — labeling only. Nothing here (or downstream) gates a trade,
 * a listing, or any chain interaction. Outputs are always presented
 * as estimates / RANGES (forbids false precision).
 *
 * The `BotFlag` vocabulary is imported from `@robbed/shared` (`address_flags.
 * flags[]` and the wire both use it — never redeclared here).
 *
 * Decide-it-yourself decisions (basis recorded inline):
 *  - **Thresholds are config, not literals** (indexer.md decide-it-yourself
 * "Bot-heuristic thresholds"). Defaults are the v1 values; every one
 *    is overridable via env (`loadFlowThresholds`) so they tune with M2 data
 *    without a code change. Never gates chain state.
 * - **Organic-holder % is a RANGE**. `low` counts EVERY flag as
 *    non-organic (most conservative → fewest organic holders); `high` counts only
 *    the strongest flags (`farm`, `wash`) as non-organic (sniper/programmatic/
 *    arb_exit may still be organic-ish). `low <= high` by construction. The band
 *    encodes heuristic uncertainty instead of a false point value.
 *  - **Wash volume is excluded from organic volume** by flagging the washing
 *    address `wash`; the organic-volume numerator only sums UNFLAGGED addresses,
 * so wash-flagged volume drops out automatically (heuristic 4).
 *  - **Own contracts are never `programmatic`** — the executor whitelist (our
 *    Router/factory/migrator/NPM/swapRouter) legitimately mediates trades, so a
 * trade routed through them is not flagged (heuristic 3).
 */
import type { BotFlag } from "@robbed/shared";

const DAY_SECONDS = 86_400;

// ── Tunable thresholds (v1 defaults; env-overridable) ──────────────

export interface FlowThresholds {
  /** Funder fan-out: a funder of ≥ this many micro-funded wallets/24h → cluster. */
  funderMinWallets: number;
  /** Micro-transfer ceiling (wei) — a first inbound below this is "funding". */
  microTransferWei: bigint;
  /** Sniper: first buy strictly within this many seconds of `TokenCreated`. */
  sniperWindowSec: number;
  /** Sniper: AND funded strictly within this many seconds before that first buy. */
  sniperFundedWithinSec: number;
  /** Same-second multi-pool exit: WETH out of ≥ this many pools in one block. */
  multiPoolExitMin: number;
  /**
   * Wash-loop: a round-trip nets ≈ fees when `|buyEth − sellEth| <=
   * washFeeTolerance × fee`. 1.0 = "within one fee"; slightly loosened default
   * absorbs rounding across multiple legs. Tunable.
   */
  washFeeTolerance: number;
}

/** v1 defaults. 0.001 ETH = 1e15 wei. */
export const DEFAULT_FLOW_THRESHOLDS: FlowThresholds = {
  funderMinWallets: 20,
  microTransferWei: 1_000_000_000_000_000n, // 0.001 ETH
  sniperWindowSec: 60,
  sniperFundedWithinSec: 3_600,
  multiPoolExitMin: 3,
  washFeeTolerance: 1.5,
};

function envInt(env: Record<string, string | undefined>, name: string, dflt: number): number {
  const v = env[name];
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`[flow] ${name} must be a non-negative number, got: ${v}`);
  return n;
}

function envBigint(env: Record<string, string | undefined>, name: string, dflt: bigint): bigint {
  const v = env[name];
  if (v === undefined || v === "") return dflt;
  try {
    const n = BigInt(v);
    if (n < 0n) throw new Error("negative");
    return n;
  } catch {
    throw new Error(`[flow] ${name} must be a non-negative integer (wei), got: ${v}`);
  }
}

/** Load thresholds from env with the defaults (config, not literals). */
export function loadFlowThresholds(env: Record<string, string | undefined> = process.env): FlowThresholds {
  return {
    funderMinWallets: envInt(env, "FLOW_FUNDER_MIN_WALLETS", DEFAULT_FLOW_THRESHOLDS.funderMinWallets),
    microTransferWei: envBigint(env, "FLOW_MICRO_TRANSFER_WEI", DEFAULT_FLOW_THRESHOLDS.microTransferWei),
    sniperWindowSec: envInt(env, "FLOW_SNIPER_WINDOW_SEC", DEFAULT_FLOW_THRESHOLDS.sniperWindowSec),
    sniperFundedWithinSec: envInt(env, "FLOW_SNIPER_FUNDED_WITHIN_SEC", DEFAULT_FLOW_THRESHOLDS.sniperFundedWithinSec),
    multiPoolExitMin: envInt(env, "FLOW_MULTIPOOL_EXIT_MIN", DEFAULT_FLOW_THRESHOLDS.multiPoolExitMin),
    washFeeTolerance: envInt(env, "FLOW_WASH_FEE_TOLERANCE", DEFAULT_FLOW_THRESHOLDS.washFeeTolerance),
  };
}

// ── Aggregate input rows (produced by views.sql over trades + transfers) ─────

/** First inbound transfer per address (funder clustering + sniper funding time). */
export interface FirstInboundRow {
  address: string;
  funder: string;
  valueWei: bigint;
  fundedAtSec: number;
}

/** First buy per (token, trader), with the token's creation timestamp (sniper). */
export interface FirstBuyRow {
  token: string;
  trader: string;
  firstBuyAtSec: number;
  tokenCreatedAtSec: number;
}

/**
 * A representative executor≠recipient observation for an address on a token
 * (contract-mediated execution). `executor` = the trade's `trader` (msg.sender);
 * `recipient` = the token recipient in the same tx (from `transfers`). Own
 * contracts are filtered out via the whitelist, never flagged.
 */
export interface ProgrammaticRow {
  address: string;
  executor: string;
  recipient: string;
}

/** Same-second multi-pool WETH exit: pools paying an address in one block. */
export interface MultiPoolExitRow {
  address: string;
  block: number;
  poolCount: number;
}

/** Per (token, address) curve buy/sell/fee totals — wash + organic-volume. */
export interface TradeAggRow {
  token: string;
  address: string;
  buyEthWei: bigint;
  sellEthWei: bigint;
  feeWei: bigint;
}

/** Per (token, address) trailing-24h curve volume — funder-cluster vol share. */
export interface ClusterVol24hRow {
  token: string;
  address: string;
  vol24hWei: bigint;
}

/** Current positive holders of a token (from `balances`) — organic-holder %. */
export interface HolderRow {
  token: string;
  holder: string;
}

export interface FlowInput {
  firstInbound: FirstInboundRow[];
  firstBuys: FirstBuyRow[];
  programmatic: ProgrammaticRow[];
  multiPoolExits: MultiPoolExitRow[];
  tradeAggs: TradeAggRow[];
  clusterVol24h: ClusterVol24hRow[];
  holders: HolderRow[];
}

// ── Per-heuristic pure classifiers ──────────────────────────────────────────

/**
 * Heuristic 1 — funder clustering. Group wallets whose FIRST inbound is
 * a micro-transfer (< `microTransferWei`) by their funder within a rolling 24h
 * window; a funder that seeded ≥ `funderMinWallets` distinct wallets in any such
 * window marks all of them `farm`, `cluster_id = funder:{addr}`. Returns the
 * per-address cluster assignment (address → clusterId).
 */
export function classifyFunderClusters(
  firstInbound: FirstInboundRow[],
  thresholds: FlowThresholds,
): Map<string, string> {
  // Group micro-funded wallets by funder.
  const byFunder = new Map<string, FirstInboundRow[]>();
  for (const row of firstInbound) {
    if (row.valueWei >= thresholds.microTransferWei) continue; // not a micro-transfer
    const funder = row.funder.toLowerCase();
    const arr = byFunder.get(funder) ?? [];
    arr.push(row);
    byFunder.set(funder, arr);
  }

  const assignment = new Map<string, string>();
  for (const [funder, wallets] of byFunder) {
    // A funder qualifies if ANY 24h window contains ≥ N distinct funded wallets.
    // Sliding window over funding times (sorted); dedupe wallets per window.
    const sorted = [...wallets].sort((a, b) => a.fundedAtSec - b.fundedAtSec);
    let qualifies = false;
    for (let i = 0; i < sorted.length && !qualifies; i++) {
      const windowEnd = sorted[i]!.fundedAtSec + DAY_SECONDS;
      const inWindow = new Set<string>();
      for (let j = i; j < sorted.length && sorted[j]!.fundedAtSec < windowEnd; j++) {
        inWindow.add(sorted[j]!.address.toLowerCase());
      }
      if (inWindow.size >= thresholds.funderMinWallets) qualifies = true;
    }
    if (!qualifies) continue;
    const clusterId = `funder:${funder}`;
    for (const w of wallets) assignment.set(w.address.toLowerCase(), clusterId);
  }
  return assignment;
}

/**
 * Heuristic 2 — wallet age vs. action. First buy strictly < `sniperWindowSec`
 * after `TokenCreated` AND funded strictly < `sniperFundedWithinSec` before that
 * buy. `fundedAtSec` is `null` when the wallet has no prior inbound (cannot be a
 * funded sniper).
 */
export function isSniper(
  firstBuyAtSec: number,
  tokenCreatedAtSec: number,
  fundedAtSec: number | null,
  thresholds: FlowThresholds,
): boolean {
  const sinceCreate = firstBuyAtSec - tokenCreatedAtSec;
  if (!(sinceCreate >= 0 && sinceCreate < thresholds.sniperWindowSec)) return false;
  if (fundedAtSec === null) return false;
  const fundedBefore = firstBuyAtSec - fundedAtSec;
  return fundedBefore >= 0 && fundedBefore < thresholds.sniperFundedWithinSec;
}

/**
 * Heuristic 3 — contract-mediated execution. Flag when the executor
 * differs from the token recipient, UNLESS the executor is one of OUR contracts
 * (Router/factory/migrator/NPM/swapRouter) — those legitimately mediate and are
 * NEVER flagged. `whitelist` holds lowercased own-contract addresses.
 */
export function isProgrammatic(executor: string, recipient: string, whitelist: ReadonlySet<string>): boolean {
  const ex = executor.toLowerCase();
  if (whitelist.has(ex)) return false; // own Router/contracts — never flagged
  return ex !== recipient.toLowerCase();
}

/**
 * Heuristic 4 — wash-loop. A round-trip buy→sell of similar size netting
 * ≈ fees: the address bought AND sold, both legs non-zero, and the ETH delta is
 * within `washFeeTolerance × fee`. Wash volume is later excluded from organic
 * volume (the address carries the `wash` flag).
 */
export function isWash(agg: Pick<TradeAggRow, "buyEthWei" | "sellEthWei" | "feeWei">, thresholds: FlowThresholds): boolean {
  if (agg.buyEthWei <= 0n || agg.sellEthWei <= 0n) return false;
  const delta = agg.buyEthWei > agg.sellEthWei ? agg.buyEthWei - agg.sellEthWei : agg.sellEthWei - agg.buyEthWei;
  // tolerance × fee, integer-safe (tolerance may be fractional → scale by 1000).
  const scaled = (agg.feeWei * BigInt(Math.round(thresholds.washFeeTolerance * 1000))) / 1000n;
  return delta <= scaled;
}

/** Heuristic 5 — same-second multi-pool exit : ≥ N pools in one block. */
export function isArbExit(poolCount: number, thresholds: FlowThresholds): boolean {
  return poolCount >= thresholds.multiPoolExitMin;
}

// ── Assembly ────────────────────────────────────────────────────────────────

/** Flags the strongest heuristics treat as definitely non-organic (holder-% `high`). */
const STRONG_FLAGS: ReadonlySet<BotFlag> = new Set<BotFlag>(["farm", "wash"]);

export interface AddressFlagResult {
  address: string;
  flags: BotFlag[];
  clusterId: string | null;
}

export interface TokenFlowStatResult {
  token: string;
  organicHolderPctLow: number;
  organicHolderPctHigh: number;
  organicVolumePct: number;
  flaggedClusterVolPct24h: number;
}

export interface FlowResult {
  addressFlags: AddressFlagResult[];
  tokenStats: TokenFlowStatResult[];
}

/**
 * Run every heuristic over the gathered aggregates and produce the
 * `address_flags` + `token_flow_stats` rows. Pure and deterministic (flags and
 * tokens are emitted in a stable, sorted order) so `rebuild` output is byte-equal
 * to the incremental output. `whitelist` = our own contracts (never flagged
 * `programmatic`).
 */
export function runFlowAnalysis(
  input: FlowInput,
  thresholds: FlowThresholds,
  whitelist: ReadonlySet<string>,
): FlowResult {
  const flags = new Map<string, Set<BotFlag>>();
  const clusters = new Map<string, string>();
  const add = (address: string, flag: BotFlag) => {
    const a = address.toLowerCase();
    const s = flags.get(a) ?? new Set<BotFlag>();
    s.add(flag);
    flags.set(a, s);
  };

  // 1. Funder clustering → farm + cluster_id.
  const clusterAssignment = classifyFunderClusters(input.firstInbound, thresholds);
  for (const [address, clusterId] of clusterAssignment) {
    add(address, "farm");
    clusters.set(address, clusterId);
  }

  // 2. Sniper (funding time from firstInbound).
  const fundedAt = new Map<string, number>();
  for (const fi of input.firstInbound) fundedAt.set(fi.address.toLowerCase(), fi.fundedAtSec);
  for (const fb of input.firstBuys) {
    const funded = fundedAt.has(fb.trader.toLowerCase()) ? fundedAt.get(fb.trader.toLowerCase())! : null;
    if (isSniper(fb.firstBuyAtSec, fb.tokenCreatedAtSec, funded, thresholds)) add(fb.trader, "sniper");
  }

  // 3. Contract-mediated execution (own contracts whitelisted).
  for (const p of input.programmatic) {
    if (isProgrammatic(p.executor, p.recipient, whitelist)) add(p.address, "programmatic");
  }

  // 4. Wash-loop.
  for (const agg of input.tradeAggs) {
    if (isWash(agg, thresholds)) add(agg.address, "wash");
  }

  // 5. Same-second multi-pool exits.
  for (const ex of input.multiPoolExits) {
    if (isArbExit(ex.poolCount, thresholds)) add(ex.address, "arb_exit");
  }

  const flagOrder: BotFlag[] = ["farm", "sniper", "programmatic", "wash", "arb_exit"];
  const addressFlags: AddressFlagResult[] = [...flags.entries()]
    .map(([address, set]) => ({
      address,
      flags: flagOrder.filter((f) => set.has(f)),
      clusterId: clusters.get(address) ?? null,
    }))
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));

  const anyFlag = (address: string): boolean => (flags.get(address.toLowerCase())?.size ?? 0) > 0;
  const strongFlag = (address: string): boolean => {
    const s = flags.get(address.toLowerCase());
    if (!s) return false;
    for (const f of s) if (STRONG_FLAGS.has(f)) return true;
    return false;
  };

  const tokenStats = computeTokenStats(input, anyFlag, strongFlag, clusters);
  return { addressFlags, tokenStats };
}

function pct(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 100; // no volume/holders yet → treat as fully organic
  return Number((part * 1_000_000n) / whole) / 10_000; // 4-dp percentage
}

/**
 * Platform-wide funder-cluster vol share (%) — the largest single funder
 * cluster's share of PLATFORM-WIDE trailing-24h curve volume (gate-7 Y%,
 * amend). Distinct from the per-token `flaggedClusterVolPct24h` (gate-7 X%);
 * computed here because only the full `FlowResult` + input span every token.
 */
export function computePlatformClusterShare(input: FlowInput, result: FlowResult): number {
  const cluster = new Map<string, string>();
  for (const af of result.addressFlags) if (af.clusterId) cluster.set(af.address.toLowerCase(), af.clusterId);
  let total = 0n;
  const byCluster = new Map<string, bigint>();
  for (const c of input.clusterVol24h) {
    total += c.vol24hWei;
    const cid = cluster.get(c.address.toLowerCase());
    if (cid) byCluster.set(cid, (byCluster.get(cid) ?? 0n) + c.vol24hWei);
  }
  let max = 0n;
  for (const v of byCluster.values()) if (v > max) max = v;
  if (total <= 0n) return 0;
  return Number((max * 1_000_000n) / total) / 10_000;
}

/** Largest per-token funder-cluster share across all tokens (gate-7 X%, token_max scope). */
export function maxTokenClusterShare(result: FlowResult): number {
  let max = 0;
  for (const t of result.tokenStats) if (t.flaggedClusterVolPct24h > max) max = t.flaggedClusterVolPct24h;
  return max;
}

function computeTokenStats(
  input: FlowInput,
  anyFlag: (a: string) => boolean,
  strongFlag: (a: string) => boolean,
  clusters: Map<string, string>,
): TokenFlowStatResult[] {
  const tokens = new Set<string>();
  for (const r of input.tradeAggs) tokens.add(r.token.toLowerCase());
  for (const h of input.holders) tokens.add(h.token.toLowerCase());
  for (const c of input.clusterVol24h) tokens.add(c.token.toLowerCase());

  const out: TokenFlowStatResult[] = [];
  for (const token of [...tokens].sort()) {
    // Organic volume: unflagged share of total curve volume (buy+sell ETH).
    let totalVol = 0n;
    let organicVol = 0n;
    for (const agg of input.tradeAggs) {
      if (agg.token.toLowerCase() !== token) continue;
      const vol = agg.buyEthWei + agg.sellEthWei;
      totalVol += vol;
      if (!anyFlag(agg.address)) organicVol += vol; // wash-flagged → excluded
    }

    // Organic holders: RANGE (low = exclude any flag; high = exclude strong only).
    let totalHolders = 0;
    let organicLow = 0;
    let organicHigh = 0;
    for (const h of input.holders) {
      if (h.token.toLowerCase() !== token) continue;
      totalHolders += 1;
      if (!anyFlag(h.holder)) organicLow += 1;
      if (!strongFlag(h.holder)) organicHigh += 1;
    }

    // Flagged-cluster 24h volume share (feeds gate-7). Largest funder cluster's
    // share of the token's trailing-24h curve volume.
    let total24h = 0n;
    const clusterVol = new Map<string, bigint>();
    for (const c of input.clusterVol24h) {
      if (c.token.toLowerCase() !== token) continue;
      total24h += c.vol24hWei;
      const cid = clusters.get(c.address.toLowerCase());
      if (cid) clusterVol.set(cid, (clusterVol.get(cid) ?? 0n) + c.vol24hWei);
    }
    let maxCluster = 0n;
    for (const v of clusterVol.values()) if (v > maxCluster) maxCluster = v;

    out.push({
      token,
      organicHolderPctLow: totalHolders > 0 ? (organicLow / totalHolders) * 100 : 100,
      organicHolderPctHigh: totalHolders > 0 ? (organicHigh / totalHolders) * 100 : 100,
      organicVolumePct: pct(organicVol, totalVol),
      flaggedClusterVolPct24h: pct(maxCluster, total24h),
    });
  }
  return out;
}
