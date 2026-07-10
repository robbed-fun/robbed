/**
 * Bun WebSocket fanout (indexer.md §8, api.md §6.5; M2-8) — the relay tier
 * between Redis pub/sub and browsers, holding the <500ms event-to-browser tail
 * of the latency budget (§8.3).
 *
 * Data flow (no polling, no DB, no per-message work beyond a topic publish):
 *   Alchemy WS → Ponder handler → Redis publish → THIS server → browser.
 *
 * Hard rules enforced here:
 *  - ZERO database access. This module imports no DB client; the structural
 *    `no-DB-import` test (test/ws-inventory.test.ts) fails CI if that ever
 *    changes. Truth is served by REST; WS is freshness only (§8.4).
 *  - Native fanout: each socket `ws.subscribe(channel)`s the Bun pub/sub topic
 *    whose name IS the Redis channel; a Redis message is relayed with one
 *    `server.publish(channel, payload)` — O(subscribers), no per-socket loop in
 *    our code, no re-serialization (the Redis payload is already the wire frame).
 *  - No replay buffer (§12.23): on reconnect / `seq` gap the client REST-heals;
 *    the server keeps only channel↔socket membership.
 *
 * Decide-it-yourself (basis recorded):
 *  - **Lazy per-channel Redis SUBSCRIBE, no UNSUBSCRIBE (v1).** Bun's RedisClient
 *    only permits `subscribe` once a connection is in subscriber mode (verified
 *    against bun.com/docs/api/redis, 2026-07-10) and does not document
 *    `psubscribe`; rather than risk pattern semantics we SUBSCRIBE the three
 *    global channels eagerly and each `token:*` channel lazily on first client
 *    interest, and never unsubscribe. The distinct-channel set is bounded by
 *    active tokens; membership churn is handled entirely by Bun topics, so an
 *    idle Redis subscription costs only its keyspace. Boring + correct.
 *  - **Hardening.** Client messages are size-capped, JSON-parsed defensively,
 *    validated against the shared `wsClientOpSchema`, and channel names must
 *    pass `isValidClientChannel` before a subscribe; per-socket subscription
 *    count is capped. Malformed input is dropped silently (never amplified).
 */
import {
  CANDLE_INTERVALS,
  GLOBAL_CHANNELS,
  wsClientOpSchema,
} from "@robbed/shared";

/** Cap on distinct channels one socket may subscribe to (abuse guard). */
export const MAX_SUBSCRIPTIONS_PER_SOCKET = 200;
/** Cap on a single inbound client control frame (sub/unsub/ping are tiny). */
export const MAX_CLIENT_MSG_BYTES = 4 * 1024;

/** Per-socket context carried in `ws.data`. */
export interface WsClientState {
  subs: Set<string>;
}

/** The subset of Bun's `ServerWebSocket` the hub uses (so it is unit-testable). */
export interface FanoutSocket {
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  send(message: string): number;
  readonly data: WsClientState;
}

/** Redis boundary: ensure the fanout server receives a channel's messages. */
export interface RedisUpstream {
  /** Idempotent SUBSCRIBE — messages are delivered to the relay callback. */
  ensureSubscribed(channel: string): void;
}

const TOKEN_CHANNEL_RE = new RegExp(
  `^token:0x[0-9a-f]{40}:(?:trades|events|candles:(?:${CANDLE_INTERVALS.join("|")}))$`,
);

/**
 * A client may only subscribe to a well-formed channel: one of the three global
 * channels, or a `token:{lowercase-addr}:{trades|events|candles:<interval>}`.
 * Rejects junk before it reaches Redis/topic state (hardening).
 */
export function isValidClientChannel(channel: string): boolean {
  if ((GLOBAL_CHANNELS as readonly string[]).includes(channel)) return true;
  return TOKEN_CHANNEL_RE.test(channel);
}

/**
 * The fanout core — pure routing over injected `RedisUpstream` + `FanoutSocket`s.
 * The Bun.serve wiring in `startWsServer` is a thin shell around this.
 */
export class WsHub {
  constructor(private readonly redis: RedisUpstream) {
    // Global channels always have listeners in aggregate — subscribe eagerly.
    for (const g of GLOBAL_CHANNELS) this.redis.ensureSubscribed(g);
  }

  /** Initialize per-socket state on connect. */
  onOpen(ws: FanoutSocket): void {
    ws.data.subs.clear();
  }

