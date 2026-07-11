#!/usr/bin/env bun
/**
 * ── dev:health — the G-1 health checklist against the running local stack ──
 *
 * Exits 0 only when EVERY check passes; prints each check's result:
 *   1. postgres    — `select 1` over the host-mapped port (Bun's built-in SQL client)
 *   2. redis       — PING → PONG (Bun's built-in RedisClient)
 *   3. chain RPC   — eth_chainId == 0x1237 (4663, the anvil fork)
 *   4. indexer     — head advancing: two samples of Ponder GET /status a few
 *                    seconds apart must differ, OR head == chain tip (G-1 wording).
 *                    /status shape { [chain]: { id, block: { number } | null } }
 *                    per ponder.sh docs (observability, verified 2026-07-11);
 *                    block == null ⇒ backfill incomplete ⇒ fail.
 *   5. api         — GET /v1/healthz and /v1/readyz both 200
 *   6. ws          — handshake + subscribe/unsubscribe ROUND-TRIP using the
 *                    shared shapes (wsClientOpSchema out, wsMessageSchema in):
 *                    sub a probe token channel, publish a schema-valid frame on
 *                    Redis, expect the fanout to deliver it; unsub, publish
 *                    again, expect silence. Publish is retried while waiting —
 *                    the WS server's per-channel Redis SUBSCRIBE is lazy/async
 *                    (apps/api/src/ws.ts), so the first publish can legally race
 *                    it; retrying makes the probe deterministic without touching
 *                    the server. The probe channel is a reserved dummy token
 *                    address (0x…01), so no real browser session sees the frame.
 *   7. web         — GET / returns 200 (generous timeout: first hit compiles).
 *
 * Ports follow the stack's 4XXX convention and honor the SAME *_PORT env vars
 * compose uses (WEB_PORT, API_PORT, WS_PORT, PONDER_PORT, POSTGRES_PORT,
 * REDIS_PORT, ANVIL_PORT) — never hardcoded without the env fallback.
 *
 * Shared shapes are imported from packages/shared/src (workspace source —
 * single source of truth, nothing redeclared here).
 *
 * Run: `bun run dev:health` (root package.json).
 */
import { RedisClient, SQL } from "bun";
import {
  tokenTrades,
  wsClientOpSchema,
  wsMessageSchema,
  type WsClientOp,
} from "../../packages/shared/src/index";

// ── Env / ports (same vars + defaults as docker-compose.yml) ────────────────
const env = (name: string, fallback: string): string => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};
const WEB_PORT = env("WEB_PORT", "4000");
const API_PORT = env("API_PORT", "4001");
const WS_PORT = env("WS_PORT", "4002");
const PONDER_PORT = env("PONDER_PORT", "4269");
const POSTGRES_PORT = env("POSTGRES_PORT", "4432");
const REDIS_PORT = env("REDIS_PORT", "4379");
const ANVIL_PORT = env("ANVIL_PORT", "4545");
const PG_USER = env("POSTGRES_USER", "robbed");
const PG_PASSWORD = env("POSTGRES_PASSWORD", "robbed_dev_pw");
const PG_DB = env("POSTGRES_DB", "robbed");

const DB_URL = `postgres://${PG_USER}:${PG_PASSWORD}@localhost:${POSTGRES_PORT}/${PG_DB}`;
const REDIS_URL = `redis://localhost:${REDIS_PORT}`;
const RPC_URL = `http://localhost:${ANVIL_PORT}`;
const PONDER_URL = `http://localhost:${PONDER_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;
const WS_URL = `ws://localhost:${WS_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

const EXPECTED_CHAIN_ID_HEX = "0x1237"; // 4663 — Robinhood Chain (CLAUDE.md)
const HEAD_SAMPLE_GAP_MS = 4000; // anvil runs --block-time 2 → two samples 4s apart must tick

// ── Tiny harness ─────────────────────────────────────────────────────────────
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function rpc(method: string): Promise<string> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  if (typeof json.result !== "string") throw new Error(`${method}: no result`);
  return json.result;
}

