/**
 * WS message schemas (indexer.md §8.2 — normative shapes) — single source for
 * indexer (publisher), Bun WS server (relay), and frontend (consumer).
 *
 * Envelope: `{ v: 1, type, channel, seq, ts, data }`.
 * - `seq` is a per-channel monotonic counter (Redis INCR at publish) enabling
 *   client gap detection; on gap, clients REST-heal (§8.4, spec §12.23 — no
 *   replay buffer in v1).
 * - All uint256 amounts serialize as decimal strings (> JS safe integer).
 * - Every event message carries `confirmationState` — always `soft_confirmed`
 *   at publish time (publish happens in the handler, at head); clients upgrade
 *   locally from `global:confirmations` watermark broadcasts (spec §12.20).
 */
import { z } from "zod";
import { CANDLE_INTERVALS } from "./constants";
import { confirmationStateSchema } from "./confirmation";

// ── Shared wire scalars ─────────────────────────────────────────────────────

/** uint256 as decimal string. */
export const decimalStringSchema = z.string().regex(/^[0-9]+$/);
/** int256 as decimal string (may be negative). */
export const signedDecimalStringSchema = z.string().regex(/^-?[0-9]+$/);
/** Lowercase 0x address (addresses are stored/published lowercase). */
export const addressSchema = z.string().regex(/^0x[0-9a-f]{40}$/);
/** 0x-prefixed 32-byte hex (hashes). */
export const hex32Schema = z.string().regex(/^0x[0-9a-f]{64}$/);

export const candleIntervalSchema = z.enum(CANDLE_INTERVALS);
export const venueSchema = z.enum(["curve", "v3"]);
export type Venue = z.infer<typeof venueSchema>;

// ── Per-type payloads (indexer.md §8.2) ─────────────────────────────────────

export const wsTradeDataSchema = z.object({
  token: addressSchema,
  trader: addressSchema,
  venue: venueSchema,
  isBuy: z.boolean(),
  ethAmount: decimalStringSchema,
  tokenAmount: decimalStringSchema,
  feeEth: decimalStringSchema, // "0" for v3 rows (fee lives in the pool)
  priceEth: z.number(), // display-only float (indexer.md §3.1 note)
  blockNumber: z.number().int().nonnegative(),
  txHash: hex32Schema,
  logIndex: z.number().int().nonnegative(),
  blockTimestamp: z.number().int().nonnegative(),
  confirmationState: confirmationStateSchema,
});

export const wsCandleDataSchema = z.object({
  token: addressSchema,
  interval: candleIntervalSchema,
  bucketStart: z.number().int().nonnegative(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volumeEth: decimalStringSchema,
  tradeCount: z.number().int().nonnegative(),
});

/** Token card projection (indexer.md §8.2 type:'launch'). */
export const wsLaunchDataSchema = z.object({
  address: addressSchema,
  name: z.string(),
  ticker: z.string(),
  creator: addressSchema,
  imageUrl: z.string().optional(), // null until metadata fetched (indexer.md §3.1)
  createdAt: z.number().int().nonnegative(),
  blockNumber: z.number().int().nonnegative(),
  confirmationState: confirmationStateSchema,
});

export const wsGraduatedDataSchema = z.object({
  token: addressSchema,
  pool: addressSchema,
  blockNumber: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
});

/** Watermark broadcast on global:confirmations (spec §12.20 — O(1), no per-row fanout). */
export const wsConfirmationsDataSchema = z.object({
  safeBlock: z.number().int().nonnegative(),
  finalizedBlock: z.number().int().nonnegative(),
});

/** Reorg notice on global:confirmations (indexer.md §5.3). */
export const wsReorgDataSchema = z.object({
  fromBlock: z.number().int().nonnegative(),
});

export const wsMetadataVerifiedDataSchema = z.object({
  token: addressSchema,
  status: z.enum(["match", "mismatch", "unfetched"]),
});

// ── Envelope + discriminated union ──────────────────────────────────────────

const envelopeBase = {
  v: z.literal(1),
  channel: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
} as const;

export const wsMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...envelopeBase, type: z.literal("trade"), data: wsTradeDataSchema }),
  z.object({ ...envelopeBase, type: z.literal("candle"), data: wsCandleDataSchema }),
  z.object({ ...envelopeBase, type: z.literal("launch"), data: wsLaunchDataSchema }),
  z.object({ ...envelopeBase, type: z.literal("graduated"), data: wsGraduatedDataSchema }),
  z.object({ ...envelopeBase, type: z.literal("confirmations"), data: wsConfirmationsDataSchema }),
  z.object({ ...envelopeBase, type: z.literal("reorg"), data: wsReorgDataSchema }),
  z.object({ ...envelopeBase, type: z.literal("metadata_verified"), data: wsMetadataVerifiedDataSchema }),
]);

export type WsMessage = z.infer<typeof wsMessageSchema>;
export type WsMessageType = WsMessage["type"];
export type WsTradeData = z.infer<typeof wsTradeDataSchema>;
export type WsCandleData = z.infer<typeof wsCandleDataSchema>;
export type WsLaunchData = z.infer<typeof wsLaunchDataSchema>;
export type WsGraduatedData = z.infer<typeof wsGraduatedDataSchema>;
export type WsConfirmationsData = z.infer<typeof wsConfirmationsDataSchema>;
export type WsReorgData = z.infer<typeof wsReorgDataSchema>;
export type WsMetadataVerifiedData = z.infer<typeof wsMetadataVerifiedDataSchema>;

// ── Client → server ops (indexer.md §8.1; api.md §6.5: sub/unsub/ping only) ─

export const wsClientOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("sub"), channel: z.string().min(1) }),
  z.object({ op: z.literal("unsub"), channel: z.string().min(1) }),
  z.object({ op: z.literal("ping") }),
]);
export type WsClientOp = z.infer<typeof wsClientOpSchema>;
