/**
 * Redis pub/sub ↔ WS channel taxonomy (indexer.md §8.1) — single source for
 * the indexer (publisher), the Bun WS server (relay), and the frontend
 * (subscriber).
 *
 * | Channel                            | Content                                            |
 * |------------------------------------|----------------------------------------------------|
 * | global:launches                    | new TokenCreated + graduated announcements (§5.1)  |
 * | global:trades                      | every trade (curve + v3), throttle-ready           |
 * | global:confirmations               | watermark advances + reorg notices (§12.20)        |
 * | token:{address}:trades             | trades for one token (§5.2 feed)                   |
 * | token:{address}:candles:{interval} | candle upsert per trade per interval               |
 * | token:{address}:events             | graduated / metadata_verified / fee_collected / …  |
 *
 * Token addresses in channel names are lowercased (addresses are stored
 * lowercase throughout — indexer.md §3 conventions).
 */
import type { CandleInterval } from "./constants";

export const GLOBAL_LAUNCHES = "global:launches" as const;
export const GLOBAL_TRADES = "global:trades" as const;
export const GLOBAL_CONFIRMATIONS = "global:confirmations" as const;

/** All global channels (WS server does explicit SUBSCRIBE on these). */
export const GLOBAL_CHANNELS = [
  GLOBAL_LAUNCHES,
  GLOBAL_TRADES,
  GLOBAL_CONFIRMATIONS,
] as const;

/** Pattern the WS server PSUBSCRIBEs for per-token channels (indexer.md §8.1). */
export const TOKEN_CHANNEL_PATTERN = "token:*" as const;

export function tokenTrades(address: string): string {
  return `token:${address.toLowerCase()}:trades`;
}

export function tokenCandles(address: string, interval: CandleInterval): string {
  return `token:${address.toLowerCase()}:candles:${interval}`;
}

export function tokenEvents(address: string): string {
  return `token:${address.toLowerCase()}:events`;
}

/**
 * Per-channel monotonic sequence key (indexer.md §8.2: `seq` via Redis
 * `INCR channel:seq` at publish — one Redis op, no DB).
 */
export function channelSeqKey(channel: string): string {
  return `${channel}:seq`;
}
