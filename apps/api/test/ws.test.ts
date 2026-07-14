/**
 * Bun WS fanout routing (indexer.md, api.md; M2-8). Drives the pure
 * `WsHub` core with fakes — no real socket is opened — covering client op
 * validation, channel hardening, the subscription cap, and the Redis→topic relay.
 */
import { describe, expect, it } from "bun:test";
import {
  WsHub,
  isValidClientChannel,
  MAX_SUBSCRIPTIONS_PER_SOCKET,
  MAX_CLIENT_MSG_BYTES,
  type FanoutSocket,
  type RedisUpstream,
  type WsClientState,
} from "../src/ws";

const TOKEN = "0x" + "ab".repeat(20);

function fakeUpstream() {
  const subscribed: string[] = [];
  const redis: RedisUpstream = {
    ensureSubscribed(channel) {
      if (!subscribed.includes(channel)) subscribed.push(channel);
    },
  };
  return { redis, subscribed };
}

function fakeSocket() {
  const topics: string[] = [];
  const sent: string[] = [];
  const data: WsClientState = { subs: new Set() };
  const ws: FanoutSocket = {
    subscribe(t) {
      topics.push(t);
    },
    unsubscribe(t) {
      const i = topics.indexOf(t);
      if (i >= 0) topics.splice(i, 1);
    },
    send(m) {
      sent.push(m);
      return m.length;
    },
    data,
  };
  return { ws, topics, sent, data };
}

describe("isValidClientChannel — hardening", () => {
  it("accepts the three global channels", () => {
    for (const c of ["global:launches", "global:trades", "global:confirmations"]) {
      expect(isValidClientChannel(c)).toBe(true);
    }
  });
  it("accepts well-formed token channels", () => {
    expect(isValidClientChannel(`token:${TOKEN}:trades`)).toBe(true);
    expect(isValidClientChannel(`token:${TOKEN}:events`)).toBe(true);
    expect(isValidClientChannel(`token:${TOKEN}:candles:1m`)).toBe(true);
    expect(isValidClientChannel(`token:${TOKEN}:candles:1h`)).toBe(true);
  });
  it("rejects junk / bad interval / uppercase addr / control channels", () => {
    expect(isValidClientChannel("token:0xNOTHEX:trades")).toBe(false);
    expect(isValidClientChannel(`token:${TOKEN}:candles:2m`)).toBe(false);
    expect(isValidClientChannel(`token:${TOKEN.toUpperCase()}:trades`)).toBe(false);
    expect(isValidClientChannel("control:reverify")).toBe(false);
    expect(isValidClientChannel("*")).toBe(false);
  });
});

describe("WsHub — subscription lifecycle", () => {
  it("eagerly subscribes Redis to the global channels at construction", () => {
    const up = fakeUpstream();
    new WsHub(up.redis);
    expect(up.subscribed.sort()).toEqual(["global:confirmations", "global:launches", "global:trades"]);
  });

  it("sub: subscribes the topic, tracks membership, lazily subscribes Redis", () => {
    const up = fakeUpstream();
    const hub = new WsHub(up.redis);
    const s = fakeSocket();
    hub.onOpen(s.ws);
    const ch = `token:${TOKEN}:trades`;
    const r = hub.onMessage(s.ws, JSON.stringify({ op: "sub", channel: ch }));
    expect(r.ok).toBe(true);
    expect(s.topics).toContain(ch);
    expect(s.data.subs.has(ch)).toBe(true);
    expect(up.subscribed).toContain(ch);
  });

  it("duplicate sub is idempotent (no double topic subscribe)", () => {
    const up = fakeUpstream();
    const hub = new WsHub(up.redis);
    const s = fakeSocket();
    const ch = `token:${TOKEN}:events`;
    hub.onMessage(s.ws, JSON.stringify({ op: "sub", channel: ch }));
    hub.onMessage(s.ws, JSON.stringify({ op: "sub", channel: ch }));
    expect(s.topics.filter((t) => t === ch)).toHaveLength(1);
  });

  it("unsub removes membership + topic", () => {
    const up = fakeUpstream();
    const hub = new WsHub(up.redis);
    const s = fakeSocket();
    const ch = `token:${TOKEN}:trades`;
    hub.onMessage(s.ws, JSON.stringify({ op: "sub", channel: ch }));
    hub.onMessage(s.ws, JSON.stringify({ op: "unsub", channel: ch }));
    expect(s.data.subs.has(ch)).toBe(false);
    expect(s.topics).not.toContain(ch);
  });

  it("rejects invalid channels, bad JSON, bad ops, oversized frames", () => {
    const hub = new WsHub(fakeUpstream().redis);
    const s = fakeSocket();
    expect(hub.onMessage(s.ws, JSON.stringify({ op: "sub", channel: "control:reverify" })).reason).toBe("bad_channel");
    expect(hub.onMessage(s.ws, "{bad json").reason).toBe("bad_json");
    expect(hub.onMessage(s.ws, JSON.stringify({ op: "nope" })).reason).toBe("bad_op");
    expect(hub.onMessage(s.ws, "x".repeat(MAX_CLIENT_MSG_BYTES + 1)).reason).toBe("too_large");
  });

  it("ping is accepted (liveness) and creates no subscription", () => {
    const hub = new WsHub(fakeUpstream().redis);
    const s = fakeSocket();
    const r = hub.onMessage(s.ws, JSON.stringify({ op: "ping" }));
    expect(r.ok).toBe(true);
    expect(s.data.subs.size).toBe(0);
  });

  it("enforces the per-socket subscription cap", () => {
    const hub = new WsHub(fakeUpstream().redis);
    const s = fakeSocket();
    // Fill with valid distinct token channels up to the cap.
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_SOCKET; i++) {
      const addr = "0x" + i.toString(16).padStart(40, "0");
      const r = hub.onMessage(s.ws, JSON.stringify({ op: "sub", channel: `token:${addr}:trades` }));
      expect(r.ok).toBe(true);
    }
    const over = hub.onMessage(s.ws, JSON.stringify({ op: "sub", channel: `token:${TOKEN}:trades` }));
    expect(over.reason).toBe("sub_limit");
  });
});

describe("WsHub.relay — Redis → native topic publish", () => {
  it("publishes the raw frame to the channel topic (no re-serialize)", () => {
    const hub = new WsHub(fakeUpstream().redis);
    const published: Array<{ channel: string; message: string }> = [];
    const frame = '{"v":1,"type":"trade","channel":"global:trades","seq":7,"ts":1,"data":{}}';
    hub.relay("global:trades", frame, (channel, message) => published.push({ channel, message }));
    expect(published).toEqual([{ channel: "global:trades", message: frame }]);
  });
});