/** Ponder /status → head block number (throws when backfill incomplete). */
async function ponderHead(): Promise<number> {
  const res = await fetch(`${PONDER_URL}/status`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GET /status: HTTP ${res.status}`);
  const status = (await res.json()) as Record<string, { id: number; block: { number: number } | null }>;
  const chain = status["robinhood"];
  if (!chain) throw new Error(`GET /status: no "robinhood" chain in ${JSON.stringify(status)}`);
  if (!chain.block) throw new Error("GET /status: block=null — historical indexing not complete");
  return chain.block.number;
}

// ── Checks (each returns a human detail string; throws on failure) ──────────

async function checkPostgres(): Promise<string> {
  const sql = new SQL(DB_URL);
  try {
    const rows = (await withTimeout(sql`select 1 as ok`, 10_000, "select 1")) as Array<{ ok: number }>;
    if (rows[0]?.ok !== 1) throw new Error(`unexpected result: ${JSON.stringify(rows)}`);
    return `select 1 ok on localhost:${POSTGRES_PORT}/${PG_DB}`;
  } finally {
    await sql.close();
  }
}

async function checkRedis(): Promise<string> {
  const redis = new RedisClient(REDIS_URL);
  try {
    const pong = await withTimeout(redis.send("PING", []), 10_000, "PING");
    if (pong !== "PONG") throw new Error(`PING → ${JSON.stringify(pong)}`);
    return `PING → PONG on localhost:${REDIS_PORT}`;
  } finally {
    redis.close();
  }
}

async function checkChain(): Promise<string> {
  const id = await rpc("eth_chainId");
  if (id.toLowerCase() !== EXPECTED_CHAIN_ID_HEX) {
    throw new Error(`eth_chainId → ${id}, expected ${EXPECTED_CHAIN_ID_HEX} (4663)`);
  }
  return `eth_chainId → ${id} (4663)`;
}

async function checkIndexerHead(): Promise<string> {
  const h1 = await ponderHead();
  await Bun.sleep(HEAD_SAMPLE_GAP_MS);
  const h2 = await ponderHead();
  if (h2 > h1) return `head advancing: ${h1} → ${h2}`;
  // G-1: samples may be equal iff head == chain tip.
  const tip = parseInt(await rpc("eth_blockNumber"), 16);
  if (h2 >= tip) return `head ${h2} == chain tip ${tip}`;
  throw new Error(`head stuck at ${h2} (two samples ${HEAD_SAMPLE_GAP_MS}ms apart) while chain tip is ${tip}`);
}

async function checkApi(): Promise<string> {
  for (const path of ["/v1/healthz", "/v1/readyz"]) {
    const res = await fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(15_000) });
    if (res.status !== 200) {
      const body = await res.text().catch(() => "");
      throw new Error(`GET ${path} → ${res.status} ${body.slice(0, 300)}`);
    }
  }
  return `GET /v1/healthz + /v1/readyz → 200`;
}

async function checkWs(): Promise<string> {
  // Reserved probe token — a well-formed channel per the shared taxonomy that no
  // real token will ever occupy, so the synthetic frame reaches no real client.
  const probeToken = "0x0000000000000000000000000000000000000001";
  const channel = tokenTrades(probeToken);
  const frame = wsMessageSchema.parse({
    v: 1,
    type: "trade",
    channel,
    seq: 0,
    ts: Math.floor(Date.now() / 1000),
    data: {
      token: probeToken,
      trader: probeToken,
      venue: "curve",
      isBuy: true,
      ethAmount: "0",
      tokenAmount: "0",
      feeEth: "0",
      priceEth: 0,
      blockNumber: 0,
      txHash: `0x${"0".repeat(64)}`,
      logIndex: 0,
      blockTimestamp: 0,
      confirmationState: "soft_confirmed",
    },
  });
  const payload = JSON.stringify(frame);
  const sendOp = (ws: WebSocket, op: WsClientOp): void => {
    ws.send(JSON.stringify(wsClientOpSchema.parse(op)));
  };

  const redis = new RedisClient(REDIS_URL);
  const ws = new WebSocket(WS_URL);
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("WS handshake failed"));
      }),
      10_000,
      "WS handshake",
    );

    let received: string | null = null;
    ws.onmessage = (ev) => {
      received = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
    };

    // sub → publish (retried: the server's lazy Redis SUBSCRIBE may race) → expect frame
    sendOp(ws, { op: "sub", channel });
    const deadline = Date.now() + 8_000;
    while (received === null && Date.now() < deadline) {
      await redis.publish(channel, payload);
      await Bun.sleep(250);
    }
    if (received === null) throw new Error(`subscribed frame not delivered within 8s on ${channel}`);
    const parsed = wsMessageSchema.parse(JSON.parse(received));
    if (parsed.channel !== channel || parsed.type !== "trade") {
      throw new Error(`unexpected frame: ${received}`);
    }

    // unsub → drain in-flight → publish once more → expect silence
    sendOp(ws, { op: "unsub", channel });
    await Bun.sleep(600); // let the unsub + any in-flight retried frames settle
    received = null;
    await redis.publish(channel, payload);
    await Bun.sleep(1_200);
    if (received !== null) throw new Error("frame delivered AFTER unsub — unsubscribe not honored");

    return "handshake + sub (frame delivered, schema-valid) + unsub (silence) round-trip ok";
  } finally {
    ws.close();
    redis.close();
  }
}

async function checkWeb(): Promise<string> {
  // First request compiles the route under `next dev` — allow a generous window.
  const res = await fetch(`${WEB_URL}/`, { signal: AbortSignal.timeout(60_000) });
  if (res.status !== 200) throw new Error(`GET / → ${res.status}`);
  return "GET / → 200";
}

// ── Runner ───────────────────────────────────────────────────────────────────
const CHECKS: Array<[name: string, run: () => Promise<string>]> = [
  ["postgres", checkPostgres],
  ["redis", checkRedis],
  ["chain-rpc", checkChain],
  ["indexer-head", checkIndexerHead],
  ["api", checkApi],
  ["ws-roundtrip", checkWs],
  ["web", checkWeb],
];

let failures = 0;
for (const [name, run] of CHECKS) {
  const t0 = Date.now();
  try {
    const detail = await run();
    console.log(`[health] ✔ ${name.padEnd(13)} ${detail} (${Date.now() - t0}ms)`);
  } catch (err) {
    failures += 1;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[health] ✘ ${name.padEnd(13)} ${msg}`);
  }
}

if (failures > 0) {
  console.error(`\n[health] FAIL — ${failures}/${CHECKS.length} checks failed`);
  process.exit(1);
}
console.log(`\n[health] all ${CHECKS.length} checks passed — G-1 checklist green`);
process.exit(0);
