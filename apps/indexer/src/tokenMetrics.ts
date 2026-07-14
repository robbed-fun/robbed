/**
 * `token_metrics` coalescer (D-70; indexer.md section 8) — the throttled, per-token
 * live-aggregate publisher on the global `GLOBAL_METRICS` channel.
 *
 * WHY THIS EXISTS: curve `Trade`/V3 `Swap`/`Graduated` handlers already publish
 * their raw per-event messages on the hot path (publish.ts, ZERO DB reads). But a
 * Discover card shows DERIVED aggregates — `mcapEth`, `progressPct`, `status`,
 * `change24hPct`, `volume24h` — and `change24hPct` needs a 24h-open ANCHOR
 * (the most-recent 1h candle at/before now−24h, or the first-trade price) that the
 * handler does NOT hold. Recomputing it per trade would hammer the anchor query, so
 * the raw per-event stream never carried it → a swap left the card's mcap/price
 * stale on the grid ("swap didn't update the discovery data"). This module closes
 * that gap with a COALESCED, throttled publish keyed per token.
 *
 * ── Design (decide-it-yourself; basis recorded) ──────────────────────────────
 * Two competing shapes for "≤1 per WS_METRICS_THROTTLE_MS per token, trailing-edge,
 * last-write-wins by blockNumber":
 *   (A) a per-token setTimeout armed on the token's first pending event, OR
 *   (B) a single fixed-interval tick that drains ALL pending tokens with ONE
 *       BATCHED anchor read.
 * We choose (B). It is the boring, can't-hammer option: the anchor read is bounded
 * to ≤1 batched query per WS_METRICS_THROTTLE_MS *total* (not per token), which is
 * the strongest reading of api.md section 5's "REUSE the SAME batched 24h-anchor read
 * the card projection uses — bounded by the throttle, not recomputed per trade".
 * Per-token last-write-wins coalescing (keep the highest-blockNumber sample) is
 * preserved in the pending map; the fixed tick just decides WHEN the batch flushes,
 * giving each token ≤1 publish per window with ≤throttleMs latency — the trailing
 * edge. Mirrors the existing periodic-derive jobs (volume_eth_24h decay, flow, pnl).
 *
 * ── Boundaries this module keeps ─────────────────────────────────────────────
 *  - NO DB import here. The batched read is an injected `MetricsCoalescerStore`
 *    (tokenMetricsStore.ts owns the pg pool); this file depends only on
 *    `@robbed/shared` + `./publish`, so a handler importing `enqueueTokenMetrics`
 *    pulls in no DB client on its path. The flush read runs on the sidecar's
 *    setInterval — OUTSIDE the Ponder handler hot path and OUTSIDE publish.ts's
 *    no-DB invariant (which still holds for the raw trade/candle publishes).
 *  - Backfill-suppressed: `enqueue` no-ops unless `publishGate.enabled` (the same
 *    realtime latch publishTrade/publishGraduated use), so historical sync never
 *    storms `GLOBAL_METRICS`.
 *  - Bounded memory: `enqueue` no-ops until `start()` arms the coalescer (a store is
 *    present), so with INDEXER_SIDECARS=off nothing accumulates. When armed, the
 *    pending map is bounded by the count of ACTIVE tokens (last-write-wins per
 *    token), not by event volume.
 *
 * ── Anti-drift flag (routed to robbed-shared / robbed-architect) ─────────────
 * `mcapEthWei` / `progressFraction` / `statusFrom` below MIRROR the API card
 * projection (`apps/api/src/projections/card.ts` `mcapEthWei` +
 * `apps/api/src/projections/common.ts` `progressFraction`/`statusFrom`/`ratio`) so
 * a live-patched card equals a REST refetch. That derivation now has ≥2 consumers
 * (API card + this indexer publish) and per the anti-drift rule SHOULD be hosted
 * once in `packages/shared`. packages/shared was frozen for D-70, so it is mirrored
 * here byte-for-byte with this flag; hosting it shared is a follow-up. `change24hPct`
 * IS already the one shared resolver (`computeChange24hPct`), so it can never drift.
 */
import {
  GLOBAL_METRICS,
  computeChange24hPct,
  type TokenStatus,
  type WsTokenMetricsData,
} from "@robbed/shared";
import { firePublish, publishGate, type RedisPublisher } from "./publish";

