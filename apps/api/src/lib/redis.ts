/**
 * Redis boundary — pub/sub (worker subscribe to `global:launches` X-10; publish
 * `control:reverify` X-9) + short-TTL key/value (single-use SIWE nonce, §6.2).
 * Behind an INTERFACE so tests inject a fake; the concrete impl uses Bun's
 * native `RedisClient` (no ioredis dependency). Rate limiting has its own store
 * (`mw/ratelimit.ts`) so the hot HTTP path stays dependency-light.
 */
export interface Redis {
  get(key: string): Promise<string | null>;
  /** SET with optional TTL seconds; `nx` = only-if-absent (nonce burn). */
  set(key: string, value: string, opts?: { exSeconds?: number; nx?: boolean }): Promise<boolean>;
  del(key: string): Promise<void>;
  /**
   * Atomic INCR → new value. Used for the per-channel monotonic WS `seq`
   * (`channel:seq`) when the API publishes a `comment` event, mirroring the
   * indexer's `firePublish` (one Redis op, no DB — indexer.md §8.2).
   */
  incr(key: string): Promise<number>;
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  ping(): Promise<boolean>;
}

interface BunRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: string[]): Promise<string | null>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, listener: (message: string, channel: string) => void): Promise<void>;
  send(command: string, args: string[]): Promise<unknown>;
  connect?(): Promise<void>;
}

export function createBunRedis(url: string): Redis {
  const { RedisClient } = (globalThis as unknown as {
    Bun: { RedisClient: new (u: string) => BunRedisClient };
  }).Bun;
  const client = new RedisClient(url);
  return {
    async get(key) {
      return client.get(key);
    },
    async set(key, value, opts) {
      const args: string[] = [];
      if (opts?.exSeconds) args.push("EX", String(opts.exSeconds));
      if (opts?.nx) args.push("NX");
      const res = await client.set(key, value, ...args);
      return res !== null; // NX returns null when not set
    },
    async del(key) {
      await client.del(key);
    },
    async incr(key) {
      return client.incr(key);
    },
    async publish(channel, message) {
      await client.publish(channel, message);
    },
    async subscribe(channel, handler) {
      await client.subscribe(channel, (message) => handler(message));
    },
    async ping() {
      try {
        await client.send("PING", []);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** In-memory fake for tests / single-process dev. */
export function createFakeRedis(): Redis & {
  emit(channel: string, message: string): void;
} {
  const kv = new Map<string, { value: string; expiresAt: number | null }>();
  const subs = new Map<string, Array<(m: string) => void>>();
  const counters = new Map<string, number>();
  const alive = (e: { expiresAt: number | null }) =>
    e.expiresAt == null || e.expiresAt > Date.now();
  return {
    async get(key) {
      const e = kv.get(key);
      if (!e || !alive(e)) return null;
      return e.value;
    },
    async set(key, value, opts) {
      const existing = kv.get(key);
      if (opts?.nx && existing && alive(existing)) return false;
      kv.set(key, {
        value,
        expiresAt: opts?.exSeconds ? Date.now() + opts.exSeconds * 1000 : null,
      });
      return true;
    },
    async del(key) {
      kv.delete(key);
    },
    async incr(key) {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    async publish(channel, message) {
      for (const h of subs.get(channel) ?? []) h(message);
    },
    async subscribe(channel, handler) {
      const list = subs.get(channel) ?? [];
      list.push(handler);
      subs.set(channel, list);
    },
    async ping() {
      return true;
    },
    emit(channel, message) {
      for (const h of subs.get(channel) ?? []) h(message);
    },
  };
}
