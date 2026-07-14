/**
 * Redis pub/sub ↔ WS channel taxonomy (indexer.md) — single source for
 * the indexer (publisher), the Bun WS server (relay), and the frontend
 * (subscriber).
 *
 * | Channel                            | Content                                            |
 * |------------------------------------|----------------------------------------------------|
 * | global:launches | new TokenCreated + graduated announcements |
 * | global:trades                      | every trade (curve + v3), throttle-ready           |
 * | global:confirmations | watermark advances + reorg notices |
 * | token:{address}:trades | trades for one token (feed) |
 * | token:{address}:candles:{interval} | candle upsert per trade per interval               |
 * | token:{address}:events             | graduated / metadata_verified / fee_collected / … |
 *
 * Token addresses in channel names are lowercased (addresses are stored
 * lowercase throughout — indexer.md conventions).
 */
import { z } from "zod";
import type { CandleInterval } from "./constants";
import { addressSchema } from "./ws-messages";

export const GLOBAL_LAUNCHES = "global:launches" as const;
export const GLOBAL_TRADES = "global:trades" as const;
export const GLOBAL_CONFIRMATIONS = "global:confirmations" as const;

/**
 * Admin re-verify control channel (findings X-9). `metadata_verifications` is
 * indexer-owned and the API is read-only on it, so `POST /v1/admin/metadata/
 * :token/reverify` (api.md) does NOT write the table — it publishes
 * `{ token }` here; the indexer's verifier subscribes, re-queues the row, and
 * remains the SOLE writer (indexer.md admin re-verify seam). Not a WS
 * client channel — this is service↔service on Redis, so the payload is a Zod
 * schema (anti-drift rule 2) shared by publisher (api) and subscriber (indexer).
 */
export const CONTROL_REVERIFY = "control:reverify" as const;

export const controlReverifySchema = z.object({
  token: addressSchema,
});
export type ControlReverify = z.infer<typeof controlReverifySchema>;

/** All global channels (WS server does explicit SUBSCRIBE on these). */
export const GLOBAL_CHANNELS = [
  GLOBAL_LAUNCHES,
  GLOBAL_TRADES,
  GLOBAL_CONFIRMATIONS,
] as const;

/** Pattern the WS server PSUBSCRIBEs for per-token channels (indexer.md). */
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
 * post-grad creator-fee fan-out (LANDED — default taxonomy):
 * `creator_fee_split` / `creator_fee_claimed` (ws-messages.ts) publish on
 * `token:{address}:events` above — the split is per launch `token`, so it fits the
 * per-token taxonomy with zero new channel. Post-grad claims are per-ERC20
 * (`claimERC20(creator, token)`); a WETH claim is a creator-level event (aggregates
 * across the creator's graduated tokens), so the indexer MAY additionally add a
 * per-creator channel (`creator:{address}:events`) for the Portfolio CreatedTab live
 * claim surface. That remains an indexer-OWNED taxonomy decision (indexer.md) —
 * intentionally NOT invented here; the WS message shapes are channel-agnostic.
 */

/**
 * Per-channel monotonic sequence key (indexer.md : `seq` via Redis
 * `INCR channel:seq` at publish — one Redis op, no DB).
 */
export function channelSeqKey(channel: string): string {
  return `${channel}:seq`;
}