/** Trailing-edge throttle window (ms). Tunable via env in the sidecar wiring. */
export const WS_METRICS_THROTTLE_MS = 2000;

const WEI_PER_ETH = 1e18;
const WEI_PER_ETH_BIG = 10n ** 18n;

// ── Handler → coalescer sample (pure, no DB) ────────────────────────────────

/**
 * What a handler pushes per indexed trade / graduation: just the coalescing key +
 * ordering coordinate. Everything ELSE in the payload (price, reserves, volume,
 * anchor) is read fresh at flush time from the authoritative post-write token row,
 * so N trades in one window collapse to ONE row read + ONE publish.
 */
export interface TokenMetricsSample {
  token: string; // lowercased LaunchToken address (channel/coalesce key)
  blockNumber: number; // last-write-wins ordering key
  blockTimestamp: number; // unix seconds — envelope + data ts
}

// ── Flush-time inputs (read via the injected store) ─────────────────────────

/** One 1h anchor candle (subset the resolver reads) — mirrors shared AnchorCandle. */
export interface AnchorCandleRow {
  bucket_start: number;
  close: number;
}

/**
 * The token-row fields + 24h-anchor inputs the batched read returns per token.
 * `firstTradePrice` + `hourCandles` feed the SAME shared `computeChange24hPct`
 * the card projection uses.
 */
export interface MetricsInputRow {
  token: string;
  lastPriceEth: number | null;
  totalSupply: string; // wei
  realEthReserves: string; // wei
  graduationEth: string; // wei
  volumeEth24h: string; // wei
  graduated: boolean;
  createdAt: number; // unix seconds
  firstTradePrice: number | null;
  hourCandles: AnchorCandleRow[];
}

/** Batched read boundary (pg impl in tokenMetricsStore.ts; faked in tests). */
export interface MetricsCoalescerStore {
  readInputs(tokens: string[], nowSec: number): Promise<Map<string, MetricsInputRow>>;
}

// ── Pure projection (MIRRORS the API card projection — see anti-drift flag) ──

/** Ratio of two uint256 wei decimal strings as a float; 0 when denom is 0. */
function ratio(numer: string, denom: string): number {
  const d = BigInt(denom || "0");
  if (d === 0n) return 0;
  const n = BigInt(numer || "0");
  const scaled = (n * 1_000_000n) / d;
  return Number(scaled) / 1_000_000;
}

/** progress fraction real/grad in [0,1] (over-1 clamped) — card.ts parity. */
export function progressFraction(realEth: string, gradEth: string): number {
  const p = ratio(realEth, gradEth);
  return p > 1 ? 1 : p;
}

/** Derived venue/status pill — statusFrom parity (indexer.md section 3.2). */
export function statusFrom(graduated: boolean, realEthReserves: string, graduationEth: string): TokenStatus {
  if (graduated) return "graduated";
  if (BigInt(realEthReserves || "0") >= BigInt(graduationEth || "0")) return "graduating";
  return "curve";
}

/**
 * mcap in ETH as a wei decimal string — integer-space to avoid float loss on the
 * >2^53 wei product (card.ts `mcapEthWei` parity):
 *   mcapWei = round(price × 1e18) [wei/token] × totalSupply(wei) / 1e18.
 */
export function mcapEthWei(lastPriceEth: number | null, totalSupply: string): string {
  if (lastPriceEth == null) return "0";
  const pricePerTokenWei = BigInt(Math.round(lastPriceEth * WEI_PER_ETH));
  return ((pricePerTokenWei * BigInt(totalSupply || "0")) / WEI_PER_ETH_BIG).toString();
}

/**
 * Build the ETH-first `token_metrics` payload from a freshly-read token row + the
 * coalesced sample. `change24hPct` via the ONE shared resolver over the batched
 * anchor — identical to the card projection so live patch == REST refetch.
 */
export function buildTokenMetrics(
  row: MetricsInputRow,
  sample: TokenMetricsSample,
  nowSec: number,
): WsTokenMetricsData {
  return {
    token: row.token,
    priceEth: row.lastPriceEth,
    mcapEth: mcapEthWei(row.lastPriceEth, row.totalSupply),
    volume24h: row.volumeEth24h,
    change24hPct: computeChange24hPct({
      nowSec,
      lastPrice: row.lastPriceEth,
      firstTradePrice: row.firstTradePrice,
      createdAtSec: row.createdAt,
      hourCandles: row.hourCandles,
    }),
    progressPct: progressFraction(row.realEthReserves, row.graduationEth),
    status: statusFrom(row.graduated, row.realEthReserves, row.graduationEth),
    graduated: row.graduated,
    blockNumber: sample.blockNumber,
    ts: sample.blockTimestamp,
  };
}

