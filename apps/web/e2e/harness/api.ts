/**
 * ── API harness (plan I-5a) ──────────────────────────────────────────────────
 * Thin REST reader for the INDEXED truth layer. Mirrors the frozen `@robbed/
 * shared` contract routes (api.md §3) but returns raw JSON — assertions live in
 * the specs. All responses use the `{ data, error }` envelope (api.md §2).
 */
import { STACK } from "./config";

async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${STACK.apiUrl}${path}`, {
    headers: { accept: "application/json" },
  });
  const json = (await res.json()) as { data: T; error: { code: string } | null };
  if (json.error) throw new Error(`API ${path} → ${json.error.code}`);
  return json.data;
}

export const api = {
  healthz: () => fetch(`${STACK.apiUrl}/v1/healthz`).then((r) => r.ok),
  tokens: (q = "") => get<{ tokens: any[]; nextCursor: string | null }>(`/v1/tokens${q}`),
  // king-of-the-hill wraps the leader as `{ token }` (api.md §3.3) — unwrap it.
  kingOfTheHill: async () => (await get<{ token: any }>(`/v1/tokens/king-of-the-hill`)).token,
  token: (address: string) => get<any>(`/v1/tokens/${address.toLowerCase()}`),
  // /v1/search returns `{ results }`; normalize to `{ tokens }` for the specs.
  search: async (q: string) => {
    const d = await get<{ results: any[] }>(`/v1/search?q=${encodeURIComponent(q)}`);
    return { tokens: d.results ?? [] };
  },
  trades: (address: string, limit = 50) =>
    get<{ trades: any[] }>(`/v1/tokens/${address.toLowerCase()}/trades?limit=${limit}`),
  tradeByTx: (txHash: string) => get<any>(`/v1/trades/${txHash.toLowerCase()}`),
  candles: (address: string, interval: string, from: number, to: number) =>
    get<{ candles: any[] }>(
      `/v1/tokens/${address.toLowerCase()}/candles?interval=${interval}&from=${from}&to=${to}`,
    ),
  holders: (address: string, limit = 20) =>
    get<{ holders: any[] }>(`/v1/tokens/${address.toLowerCase()}/holders?limit=${limit}`),
  // LP fee collections (api.md §3.4) — COLLECT-1's indexed surface.
  fees: (address: string) => get<any>(`/v1/tokens/${address.toLowerCase()}/fees`),
  // ── portfolio reads (api.md §3.4a) — the PORT-* indexed layer ───────────────
  portfolioSummary: (address: string) => get<any>(`/v1/portfolio/${address.toLowerCase()}`),
  portfolioHoldings: (address: string, q = "") =>
    get<{ holdings: any[]; nextCursor: string | null }>(
      `/v1/portfolio/${address.toLowerCase()}/holdings${q}`,
    ),
  portfolioActivity: (address: string, q = "") =>
    get<{ activity: any[]; nextCursor: string | null }>(
      `/v1/portfolio/${address.toLowerCase()}/activity${q}`,
    ),
  portfolioCreated: (address: string, q = "") =>
    get<{ tokens: any[]; nextCursor: string | null }>(
      `/v1/portfolio/${address.toLowerCase()}/created${q}`,
    ),
};

// ── trade-shape adapters (api.md §3.4: `isBuy`, `trader`, `txHash`, `venue`) ──
export const tradeIsBuy = (t: any): boolean => t?.isBuy === true || t?.side === "buy";
export const tradeIsSell = (t: any): boolean => t?.isBuy === false || t?.side === "sell";
export const tradeBy = (t: any, addr: string): boolean =>
  t?.trader?.toLowerCase() === addr.toLowerCase();
export const holderFlags = (h: any): string[] => h?.flags ?? [];

/**
 * Poll the indexer until `predicate(data)` is truthy or the timeout elapses.
 * The indexed layer is eventually-consistent behind the fork; every "indexed"
 * assertion goes through this so specs never race the indexer.
 */
export async function waitForIndexed<T>(
  fetcher: () => Promise<T>,
  predicate: (data: T) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      last = await fetcher();
      if (predicate(last)) return last;
    } catch {
      /* transient — keep polling */
    }
    if (Date.now() > deadline) {
      throw new Error(
        `[e2e] indexer did not reach expected state within ${timeoutMs}ms` +
          (opts.label ? ` (${opts.label})` : ""),
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
