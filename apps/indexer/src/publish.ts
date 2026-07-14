/**
 * Redis publish path (indexer.md, M2-8) — the ONLY hop between a
 * Ponder handler and the Bun WS fanout.
 *
 * Hard constraints this module enforces (<500ms budget):
 *  - ZERO database / RPC reads here. Every message is built entirely from values
 *    the handler already holds; the structural `no-DB-import` test asserts this
 *    module imports no DB client (`ponder:schema`/`ponder:registry`/`pg`/…).
 *  - Fire-and-forget: a lost publish is self-healing (clients REST-heal on a
 * `seq` gap) — we log and move on, never block or throw into a handler.
 * - Per-channel monotonic `seq` via a single Redis `INCR channel:seq` —
 *    one Redis op, no DB.
 * - Publishes are SUPPRESSED during historical backfill — see
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
 * Transport decision (prod-images.md fix, 2026-07-11 — basis recorded):
 * Ponder runs under NODE in the prod container, where
 *   `globalThis.Bun` does not exist, so the former Bun-only transport silently
 *   no-opped every realtime publish with `redis_publish_errors_total` stuck at
 *   0. The transport is now selected BY RUNTIME in `createRuntimePublisher`:
 *   Bun present → Bun's native `RedisClient` (dev/compose unchanged, matches
 *   the API); otherwise → the official `redis` client (node-redis, pinned
 *   6.1.0 — chosen over ioredis, which is in maintenance mode; verified
 *   against current node-redis v6 docs: offline queue ON by default buffers
 *   commands while the socket comes up, default per-command timeout 5000ms
 *   bounds a dead-Redis publish, default reconnectStrategy = exponential
 *   backoff capped at 2s). A silent no-op transport must NEVER exist again:
 *   if no client can be constructed (REDIS_URL unset / ctor failure) we THROW,
 *   and `startSidecars` (Ponder `:setup`, before indexing) preflights the
 *   construction so the process fails LOUD at startup. Transport-level errors
 *   feed the existing `redis_publish_errors_total` counter (`./metrics` is
 *   dependency-free, so the no-DB hot-path invariant is preserved — asserted
 *   structurally in the test).
 */
import { createClient } from "redis";
import { incRedisPublishError } from "./metrics";
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
  type WsCreatorFeeClaimedData,
  type WsCreatorFeeSplitData,
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
 * Injected in tests (fake), runtime-selected otherwise (Bun native client
 * under Bun, node-redis under Node). `incr` returns the new per-channel
 * sequence; `publish` fans the message to Redis subscribers.
 */
export interface RedisPublisher {
  /** Which concrete transport backs this publisher (logged at selection). */
  readonly kind?: "bun" | "node";
  incr(key: string): Promise<number>;
  publish(channel: string, message: string): Promise<void>;
  /** Teardown for tests / graceful shutdown — never called on the hot path. */
  close?(): void;
}

interface BunRedisClientLike {
  send(command: string, args: string[]): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
  close?(): void;
}

/** The subset of the `Bun` global the transport selection cares about. */
export interface BunRedisNamespace {
  RedisClient?: new (url: string) => BunRedisClientLike;
}

/** Runtime detection seam (injectable in tests). */
export function getBunRedisNamespace(): BunRedisNamespace | undefined {
  return (globalThis as { Bun?: BunRedisNamespace }).Bun;
}

/**
 * Bun-native publisher. THROWS when `Bun.RedisClient` is absent — a no-op
 * transport must never exist (prod-images.md); callers wanting runtime
 * selection use `createRuntimePublisher`.
 */
export function createBunPublisher(url: string, bun: BunRedisNamespace | null | undefined = getBunRedisNamespace()): RedisPublisher {
  if (!bun?.RedisClient) {
    throw new Error("[indexer publish] Bun.RedisClient unavailable — cannot construct the Bun Redis transport.");
  }
  const client = new bun.RedisClient(url);
  return {
    kind: "bun",
    async incr(key) {
      const res = await client.send("INCR", [key]);
      return typeof res === "number" ? res : Number(res);
    },
    async publish(channel, message) {
      await client.publish(channel, message);
    },
    close() {
      client.close?.();
    },
  };
}

/**
 * Node publisher (node-redis 6.x) — the prod-container path (Ponder under
 * Node). Connect is fire-and-forget: node-redis's offline queue
 * (enabled by default) buffers INCR/PUBLISH until the socket is up, the 5s
 * default per-command timeout bounds a dead-Redis publish (failure lands in
 * `firePublish`'s catch → error counter), and the default reconnectStrategy
 * (exponential backoff, ≤2s) retries forever. Client-level errors increment
 * `redis_publish_errors_total` (log throttled to one line per 30s so a Redis
 * outage cannot flood stdout while the counter keeps counting).
 */
