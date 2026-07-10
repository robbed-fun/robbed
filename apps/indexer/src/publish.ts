/**
 * Redis publish path (indexer.md §7.2, §8.2/§8.3; M2-8) — the ONLY hop between a
 * Ponder handler and the Bun WS fanout.
 *
 * Hard constraints this module enforces (spec §8, <500ms budget):
 *  - ZERO database / RPC reads here. Every message is built entirely from values
 *    the handler already holds; the structural `no-DB-import` test asserts this
 *    module imports no DB client (`ponder:schema`/`ponder:registry`/`pg`/…).
 *  - Fire-and-forget: a lost publish is self-healing (clients REST-heal on a
 *    `seq` gap, §8.4) — we log and move on, never block or throw into a handler.
 *  - Per-channel monotonic `seq` via a single Redis `INCR channel:seq` (§8.2) —
 *    one Redis op, no DB.
 *  - Publishes are SUPPRESSED during historical backfill (§9.3) — see
 *    `PublishGate`.
 *
 * Decide-it-yourself — backfill suppression mechanism (basis recorded here):
 *   Ponder (verified against 0.16.6 docs, 2026-07-10) exposes NO per-event
 *   "realtime vs historical" flag on the handler context. The boring, correct
 *   substitute is a wall-clock recency LATCH: an event whose block timestamp is
 *   within `REALTIME_WINDOW_SEC` of now means the sync has caught up to head, so
 *   we flip to realtime and STAY there (monotonic — backfill blocks are old by
 *   definition, so they can never re-arm the latch). Worst case is a handful of
 *   boundary events at the backfill→realtime seam being suppressed (harmless —
 *   REST heals) or a few slightly-late realtime events published (harmless).
 *   No false publish-storm to Redis is possible. Fully unit-tested.
 *
 * Transport note (flagged in report): the concrete publisher uses Bun's native
 * `RedisClient` (as the API does) when `globalThis.Bun` is present. Under a
 * pure-Node Ponder container it degrades to a logged no-op (publishes dropped,
 * clients REST-heal) — the indexer's runtime must therefore run these
 * side-processes under Bun, OR add a Node redis client. This is an infra
 * decision surfaced for hoodpad-architect, not silently worked around.
 */
import {
  GLOBAL_CONFIRMATIONS,
  GLOBAL_LAUNCHES,
  GLOBAL_TRADES,
  channelSeqKey,
  tokenCandles,
  tokenEvents,
  tokenTrades,
  type CandleInterval,
  type ConfirmationState,
  type Venue,
  type WsCandleData,
  type WsConfirmationsData,
  type WsFeeCollectedData,
  type WsGraduatedData,
  type WsLaunchData,
  type WsMetadataVerifiedData,
  type WsMessageType,
  type WsReorgData,
  type WsTradeData,
} from "@robbed/shared";

/** Wall-clock window (seconds) within which an event is considered realtime. */
export const REALTIME_WINDOW_SEC = 120;

// ── Transport boundary ──────────────────────────────────────────────────────

/**
 * Minimal Redis publisher — the ONLY external dependency of the hot path.
 * Injected in tests (fake), Bun-native at runtime. `incr` returns the new
 * per-channel sequence; `publish` fans the message to Redis subscribers.
 */
export interface RedisPublisher {
  incr(key: string): Promise<number>;
  publish(channel: string, message: string): Promise<void>;
}

interface BunRedisClientLike {
  send(command: string, args: string[]): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
}

/** No-op publisher (transport unavailable) — drops messages, logs once. */
function createNoopPublisher(reason: string): RedisPublisher {
  let warned = false;
  const warn = () => {
    if (warned) return;
    warned = true;
    console.warn(`[indexer publish] Redis transport unavailable (${reason}) — WS publishes dropped; clients REST-heal.`);
  };
  return {
    async incr() {
      warn();
      return 0;
    },
    async publish() {
      warn();
    },
  };
}

/** Bun-native publisher (used when `globalThis.Bun.RedisClient` exists). */
export function createBunPublisher(url: string): RedisPublisher {
  const Bun = (globalThis as unknown as { Bun?: { RedisClient?: new (u: string) => BunRedisClientLike } }).Bun;
  if (!Bun?.RedisClient) return createNoopPublisher("no Bun.RedisClient");
  const client = new Bun.RedisClient(url);
  return {
    async incr(key) {
      const res = await client.send("INCR", [key]);
      return typeof res === "number" ? res : Number(res);
    },
    async publish(channel, message) {
      await client.publish(channel, message);
    },
  };
}

