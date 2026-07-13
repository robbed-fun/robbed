import type { CandleInterval } from "@robbed/shared";

/**
 * TanStack Query key factory (docs-first: tanstack.com/query/latest, v5, verified
 * 2026-07-10). Keys are structured so the WS layer can invalidate whole families
 * on reconnect / seq-gap without knowing individual params.
 *
 * The first tuple element is the "family" prefix; `LIVE_QUERY_PREFIXES` lists
 * every family that WS patches, so `lib/ws` can invalidate them all on reconnect
 * (web.md §2.5 — WS is a patch stream, REST is resumable truth).
 */
export const qk = {
  tokens: (params?: Record<string, unknown>) =>
    params ? (["tokens", params] as const) : (["tokens"] as const),
  token: (address: string) => ["token", address.toLowerCase()] as const,
  /**
   * Trades feed. The bare key is the WS-live, SSR-seeded DEFAULT window (age
   * DESC, page 1) — the only key WS patches. A sorted/paginated view (§12.59) is
   * a distinct REST snapshot keyed by its params, so it never collides with the
   * live head; `LIVE_QUERY_PREFIXES` still invalidates ALL "trades" on reconnect.
   */
  trades: (
    address: string,
    params?: { sort: string; dir: string; cursor: string | null },
  ) =>
    params
      ? (["trades", address.toLowerCase(), params] as const)
      : (["trades", address.toLowerCase()] as const),
  txTrades: (txHash: string) => ["trades", "tx", txHash.toLowerCase()] as const,
  candles: (address: string, interval: CandleInterval) =>
    ["candles", address.toLowerCase(), interval] as const,
  /** Holders — bare key = default RANK/amount-DESC page 1; params = sorted view. */
  holders: (
    address: string,
    params?: { sort: string; dir: string; cursor: string | null },
  ) =>
    params
      ? (["holders", address.toLowerCase(), params] as const)
      : (["holders", address.toLowerCase()] as const),
  search: (q: string) => ["search", q] as const,
  confirmations: () => ["confirmations"] as const,
  ethUsd: () => ["eth-usd"] as const,
  stats: () => ["stats"] as const,
  /** Creator-fee claimable roll-up (§7/§12.63) — per creator address (pre-grad ETH leg). */
  creatorClaimable: (address: string) =>
    ["creator-claimable", address.toLowerCase()] as const,
  /**
   * Post-grad creator LP-fee per-`(creator, ERC20)` claimable rows (§12.69) —
   * served by the indexer `token-claimable` endpoint. Invalidated live by the
   * `creator_fee_split` / `creator_fee_claimed` WS types.
   */
  creatorTokenClaimable: (address: string) =>
    ["creator-token-claimable", address.toLowerCase()] as const,
  /** Post-grad creator claimable read live from `CreatorVault.tokenBalanceOf` (§12.69 fallback). */
  creatorTokenClaimableChain: (address: string) =>
    ["creator-token-claimable-chain", address.toLowerCase()] as const,
  /** Per-token comments (§12.63b) — bare key = WS-live newest-first list. */
  comments: (address: string) => ["comments", address.toLowerCase()] as const,
} as const;

/**
 * Query families kept live by WS patches — invalidated wholesale on WS reconnect
 * or a `seq` gap (there is no replay buffer; spec §12.23). Proven by
 * tests/ws-reconnect.test.ts.
 */
export const LIVE_QUERY_PREFIXES = [
  "tokens",
  "token",
  "trades",
  "candles",
  "holders",
  "confirmations",
  "stats",
] as const;