export function createNodePublisher(url: string): RedisPublisher {
  const client = createClient({ url });
  let lastErrorLogMs = 0;
  client.on("error", (err: unknown) => {
    incRedisPublishError();
    const now = Date.now();
    if (now - lastErrorLogMs >= 30_000) {
      lastErrorLogMs = now;
      console.error("[indexer publish] node-redis client error (auto-reconnect continues):", err);
    }
  });
  // Errors reach the "error" listener above; the catch only silences the
  // duplicate rejection so it can't become an unhandled rejection.
  void client.connect().catch(() => {});
  return {
    kind: "node",
    async incr(key) {
      return client.incr(key);
    },
    async publish(channel, message) {
      await client.publish(channel, message);
    },
    close() {
      try {
        client.destroy();
      } catch {
        // already closed
      }
    },
  };
}

/**
 * Runtime transport selection (prod-images.md) Bun global with a
 * RedisClient → Bun-native path (dev/compose, matches the API); otherwise the
 * Node client (prod Ponder container). Never a no-op — both branches either
 * return a real transport or throw.
 */
export function createRuntimePublisher(url: string, bun: BunRedisNamespace | null | undefined = getBunRedisNamespace()): RedisPublisher {
  return bun?.RedisClient ? createBunPublisher(url, bun) : createNodePublisher(url);
}

// ── control:reverify subscriber transport (used by sidecar.ts) ──────────────

interface BunSubscriberClientLike {
  subscribe(channel: string, listener: (message: string, channel: string) => void): Promise<void>;
}

/** Injectable Bun-namespace shape for `createReverifySubscriber` (tests). */
export interface BunSubscriberNamespace {
  RedisClient?: new (url: string) => BunSubscriberClientLike;
}

/** Structurally identical to metadata.ts's `ReverifySubscriber` (no import —
 * this module may only depend on shared/node:/redis/./metrics). */
export interface ReverifySubscriberLike {
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
}

/**
 * Runtime-selected `control:reverify` subscriber (prod-images.md fix):
 * Bun's RedisClient under Bun, node-redis under Node. SUBSCRIBE takes over a
 * connection, so both branches use a dedicated client — never the publisher's.
 * THROWS when no client can be constructed (missing REDIS_URL) — an inert
 * admin re-verify seam must never exist silently. Lives here (not sidecar.ts)
 * so the transport is unit-testable without sidecar's eager env config.
 */
export function createReverifySubscriber(
  url: string | undefined,
  bun: BunSubscriberNamespace | null | undefined = (globalThis as unknown as { Bun?: BunSubscriberNamespace }).Bun,
): ReverifySubscriberLike {
  if (!url) {
    throw new Error("[indexer sidecar] REDIS_URL unset — cannot construct the control:reverify subscriber (seam would be silently inert).");
  }
  if (bun?.RedisClient) {
    const client = new bun.RedisClient(url);
    return {
      async subscribe(channel, handler) {
        await client.subscribe(channel, (message) => handler(message));
      },
    };
  }
  // Node runtime (prod container): node-redis auto-resubscribes on reconnect;
  // errors are logged (the loop labels/derives only — never gates chain state).
  const client = createClient({ url });
  client.on("error", (err: unknown) => {
    console.error("[indexer sidecar] control:reverify node-redis error (auto-reconnect continues):", err);
  });
  return {
    async subscribe(channel, handler) {
      await client.connect();
      await client.subscribe(channel, (message: string) => handler(message));
    },
  };
}

let defaultPublisher: RedisPublisher | null = null;

/**
 * Lazily-constructed process publisher from `REDIS_URL`. THROWS when no
 * transport can be constructed (REDIS_URL unset / client ctor failure) —
 * `startSidecars` preflights this at startup so misconfiguration kills the
 * process instead of silently dropping every realtime publish.
 */
export function getDefaultPublisher(): RedisPublisher {
  if (defaultPublisher) return defaultPublisher;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "[indexer publish] REDIS_URL is unset — no Redis publish transport can be constructed. " +
        "Refusing to run as a silent no-op (every realtime WS publish would drop; prod-images.md).",
    );
  }
  defaultPublisher = createRuntimePublisher(url);
  console.log(`[indexer publish] Redis transport selected: ${defaultPublisher.kind}`);
  return defaultPublisher;
}

/** Test seam: override the process publisher (and the backfill latch). */
export function setDefaultPublisherForTest(pub: RedisPublisher | null): void {
  defaultPublisher = pub;
}

// ── Backfill suppression latch ───────────────────────────────────────

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
 * errors are counted (`redis_publish_errors_total`, gate-7) and logged,
 * never propagated into the caller (handler/tracker).
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
      incRedisPublishError();
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

/** trade → `token:{addr}:trades` + `global:trades`. */
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

/** candle → `token:{addr}:candles:{interval}` (chart live updates). */
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

/** launch → `global:launches` (Discover ticker). */
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

/** graduated → `token:{addr}:events` + `global:launches` (venue switch). */
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

/** fee_collected → `token:{addr}:events` (X-6, treasury fee dashboard). */
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

