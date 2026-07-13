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
  // §12.59: the endpoint migrates to the `Paginated<T>` `{ items, nextCursor }`
  // envelope (robbed-indexer, parallel). Normalize BOTH shapes so specs keep
  // reading `.trades` regardless of migration timing (`items` preferred).
  trades: async (address: string, limit = 50) => {
    const d = await get<{ items?: any[]; trades?: any[] }>(
      `/v1/tokens/${address.toLowerCase()}/trades?limit=${limit}`,
    );
    return { trades: d.items ?? d.trades ?? [] };
  },
  // §12.59: the RAW keyset envelope `{ items, nextCursor }` for the server-sort /
  // pagination flow (TD-13). Unlike `trades` above it preserves `nextCursor` and
  // forwards the allowlisted `sort`/`dir` + the opaque `cursor` verbatim, so a spec
  // can assert the SERVER order changes and the opaque cursor keyset-paginates.
  tradesPage: (
    address: string,
    opts: { sort?: string; dir?: string; cursor?: string; limit?: number } = {},
  ) => {
    const qs = new URLSearchParams();
    if (opts.sort) qs.set("sort", opts.sort);
    if (opts.dir) qs.set("dir", opts.dir);
    if (opts.cursor) qs.set("cursor", opts.cursor);
    if (opts.limit) qs.set("limit", String(opts.limit));
    const q = qs.toString();
    return get<{ items: any[]; nextCursor: string | null }>(
      `/v1/tokens/${address.toLowerCase()}/trades${q ? `?${q}` : ""}`,
    );
  },
  // `/v1/trades/:txHash` returns ALL Trade rows in the tx as `{ trades: [...] }`
  // (a create-with-initial-buy tx has two); unwrap the first for single-trade specs.
  tradeByTx: async (txHash: string) => {
    const d = await get<{ trades: any[] }>(`/v1/trades/${txHash.toLowerCase()}`);
    return d.trades?.[0];
  },
  candles: (address: string, interval: string, from: number, to: number) =>
    get<{ candles: any[] }>(
      `/v1/tokens/${address.toLowerCase()}/candles?interval=${interval}&from=${from}&to=${to}`,
    ),
  // §12.59: migrates to `Paginated<HolderRow>` `{ items, nextCursor }`. Normalize
  // both shapes so specs keep reading `.holders` across the migration.
  holders: async (address: string, limit = 20) => {
    const d = await get<{ items?: any[]; holders?: any[] }>(
      `/v1/tokens/${address.toLowerCase()}/holders?limit=${limit}`,
    );
    return { holders: d.items ?? d.holders ?? [] };
  },
  // LP fee collections (api.md §3.4) — COLLECT-1's indexed surface.
  fees: (address: string) => get<any>(`/v1/tokens/${address.toLowerCase()}/fees`),
  // ── creator-fee claim reads (api.md §3 / spec §12.63 / §12.69) — the CFEE-1/2
  // INDEXED layer. Both endpoints return the AUTHORITATIVE live vault balance
  // (CreatorVault.balanceOf / tokenBalanceOf) once the indexer has materialized a
  // `creator_claimable` / `creator_token_claimable` roll-up row for the (creator[,
  // token]) — before any accrual they 404 (no vault to read), so poll via
  // `waitForIndexed` (which swallows the throw) after a real sweep/collect.
  creatorClaimable: (address: string) =>
    get<{
      creator: string;
      vault: string;
      claimableEth: string;
      totalAccruedEth: string;
      totalClaimedEth: string;
    }>(`/v1/creators/${address.toLowerCase()}/claimable`),
  creatorTokenClaimable: (address: string, token: string) =>
    get<{
      creator: string;
      token: string;
      vault: string;
      claimable: string;
      totalAccrued: string;
      totalClaimed: string;
    }>(`/v1/creators/${address.toLowerCase()}/claimable/${token.toLowerCase()}`),
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
