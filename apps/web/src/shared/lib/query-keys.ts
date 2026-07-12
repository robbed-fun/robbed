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
  trades: (address: string) => ["trades", address.toLowerCase()] as const,
  txTrades: (txHash: string) => ["trades", "tx", txHash.toLowerCase()] as const,
  candles: (address: string, interval: CandleInterval) =>
    ["candles", address.toLowerCase(), interval] as const,
  holders: (address: string) => ["holders", address.toLowerCase()] as const,
  search: (q: string) => ["search", q] as const,
  confirmations: () => ["confirmations"] as const,
  ethUsd: () => ["eth-usd"] as const,
  stats: () => ["stats"] as const,
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