export interface CreatorFeeSplitPublishInput {
  /** The graduated launch token (channel key), resolved from FeesSplit.tokenId. */
  token: string;
  creator: string;
  creatorAmountToken: bigint;
  creatorAmountWeth: bigint;
  treasuryAmountToken: bigint;
  treasuryAmountWeth: bigint;
  blockNumber: number;
  blockTimestamp: number;
  txHash: string;
  logIndex: number;
  confirmationState: ConfirmationState;
}

/**
 * creator_fee_split → `token:{launchToken}:events`. The 50/50 split of a
 * graduated pool's fees at `LPFeeVault.collect()`, keyed by the launch token so the
 * token page / creator claim surface can live-update accrual. Both beneficiaries'
 * per-leg amounts are already resolved to token/weth by the handler.
 */
export function publishCreatorFeeSplit(input: CreatorFeeSplitPublishInput): void {
  if (!gatedFor(input.blockTimestamp)) return;
  const data: WsCreatorFeeSplitData = {
    token: input.token,
    creator: input.creator,
    creatorAmountToken: input.creatorAmountToken.toString(),
    creatorAmountWeth: input.creatorAmountWeth.toString(),
    treasuryAmountToken: input.treasuryAmountToken.toString(),
    treasuryAmountWeth: input.treasuryAmountWeth.toString(),
    blockNumber: input.blockNumber,
    blockTimestamp: input.blockTimestamp,
    txHash: input.txHash,
    logIndex: input.logIndex,
    confirmationState: input.confirmationState,
  };
  firePublish(getDefaultPublisher(), "creator_fee_split", tokenEvents(input.token), input.blockTimestamp, data);
}

export interface CreatorFeeClaimedPublishInput {
  creator: string;
  /** The ERC20 claimed — a graduated launch token OR canonical WETH; also the channel key. */
  token: string;
  amount: bigint;
  blockNumber: number;
  blockTimestamp: number;
  txHash: string;
  logIndex: number;
  confirmationState: ConfirmationState;
}

/**
 * creator_fee_claimed → `token:{token}:events`. A creator pulled an accrued
 * post-grad ERC20 balance (`claimERC20(creator, token)`); the Portfolio CreatedTab
 * reconciles optimistic state against the confirmed payout. Channel decision (indexer-
 * owned taxonomy, channels.ts): the shared DEFAULT `token:{address}:events` keyed by the
 * claimed ERC20. A launch-token-leg claim (`token` = a graduated launch token) live-
 * updates that token's page; a WETH-leg claim (`token` = canonical WETH) lands on the
 * WETH-keyed channel — currently unconsumed, since the CreatorTab's AUTHORITATIVE source
 * is the REST endpoint (live `tokenBalanceOf`), which REST-heals independent of WS. A
 * dedicated per-creator channel (`creator:{address}:events`) is DEFERRED, not invented:
 * it needs a shared `channels.ts` helper (frontend + WS relay both consume the name — a
 * cross-service shape routed via robbed-shared, never redeclared) plus a `creator:*`
 * PSUBSCRIBE in the Bun WS relay; wiring one leg alone yields a dead channel.
 */
export function publishCreatorFeeClaimed(input: CreatorFeeClaimedPublishInput): void {
  if (!gatedFor(input.blockTimestamp)) return;
  const data: WsCreatorFeeClaimedData = {
    creator: input.creator,
    token: input.token,
    amount: input.amount.toString(),
    blockNumber: input.blockNumber,
    blockTimestamp: input.blockTimestamp,
    txHash: input.txHash,
    logIndex: input.logIndex,
    confirmationState: input.confirmationState,
  };
  firePublish(getDefaultPublisher(), "creator_fee_claimed", tokenEvents(input.token), input.blockTimestamp, data);
}

// ── Side-process helpers (UNGATED — tracker/verifier run post-backfill) ──────

/** metadata_verified → `token:{addr}:events` (verifier, step 7). */
export function publishMetadataVerified(
  publisher: RedisPublisher,
  token: string,
  status: WsMetadataVerifiedData["status"],
  ts: number,
): void {
  const data: WsMetadataVerifiedData = { token, status };
  firePublish(publisher, "metadata_verified", tokenEvents(token), ts, data);
}

/** confirmations watermark broadcast → `global:confirmations` (O(1)). */
export function publishConfirmations(
  publisher: RedisPublisher,
  safeBlock: number,
  finalizedBlock: number,
  ts: number,
): void {
  const data: WsConfirmationsData = { safeBlock, finalizedBlock };
  firePublish(publisher, "confirmations", GLOBAL_CONFIRMATIONS, ts, data);
}

/** reorg notice → `global:confirmations` (clients drop orphaned rows). */
export function publishReorg(publisher: RedisPublisher, fromBlock: number, ts: number): void {
  const data: WsReorgData = { fromBlock };
  firePublish(publisher, "reorg", GLOBAL_CONFIRMATIONS, ts, data);
}