let defaultPublisher: RedisPublisher | null = null;

/** Lazily-constructed process publisher from `REDIS_URL` (or a no-op). */
export function getDefaultPublisher(): RedisPublisher {
  if (defaultPublisher) return defaultPublisher;
  const url = process.env.REDIS_URL;
  defaultPublisher = url ? createBunPublisher(url) : createNoopPublisher("REDIS_URL unset");
  return defaultPublisher;
}

/** Test seam: override the process publisher (and the backfill latch). */
export function setDefaultPublisherForTest(pub: RedisPublisher | null): void {
  defaultPublisher = pub;
}

// ── Backfill suppression latch (§9.3) ───────────────────────────────────────

export class PublishGate {
  private realtime = false;
  constructor(
    private readonly windowSec: number = REALTIME_WINDOW_SEC,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Latch to realtime the first time an event is within `windowSec` of now. */
  observe(blockTimestampSec: number): void {
    if (this.realtime) return;
    if (this.now() / 1000 - blockTimestampSec <= this.windowSec) this.realtime = true;
  }

  /** True once the sync has reached head (publishes allowed). */
  get enabled(): boolean {
    return this.realtime;
  }

  /** Test seam. */
  setRealtimeForTest(v: boolean): void {
    this.realtime = v;
  }
}

/** Process-wide gate shared by every handler helper. */
export const publishGate = new PublishGate();

// ── Envelope + low-level publish (ungated; used by tracker/verifier) ─────────

export interface WsEnvelope<T> {
  v: 1;
  type: WsMessageType;
  channel: string;
  seq: number;
  ts: number;
  data: T;
}

/**
 * INCR the channel seq and PUBLISH one enveloped message. Fire-and-forget:
 * errors are logged, never propagated into the caller (handler/tracker).
 */
export function firePublish<T>(
  publisher: RedisPublisher,
  type: WsMessageType,
  channel: string,
  ts: number,
  data: T,
): void {
  void (async () => {
    try {
      const seq = await publisher.incr(channelSeqKey(channel));
      const envelope: WsEnvelope<T> = { v: 1, type, channel, seq, ts, data };
      await publisher.publish(channel, JSON.stringify(envelope));
    } catch (err) {
      console.error(`[indexer publish] failed on ${channel}:`, err);
    }
  })();
}

// ── Handler helpers (GATED by the backfill latch) ───────────────────────────

/** True when a handler-origin message may publish (post-backfill only). */
function gatedFor(blockTimestampSec: number): boolean {
  publishGate.observe(blockTimestampSec);
  return publishGate.enabled;
}

export interface TradePublishInput {
  token: string;
  trader: string;
  venue: Venue;
  isBuy: boolean;
  ethAmount: bigint;
  tokenAmount: bigint;
  feeEth: bigint;
  priceEth: number;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  blockTimestamp: number;
  confirmationState: ConfirmationState;
}

/** trade → `token:{addr}:trades` + `global:trades` (§8.1). */
export function publishTrade(input: TradePublishInput): void {
  if (!gatedFor(input.blockTimestamp)) return;
  const data: WsTradeData = {
    token: input.token,
    trader: input.trader,
    venue: input.venue,
    isBuy: input.isBuy,
    ethAmount: input.ethAmount.toString(),
    tokenAmount: input.tokenAmount.toString(),
    feeEth: input.feeEth.toString(),
    priceEth: input.priceEth,
    blockNumber: input.blockNumber,
    txHash: input.txHash,
    logIndex: input.logIndex,
    blockTimestamp: input.blockTimestamp,
    confirmationState: input.confirmationState,
  };
  const pub = getDefaultPublisher();
  firePublish(pub, "trade", tokenTrades(input.token), input.blockTimestamp, data);
  firePublish(pub, "trade", GLOBAL_TRADES, input.blockTimestamp, data);
}

export interface CandlePublishInput {
  token: string;
  interval: CandleInterval;
  bucketStart: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeEth: bigint;
  tradeCount: number;
  blockTimestamp: number;
}

/** candle → `token:{addr}:candles:{interval}` (§8.1, chart live updates). */
export function publishCandle(input: CandlePublishInput): void {
  if (!gatedFor(input.blockTimestamp)) return;
  const data: WsCandleData = {
    token: input.token,
    interval: input.interval,
    bucketStart: input.bucketStart,
    open: input.open,
    high: input.high,
    low: input.low,
    close: input.close,
    volumeEth: input.volumeEth.toString(),
    tradeCount: input.tradeCount,
  };
  firePublish(getDefaultPublisher(), "candle", tokenCandles(input.token, input.interval), input.blockTimestamp, data);
}

export interface LaunchPublishInput {
  address: string;
  name: string;
  ticker: string;
  creator: string;
  imageUrl?: string;
  createdAt: number;
  blockNumber: number;
  confirmationState: ConfirmationState;
}

/** launch → `global:launches` (§5.1 Discover ticker). */
export function publishLaunch(input: LaunchPublishInput): void {
  if (!gatedFor(input.createdAt)) return;
  const data: WsLaunchData = {
    address: input.address,
    name: input.name,
    ticker: input.ticker,
    creator: input.creator,
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    createdAt: input.createdAt,
    blockNumber: input.blockNumber,
    confirmationState: input.confirmationState,
  };
  firePublish(getDefaultPublisher(), "launch", GLOBAL_LAUNCHES, input.createdAt, data);
}

export interface GraduatedPublishInput {
  token: string;
  pool: string;
  blockNumber: number;
  ts: number;
}

/** graduated → `token:{addr}:events` + `global:launches` (venue switch, §5.2). */
export function publishGraduated(input: GraduatedPublishInput): void {
  if (!gatedFor(input.ts)) return;
  const data: WsGraduatedData = {
    token: input.token,
    pool: input.pool,
    blockNumber: input.blockNumber,
    ts: input.ts,
  };
  const pub = getDefaultPublisher();
  firePublish(pub, "graduated", tokenEvents(input.token), input.ts, data);
  firePublish(pub, "graduated", GLOBAL_LAUNCHES, input.ts, data);
}

export interface FeeCollectedPublishInput {
  token: string;
  recipient: string;
  amountToken: bigint;
  amountWeth: bigint;
  blockNumber: number;
  blockTimestamp: number;
  txHash: string;
  logIndex: number;
  confirmationState: ConfirmationState;
}

/** fee_collected → `token:{addr}:events` (X-6, treasury fee dashboard, §3.5). */
export function publishFeeCollected(input: FeeCollectedPublishInput): void {
  if (!gatedFor(input.blockTimestamp)) return;
  const data: WsFeeCollectedData = {
    token: input.token,
    recipient: input.recipient,
    amountToken: input.amountToken.toString(),
    amountWeth: input.amountWeth.toString(),
    blockNumber: input.blockNumber,
    blockTimestamp: input.blockTimestamp,
    txHash: input.txHash,
    logIndex: input.logIndex,
    confirmationState: input.confirmationState,
  };
  firePublish(getDefaultPublisher(), "fee_collected", tokenEvents(input.token), input.blockTimestamp, data);
}

// ── Side-process helpers (UNGATED — tracker/verifier run post-backfill) ──────

/** metadata_verified → `token:{addr}:events` (verifier, §6.1 step 7). */
export function publishMetadataVerified(
  publisher: RedisPublisher,
  token: string,
  status: WsMetadataVerifiedData["status"],
  ts: number,
): void {
  const data: WsMetadataVerifiedData = { token, status };
  firePublish(publisher, "metadata_verified", tokenEvents(token), ts, data);
}

/** confirmations watermark broadcast → `global:confirmations` (§12.20, O(1)). */
export function publishConfirmations(
  publisher: RedisPublisher,
  safeBlock: number,
  finalizedBlock: number,
  ts: number,
): void {
  const data: WsConfirmationsData = { safeBlock, finalizedBlock };
  firePublish(publisher, "confirmations", GLOBAL_CONFIRMATIONS, ts, data);
}

/** reorg notice → `global:confirmations` (§5.3 — clients drop orphaned rows). */
export function publishReorg(publisher: RedisPublisher, fromBlock: number, ts: number): void {
  const data: WsReorgData = { fromBlock };
  firePublish(publisher, "reorg", GLOBAL_CONFIRMATIONS, ts, data);
}
