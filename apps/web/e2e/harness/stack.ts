/**
 * ── stack probe (plan I-5a) ──────────────────────────────────────────────────
 * Detects a RUNNING stack (web / API / anvil / ws). The harness never spawns the
 * stack; when it is down, specs `test.skip()` with a clear message rather than
 * failing (RUN-OR-AUTHOR: never fake a pass we didn't observe).
 */
import { STACK } from "./config";

async function ok(fn: () => Promise<boolean>): Promise<boolean> {
  try {
    return await fn();
  } catch {
    return false;
  }
}

async function withTimeout(url: string, init?: RequestInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function probeWeb(): Promise<boolean> {
  return ok(async () => (await withTimeout(STACK.webUrl)).ok);
}

export async function probeApi(): Promise<boolean> {
  return ok(async () => (await withTimeout(`${STACK.apiUrl}/v1/healthz`)).ok);
}

export async function probeAnvil(): Promise<boolean> {
  return ok(async () => {
    const res = await withTimeout(STACK.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
    });
    const json = (await res.json()) as { result?: string };
    return parseInt(json.result ?? "0x0", 16) === 4663;
  });
}

export interface StackStatus {
  web: boolean;
  api: boolean;
  anvil: boolean;
  ready: boolean;
}

let cached: StackStatus | null = null;

export async function stackStatus(): Promise<StackStatus> {
  if (cached) return cached;
  const [web, api, anvil] = await Promise.all([probeWeb(), probeApi(), probeAnvil()]);
  cached = { web, api, anvil, ready: web && api && anvil };
  return cached;
}
