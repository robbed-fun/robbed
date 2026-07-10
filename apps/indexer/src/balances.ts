/**
 * Holder-balance accounting (indexer.md §3.6, X-4/X-5; spec §12.16).
 *
 * The ERC-20 `Transfer` event is the SOLE source of balance truth: only the
 * Transfer handler writes `balances.balance` and `tokens.holder_count`. The
 * `Trade`/`Swap` handlers write ONLY the cost-basis columns (disjoint set), so
 * there is no double-count between the two — see `applyCostBasisBuy/Sell`.
 *
 * Pure engine (no DB): the `rebuild` script replays `transfers` in
 * `(block_number, log_index)` order through `BalanceLedger` to reconstruct
 * `balances` exactly, and the handler applies the same transition rules against
 * the DB (`holderCountDelta` is the shared load-bearing rule both call).
 *
 * The zero address is never tracked as a holder (mint source / standard burn
 * sink). A burn to a dead address (§12.13 graduation dust) IS a real holder;
 * the holder-distribution UI flags known addresses at query time (§3.6).
 */
import { ZERO_ADDRESS } from "./config";

export interface BalanceState {
  balance: bigint;
  totalBought: bigint;
  totalSold: bigint;
  ethIn: bigint;
  ethOut: bigint;
  firstSeenAt: number;
  lastActiveAt: number;
}

export function emptyBalanceState(ts: number): BalanceState {
  return {
    balance: 0n,
    totalBought: 0n,
    totalSold: 0n,
    ethIn: 0n,
    ethOut: 0n,
    firstSeenAt: ts,
    lastActiveAt: ts,
  };
}

/**
 * The one holder-count transition rule, shared by handler + rebuild:
 * +1 when a balance crosses 0 → positive, -1 when it crosses positive → 0.
 */
export function holderCountDelta(prevBalance: bigint, nextBalance: bigint): number {
  if (prevBalance <= 0n && nextBalance > 0n) return 1;
  if (prevBalance > 0n && nextBalance <= 0n) return -1;
  return 0;
}

export function isZeroAddress(addr: string): boolean {
  return addr.toLowerCase() === ZERO_ADDRESS;
}

/**
 * In-memory per-token balance ledger — drives the rebuild script and the
 * balance unit tests. Mirrors exactly what the Transfer + Trade/Swap handlers do
 * against Postgres.
 */
export class BalanceLedger {
  private readonly byToken = new Map<string, Map<string, BalanceState>>();
  private readonly holderCount = new Map<string, number>();

  private holders(token: string): Map<string, BalanceState> {
    let m = this.byToken.get(token);
    if (!m) {
      m = new Map();
      this.byToken.set(token, m);
    }
    return m;
  }

  private state(token: string, holder: string, ts: number): BalanceState {
    const m = this.holders(token);
    let s = m.get(holder);
    if (!s) {
      s = emptyBalanceState(ts);
      m.set(holder, s);
    }
    return s;
  }

  private bumpHolderCount(token: string, delta: number): void {
    if (delta === 0) return;
    this.holderCount.set(token, (this.holderCount.get(token) ?? 0) + delta);
  }

  /** Apply one Transfer: debit `from`, credit `to`; update holder counts. */
  applyTransfer(token: string, from: string, to: string, value: bigint, ts: number): void {
    if (!isZeroAddress(from)) {
      const s = this.state(token, from, ts);
      const prev = s.balance;
      s.balance = prev - value;
      s.lastActiveAt = ts;
      this.bumpHolderCount(token, holderCountDelta(prev, s.balance));
    }
    if (!isZeroAddress(to)) {
      const s = this.state(token, to, ts);
      const prev = s.balance;
      s.balance = prev + value;
      s.lastActiveAt = ts;
      this.bumpHolderCount(token, holderCountDelta(prev, s.balance));
    }
  }

  /** Cost-basis on a BUY (trader receives tokens for gross ETH). No balance write. */
  applyCostBasisBuy(token: string, trader: string, tokenAmount: bigint, ethGross: bigint, ts: number): void {
    if (isZeroAddress(trader)) return;
    const s = this.state(token, trader, ts);
    s.totalBought += tokenAmount;
    s.ethIn += ethGross;
    s.lastActiveAt = ts;
  }

  /** Cost-basis on a SELL (trader gives tokens for net ETH). No balance write. */
  applyCostBasisSell(token: string, trader: string, tokenAmount: bigint, ethNet: bigint, ts: number): void {
    if (isZeroAddress(trader)) return;
    const s = this.state(token, trader, ts);
    s.totalSold += tokenAmount;
    s.ethOut += ethNet;
    s.lastActiveAt = ts;
  }

  getState(token: string, holder: string): BalanceState | undefined {
    return this.byToken.get(token)?.get(holder);
  }

  getHolderCount(token: string): number {
    return this.holderCount.get(token) ?? 0;
  }

  /** All (token, holder, state) tuples — the rebuild script writes these back. */
  entries(): Array<{ token: string; holder: string; state: BalanceState }> {
    const out: Array<{ token: string; holder: string; state: BalanceState }> = [];
    for (const [token, m] of this.byToken) {
      for (const [holder, state] of m) out.push({ token, holder, state });
    }
    return out;
  }

  /** Tokens the ledger has seen (for per-token denorm recompute). */
  tokens(): string[] {
    return [...this.byToken.keys()];
  }

  /** Top holders by balance (top-20 query shape, §3.6). */
  topHolders(token: string, limit = 20): Array<{ holder: string; balance: bigint }> {
    const m = this.byToken.get(token);
    if (!m) return [];
    return [...m.entries()]
      .filter(([, s]) => s.balance > 0n)
      .map(([holder, s]) => ({ holder, balance: s.balance }))
      .sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0))
      .slice(0, limit);
  }
}
