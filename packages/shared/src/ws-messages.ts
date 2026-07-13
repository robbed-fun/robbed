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

/**
 * `fee_collected` on `token:{address}:events` (findings X-6; channel taxonomy
 * promised it, the union was missing it → fee-dashboard live updates were
 * silently dropped). Projection of the on-chain `LPFeeVault.Collect` /
 * `FeeCollected` event and the REST `feeCollectionEntrySchema` (api-types.ts):
 * the same fee-collection shape drives REST and WS, so the `/fees` dashboard
 * reads identical fields whether it hydrates from REST or a live push. Block
 * coordinates follow the `trade` payload convention (dedup + confirmation
 * upgrade). Scalars are reused (`addressSchema`/`decimalStringSchema`/
 * `hex32Schema`) — no new fee shape is invented.
 */
export const wsFeeCollectedDataSchema = z.object({
  token: addressSchema,
  recipient: addressSchema,
  amountToken: decimalStringSchema,
  amountWeth: decimalStringSchema,
  blockNumber: z.number().int().nonnegative(),
  blockTimestamp: z.number().int().nonnegative(),
  txHash: hex32Schema,
  logIndex: z.number().int().nonnegative(),
  confirmationState: confirmationStateSchema,
});

/**
 * `creator_fee_split` on `token:{address}:events` (spec §12.69 — LANDED). The post-grad
 * half of the creator leg: `LPFeeVault.collect(tokenId)` emits `FeesSplit` (events.ts
 * `FeesSplitEvent`) — splitting the graduated V3 pool's 1% fees 50/50 creator/treasury
 * on BOTH legs. This projects the split (per launch `token`, keyed via `creatorOf`) so
 * the token page / a creator's claim surface can live-update accrual. Both beneficiaries'
 * per-leg amounts are carried; scalars reuse the token/weth naming of
 * `wsFeeCollectedDataSchema` (indexer resolves raw pool ordering `treasury{0,1}`/
 * `creator{0,1}` → token/weth via `graduations.token_is_token0`). Block coords + a
 * `confirmationState` follow the `fee_collected` convention (dedup + confirmation upgrade).
 * `fee_collected` stays unchanged — it projects the unchanged `FeesCollected` total.
 */
export const wsCreatorFeeSplitDataSchema = z.object({
  token: addressSchema,
  creator: addressSchema,
  /** Creator's 50% share (§12.69), resolved to token/weth legs. */
  creatorAmountToken: decimalStringSchema,
  creatorAmountWeth: decimalStringSchema,
  /** Treasury's 50% share, resolved to token/weth legs. */
  treasuryAmountToken: decimalStringSchema,
  treasuryAmountWeth: decimalStringSchema,
  blockNumber: z.number().int().nonnegative(),
  blockTimestamp: z.number().int().nonnegative(),
  txHash: hex32Schema,
  logIndex: z.number().int().nonnegative(),
  confirmationState: confirmationStateSchema,
});

/**
 * `creator_fee_claimed` on `token:{address}:events` (spec §12.69 — LANDED). A creator
 * pulled an accrued post-grad ERC20 balance from the CreatorVault (`claimERC20(creator,
 * token)`); projects the on-chain `CreatorTokenClaimed` so the Portfolio CreatedTab claim
 * widget reconciles optimistic state against the confirmed payout. SINGLE-asset: `token`
 * is the ERC20 claimed (a graduated launch token OR canonical WETH), `amount` its wei —
 * matching the per-ERC20 claim entrypoint 1:1.
 *
 * NOTE (channel): published on `token:{address}:events` as the default. A WETH claim is
 * a creator-level event (aggregates across the creator's tokens), so the indexer MAY
 * additionally fan claims out on a per-creator channel (`creator:{address}:events`) —
 * an indexer-owned taxonomy call (see channels.ts). The message shape is channel-agnostic.
 */
export const wsCreatorFeeClaimedDataSchema = z.object({
  creator: addressSchema,
  /** The ERC20 claimed — a graduated launch token OR canonical WETH (§12.69 Option-B). */
  token: addressSchema,
  amount: decimalStringSchema,
  blockNumber: z.number().int().nonnegative(),
  blockTimestamp: z.number().int().nonnegative(),
  txHash: hex32Schema,
  logIndex: z.number().int().nonnegative(),
  confirmationState: confirmationStateSchema,
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
  z.object({ ...envelopeBase, type: z.literal("fee_collected"), data: wsFeeCollectedDataSchema }),
  // §12.69 post-grad creator-fee split (DRAFT, parallel with Phase-2) — additive members.
  z.object({ ...envelopeBase, type: z.literal("creator_fee_split"), data: wsCreatorFeeSplitDataSchema }),
  z.object({ ...envelopeBase, type: z.literal("creator_fee_claimed"), data: wsCreatorFeeClaimedDataSchema }),
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
export type WsFeeCollectedData = z.infer<typeof wsFeeCollectedDataSchema>;
export type WsCreatorFeeSplitData = z.infer<typeof wsCreatorFeeSplitDataSchema>;
export type WsCreatorFeeClaimedData = z.infer<typeof wsCreatorFeeClaimedDataSchema>;

// ── Client → server ops (indexer.md §8.1; api.md §6.5: sub/unsub/ping only) ─

export const wsClientOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("sub"), channel: z.string().min(1) }),
  z.object({ op: z.literal("unsub"), channel: z.string().min(1) }),
  z.object({ op: z.literal("ping") }),
]);
export type WsClientOp = z.infer<typeof wsClientOpSchema>;