  /** Clean up membership on disconnect (Bun drops topic subs automatically). */
  onClose(ws: FanoutSocket): void {
    ws.data.subs.clear();
  }

  /**
   * Handle one inbound client control frame. Returns a small result for tests;
   * side effects are the topic subscribe/unsubscribe + Redis ensureSubscribed.
   */
  onMessage(ws: FanoutSocket, raw: string | ArrayBuffer | Uint8Array): { ok: boolean; reason?: string } {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    if (text.length > MAX_CLIENT_MSG_BYTES) return { ok: false, reason: "too_large" };

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, reason: "bad_json" };
    }
    const parsed = wsClientOpSchema.safeParse(json);
    if (!parsed.success) return { ok: false, reason: "bad_op" };
    const op = parsed.data;

    if (op.op === "ping") {
      // Liveness: receiving any frame resets Bun's idleTimeout; the server→client
      // heartbeat is Bun's protocol ping (sendPings). No app-level pong is sent
      // (it isn't in the shared wsMessage union — never invent a wire shape).
      return { ok: true };
    }

    if (op.op === "sub") {
      if (!isValidClientChannel(op.channel)) return { ok: false, reason: "bad_channel" };
      if (ws.data.subs.has(op.channel)) return { ok: true };
      if (ws.data.subs.size >= MAX_SUBSCRIPTIONS_PER_SOCKET) return { ok: false, reason: "sub_limit" };
      ws.subscribe(op.channel);
      ws.data.subs.add(op.channel);
      this.redis.ensureSubscribed(op.channel); // lazy per-channel upstream sub
      return { ok: true };
    }

    // op.op === "unsub"
    if (ws.data.subs.delete(op.channel)) ws.unsubscribe(op.channel);
    return { ok: true };
  }

  /**
   * Relay a Redis message to all sockets subscribed to `channel` via one native
   * topic publish. The payload is already the wire frame (built by the indexer),
   * so there is no parse/re-serialize in the hot path.
   */
  relay(channel: string, message: string, publish: (channel: string, message: string) => void): void {
    publish(channel, message);
  }
}

// ── Bun.serve boot (only runs when executed directly) ───────────────────────

interface BunRedisSubscriberLike {
  subscribe(channel: string, listener: (message: string, channel: string) => void): Promise<void>;
}

/**
 * Start the fanout server. Kept out of the test path (guarded by import.meta.main
 * below) so the unit suite drives `WsHub` with fakes and never opens a socket.
 */
export function startWsServer(opts: { port: number; redisUrl: string }): void {
  const BunGlobal = (globalThis as unknown as {
    Bun: {
      serve: (o: unknown) => { publish: (t: string, d: string) => number };
      RedisClient: new (u: string) => BunRedisSubscriberLike;
    };
  }).Bun;

  // eslint-disable-next-line prefer-const
  let server: { publish: (topic: string, data: string) => number };

  const subClient = new BunGlobal.RedisClient(opts.redisUrl);
  const subscribed = new Set<string>();
  const upstream: RedisUpstream = {
    ensureSubscribed(channel: string): void {
      if (subscribed.has(channel)) return;
      subscribed.add(channel);
      void subClient
        .subscribe(channel, (message) => {
          // One native topic publish → every subscribed browser.
          server.publish(channel, message);
        })
        .catch((err) => console.error(`[ws] SUBSCRIBE ${channel} failed:`, err));
    },
  };

  const hub = new WsHub(upstream);

  server = BunGlobal.serve({
    port: opts.port,
    fetch(req: Request, srv: { upgrade: (r: Request, o: unknown) => boolean }): Response | undefined {
      if (srv.upgrade(req, { data: { subs: new Set<string>() } as WsClientState })) return undefined;
      return new Response("robbed ws: upgrade required", { status: 426 });
    },
    websocket: {
      idleTimeout: 120, // seconds; Bun sends protocol pings (sendPings default true)
      maxPayloadLength: MAX_CLIENT_MSG_BYTES,
      sendPings: true,
      open(ws: FanoutSocket) {
        hub.onOpen(ws);
      },
      message(ws: FanoutSocket, msg: string | ArrayBuffer | Uint8Array) {
        hub.onMessage(ws, msg);
      },
      close(ws: FanoutSocket) {
        hub.onClose(ws);
      },
    },
  });

  console.log(`[ws] fanout listening on :${opts.port}`);
}

if (import.meta.main) {
  const port = Number(process.env.WS_PORT ?? 3002);
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  startWsServer({ port, redisUrl });
}