// ── The coalescer ────────────────────────────────────────────────────────────

export interface MetricsCoalescerDeps {
  store: MetricsCoalescerStore;
  publisher: RedisPublisher;
}

export interface CoalescerHandle {
  stop(): void;
}

export class TokenMetricsCoalescer {
  private pending = new Map<string, TokenMetricsSample>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private store: MetricsCoalescerStore | null = null;
  private publisher: RedisPublisher | null = null;
  private throttleMs: number;

  constructor(
    throttleMs: number = WS_METRICS_THROTTLE_MS,
    private readonly now: () => number = () => Date.now(),
    /** Realtime latch — the same backfill suppression publishTrade uses. */
    private readonly gateEnabled: () => boolean = () => publishGate.enabled,
  ) {
    this.throttleMs = throttleMs;
  }

  /**
   * Handler seam — pure in-memory, no DB, safe on the hot path. No-ops until armed
   * (store present) so nothing accumulates with the sidecar off, and while the
   * publish gate is closed (historical backfill). Last-write-wins by blockNumber.
   */
  enqueue(sample: TokenMetricsSample): void {
    if (!this.store) return; // not armed → no unbounded growth (sidecars off)
    if (!this.gateEnabled()) return; // backfill suppression
    const prev = this.pending.get(sample.token);
    if (!prev || sample.blockNumber >= prev.blockNumber) this.pending.set(sample.token, sample);
  }

  /** Arm the coalescer + start the fixed-interval flush. Idempotent. */
  start(deps: MetricsCoalescerDeps, throttleMs?: number): CoalescerHandle {
    this.store = deps.store;
    this.publisher = deps.publisher;
    if (throttleMs != null && throttleMs > 0) this.throttleMs = throttleMs;
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), this.throttleMs);
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
    return { stop: () => this.stop() };
  }

  /**
   * Drain the pending batch → one batched anchor/row read → publish one
   * `token_metrics` per token on GLOBAL_METRICS. Never throws into the timer; a
   * failed read is self-healing (the next trade re-enqueues; REST is the source of
   * truth). Empty pending → no read (no idle DB hammering). Returns #published.
   */
  async flush(): Promise<number> {
    if (!this.store || !this.publisher) return 0;
    if (this.pending.size === 0) return 0;
    const batch = this.pending;
    this.pending = new Map();
    const nowSec = Math.floor(this.now() / 1000);
    let published = 0;
    try {
      const inputs = await this.store.readInputs([...batch.keys()], nowSec);
      for (const [token, sample] of batch) {
        const row = inputs.get(token);
        if (!row) continue; // token row not yet durable — next trade re-publishes
        const data = buildTokenMetrics(row, sample, nowSec);
        firePublish(this.publisher, "token_metrics", GLOBAL_METRICS, sample.blockTimestamp, data);
        published += 1;
      }
    } catch (err) {
      // Advisory freshness — drop + log; REST heals and the next trade re-triggers.
      console.error("[token_metrics] flush failed (advisory — indexing unaffected):", err);
    }
    return published;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ── test seams ─────────────────────────────────────────────────────────────
  /** Current pending count (coalescing assertions). */
  get pendingSize(): number {
    return this.pending.size;
  }
  /** Latest pending sample for a token (last-write-wins assertions). */
  peekPending(token: string): TokenMetricsSample | undefined {
    return this.pending.get(token);
  }
}

/** Process-wide singleton shared by handlers (enqueue) and the sidecar (start). */
export const tokenMetricsCoalescer = new TokenMetricsCoalescer();

/** Handler-facing enqueue (hot path, pure). */
export function enqueueTokenMetrics(sample: TokenMetricsSample): void {
  tokenMetricsCoalescer.enqueue(sample);
}

/** Sidecar-facing start (owns the pg store + publisher). */
export function startTokenMetricsCoalescer(
  deps: MetricsCoalescerDeps,
  throttleMs: number = WS_METRICS_THROTTLE_MS,
): CoalescerHandle {
  return tokenMetricsCoalescer.start(deps, throttleMs);
}
