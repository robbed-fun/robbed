/**
 * REST response/request DTO schemas + types (api.md §2, §3, §5) — single
 * source: the API shapes responses with these, the frontend imports them and
 * never redeclares.
 *
 * Conventions (api.md §2):
 * - envelope `{ data, error: null } | { data: null, error: { code, message } }`;
 * - all uint256 values as decimal strings;
 * - every event-derived object carries `confirmationState` (§2.1);
 * - every USD-derived field is `{ usd, ethUsd, asOf }` computed at request
 *   time from `eth_usd_snapshots` — never a constant (§2); `stale: true` added
 *   when the snapshot is older than 5 minutes;
 * - cursor pagination: `?cursor=&limit=` (limit ≤ 100, default 50).
 */
import { z } from "zod";
import { confirmationStateSchema } from "./confirmation";
import {
  CANDLE_INTERVALS,
  LP_COPY,
  METADATA_DESCRIPTION_MAX,
  METADATA_NAME_MAX,
  METADATA_TICKER_MAX,
} from "./constants";
import { byteBoundedString } from "./text";
import {
  addressSchema,
  decimalStringSchema,
  hex32Schema,
  venueSchema,
} from "./ws-messages";

// ── Envelope & errors (api.md §2) ───────────────────────────────────────────

/**
 * Closed set of `error.code` values the API emits — the enumeration the API
 * flagged as belonging in shared (api.md §5 "error codes"; §3.1 upload 4xx =
 * oversized/unsupported_type/decode_failed; §6.3 rate limiting; plus the generic
 * envelope codes). SINGLE SOURCE: this is the only place the code vocabulary is
 * defined; both `errorCodeSchema` (validation) and `ERROR_CODES` (producer
 * ergonomics) derive from this tuple, and `apiEnvelopeSchema`'s error arm is
 * typed by it — a new code MUST be added here (and in openapi.yaml `Error.code`)
 * so producer/consumer can never drift.
 *
 * RATIFIED additions (2026-07-10; api.md §5 disposition, flagged by the API
 * track in apps/api/src/lib/errors.ts + routes/health.ts):
 * - `upstream_unavailable` — unexpected internal 500 and the `/v1/readyz` 503
 *   path (a dependency — DB/Redis/R2 — is down). The frozen set had no
 *   service-unavailable member, so the API used it as a bare string literal
 *   (`INTERNAL_ERROR_CODE`) pending this ratification.
 * - `conflict` — request conflicts with our stored state (e.g. a metadata
 *   `imageHash` that references no object we produced). The API previously had
 *   to fold this into `invalid_request`; it can now map to a distinct 409.
 */
export const ERROR_CODE_VALUES = [
  "oversized",
  "unsupported_type",
  "decode_failed",
  "rate_limited",
  "not_found",
  "invalid_request",
  "unauthorized",
  "upstream_unavailable",
  "conflict",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODE_VALUES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Map form for producers (`ERROR_CODES.not_found`), keyed by the same tuple. */
export const ERROR_CODES = Object.fromEntries(
  ERROR_CODE_VALUES.map((c) => [c, c]),
) as { [K in ErrorCode]: K };

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export function apiEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.union([
    z.object({ data, error: z.null() }),
    z.object({ data: z.null(), error: apiErrorSchema }),
  ]);
}
export type ApiEnvelope<T> =
  | { data: T; error: null }
  | { data: null; error: ApiError };

/** Cursor for list endpoints; null when exhausted. */
export const nextCursorSchema = z.string().nullable();

// ── Shared value objects ────────────────────────────────────────────────────

/** USD-derived field (api.md §2) — computed at request time, never constant. */
export const usdValueSchema = z.object({
  usd: z.string(),
  ethUsd: z.string(),
  asOf: z.string(), // ISO-8601 snapshot timestamp
  stale: z.literal(true).optional(), // present iff snapshot older than 5 min
});
export type UsdValue = z.infer<typeof usdValueSchema>;

export const moderationVisibilitySchema = z.enum([
  "visible",
  "pending_review",
  "hidden",
]);
export const metadataVerificationStatusSchema = z.enum([
  "match",
  "mismatch",
  "unfetched",
]);
/** Derived, not stored (indexer.md §3.2): venue/status pill driver. */
export const tokenStatusSchema = z.enum(["curve", "graduating", "graduated"]);
export const candleIntervalParamSchema = z.enum(CANDLE_INTERVALS);

// ── TokenCard (api.md §3.4 GET /v1/tokens; §5.1 card fields) ────────────────

export const tokenCardSchema = z.object({
  address: addressSchema,
  name: z.string(),
  ticker: z.string(),
  imageUrl: z.string().nullable(), // null until metadata fetched (indexer.md §3.1)
  creator: addressSchema,
  createdAt: z.number().int().nonnegative(), // block timestamp, unix seconds
  priceEth: z.number().nullable(), // display-only float; null before first trade
  mcap: usdValueSchema,
  /**
   * Native ETH market cap, wei decimal string (decisions.md §7.2 item 3 —
   * OPTIONAL refinement). ETH-first display source (§2): OG images / cards render
   * mcap in ETH from THIS field with no client-side `usd / ethUsd` division; the
   * USD `mcap` above derives FROM it (`mcapEth × ethUsd`). Additive + `.optional()`
   * so it is non-breaking: absent until the indexer materializes it into the card
   * projection; when present it is authoritative. Not part of the OpenAPI
   * `required` set for the same reason.
   */
  mcapEth: decimalStringSchema.optional(),
  progressPct: z.number(), // real_eth_reserves / graduation_eth (pre-grad)
  change24hPct: z.number().nullable(),
  volume24h: decimalStringSchema, // ETH wei (volume_eth_24h)
  graduated: z.boolean(),
  status: tokenStatusSchema,
  confirmationState: confirmationStateSchema,
  moderation: z.object({
    visibility: moderationVisibilitySchema,
    impersonationFlag: z.boolean(),
  }),
});
export type TokenCard = z.infer<typeof tokenCardSchema>;

// ── TokenDetail (api.md §3.4 GET /v1/tokens/:address — §5.2 + Trust panel) ──

/**
 * Organic-flow metrics (v1.2 — spec §5.2/§8.5; DATA-GAP-1). Sourced from the
 * indexer's `token_flow_stats` (db-rows.ts `TokenFlowStatsRow`); advisory /
 * heuristic — NEVER gates chain state (§8.4/§8.5). The organic-holder estimate
 * is a RANGE (`holderPctLow`..`holderPctHigh`), never a point value — false
 * precision is forbidden (§5.2). `updatedAt` is null until the stats job first
 * runs; the whole block is nullable while `token_flow_stats` has no row yet.
 */
export const organicFlowSchema = z.object({
  holderPctLow: z.number(),
  holderPctHigh: z.number(),
  volumePct: z.number(), // organic-volume % (wash-flagged volume excluded, §8.5)
  flaggedClusterVolPct24h: z.number(), // flagged-cluster share of 24h curve volume
  methodology: z.string(), // tooltip source, e.g. "heuristic — see §8.5"
  updatedAt: z.string().nullable(),
});
export type OrganicFlow = z.infer<typeof organicFlowSchema>;

export const trustPanelSchema = z.object({
  metadataVerification: z.object({
    status: metadataVerificationStatusSchema,
    onchainHash: hex32Schema,
    computedHash: hex32Schema.optional(),
    verifiedAt: z.string().optional(),
  }),
  /** Exact canonical string (spec §12.14; CLAUDE.md hard rule). */
  lpCopy: z.literal(LP_COPY),
  feePolicy: z.object({
    tradeFeeBps: z.number().int().nonnegative(),
    /** Present from day 1, value 0 in v1 (§7). */
    creatorFeeBps: z.number().int().nonnegative(),
  }),
  /** v1.2 organic-flow metrics (§5.2/§8.5); null until stats computed. */
  organic: organicFlowSchema.nullable(),
});
export type TrustPanel = z.infer<typeof trustPanelSchema>;

export const tokenDetailSchema = tokenCardSchema.extend({
  description: z.string().nullable(),
  links: z
    .object({
      website: z.string().optional(),
      x: z.string().optional(),
      telegram: z.string().optional(),
    })
    .nullable(),
  curveAddress: addressSchema,
  v3PoolAddress: addressSchema.optional(),
  graduatedAt: z.number().int().nonnegative().optional(),
  supply: z.object({
    total: decimalStringSchema,
    curveHeld: decimalStringSchema,
    lpTranche: decimalStringSchema,
  }),
  /** Live curve state (Trust panel §5.2). */
  reserves: z.object({
    virtualEth: decimalStringSchema,
    virtualToken: decimalStringSchema,
    realEth: decimalStringSchema,
    realToken: decimalStringSchema,
  }),
  graduation: z.object({
    thresholdEth: decimalStringSchema,
    progressPct: z.number(),
  }),
  trust: trustPanelSchema,
  /**
   * RATIFIED (findings X-13 disposition, 2026-07-09; api.md §3.4): TokenDetail's
   * `creator` is the `{ address, tokensCreated }` profile object and supersedes
   * the card's plain `creator` address — the address is inside the object, so no
   * information is lost. Not a discrepancy; the shape is settled.
   */
  creator: z.object({
    address: addressSchema,
    tokensCreated: z.number().int().nonnegative(),
  }),
  moderation: z.object({
    visibility: moderationVisibilitySchema,
    impersonationFlag: z.boolean(),
    impersonationTicker: z.string().optional(),
  }),
});
export type TokenDetail = z.infer<typeof tokenDetailSchema>;

// ── Trades (api.md §3.4) ────────────────────────────────────────────────────

/**
 * Trade feed row. Fields per indexer.md §3.2 `trades` (api.md does not
 * re-enumerate; "Each row includes venue + confirmationState"). camelCase
 * projection of the unified curve+v3 table.
 */
export const tradeRowSchema = z.object({
  id: z.string(), // `${txHash}-${logIndex}`
  token: addressSchema,
  trader: addressSchema,
  venue: venueSchema,
  isBuy: z.boolean(),
  ethAmount: decimalStringSchema,
  tokenAmount: decimalStringSchema,
  feeEth: decimalStringSchema, // "0" for v3 rows
  priceEth: z.number(),
  blockNumber: z.number().int().nonnegative(),
  blockTimestamp: z.number().int().nonnegative(),
  txHash: hex32Schema,
  logIndex: z.number().int().nonnegative(),
  confirmationState: confirmationStateSchema,
});
export type TradeRow = z.infer<typeof tradeRowSchema>;

// ── Candles (api.md §3.4; venue-continuous by construction) ─────────────────

export const candleSchema = z.object({
  bucketStart: z.number().int().nonnegative(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volumeEth: decimalStringSchema,
  volumeToken: decimalStringSchema,
  tradeCount: z.number().int().nonnegative(),
});
export type Candle = z.infer<typeof candleSchema>;

// ── Holders (api.md §3.4 GET /v1/tokens/:address/holders) ───────────────────

export const holderFlagSchema = z.enum(["creator", "curve", "lp_pool", "vault"]);

/**
 * Advisory bot/farm labels (v1.2 — spec §8.5; DATA-GAP-1). SINGLE SOURCE for
 * the §8.5 flag vocabulary: the indexer's `address_flags.flags` (db-rows.ts
 * `AddressFlagsRow` imports `BotFlag` from here) and the holder-list projection
 * both use it, so the wire and the table can't diverge. Labeling only — never
 * gates any chain interaction or listing (§8.4/§8.5).
 */
export const botFlagSchema = z.enum([
  "farm",
  "sniper",
  "programmatic",
  "wash",
  "arb_exit",
]);
export type BotFlag = z.infer<typeof botFlagSchema>;

export const holderRowSchema = z.object({
  address: addressSchema,
  balance: decimalStringSchema,
  pct: z.number(),
  flags: z.array(holderFlagSchema),
  /** v1.2 advisory §8.5 labels; absent when the address carries no bot flag. */
  botFlags: z.array(botFlagSchema).optional(),
  /** Shared gas-funder cluster id → grouped on the holder list (§5.2). */
  clusterId: z.string().optional(),
});
export type HolderRow = z.infer<typeof holderRowSchema>;

// ── Response payloads (api.md §3.3-§3.5) ────────────────────────────────────

export const tokensResponseSchema = z.object({
  tokens: z.array(tokenCardSchema),
  nextCursor: nextCursorSchema,
});
export const kingOfTheHillResponseSchema = z.object({
  token: tokenCardSchema.nullable(), // null when no pre-grad tokens exist
});
export const searchResponseSchema = z.object({
  results: z.array(tokenCardSchema), // same card projection as /tokens (api.md §3.3)
});
export type SearchResult = TokenCard;

export const tradesResponseSchema = z.object({
  trades: z.array(tradeRowSchema),
  nextCursor: nextCursorSchema,
});
/** GET /v1/trades/:txHash — all Trade rows in that tx (api.md §3.4). */
export const txTradesResponseSchema = z.object({
  trades: z.array(tradeRowSchema),
});
export const candlesResponseSchema = z.object({
  candles: z.array(candleSchema),
});
export const holdersResponseSchema = z.object({
  holders: z.array(holderRowSchema),
  holderCount: z.number().int().nonnegative(),
});

/** GET /v1/tokens/:address/fees (api.md §3.4; per-collection rows from fee_collections). */
export const feeCollectionEntrySchema = z.object({
  id: z.string(),
  amountToken: decimalStringSchema,
  amountWeth: decimalStringSchema,
  recipient: addressSchema,
  blockTimestamp: z.number().int().nonnegative(),
  txHash: hex32Schema,
  confirmationState: confirmationStateSchema,
});
export const feesResponseSchema = z.object({
  collected: z.object({
    token: decimalStringSchema,
    weth: decimalStringSchema,
    byCollection: z.array(feeCollectionEntrySchema),
  }),
  uncollected: z.object({
    token: decimalStringSchema,
    weth: decimalStringSchema,
    asOf: z.string(), // live NPM tokensOwed read via RPC, cached 60s
  }),
});

/** GET /v1/stats (api.md §3.4 — "tokens launched, graduations, 24h volume, treasury fees collected"). */
export const statsResponseSchema = z.object({
  tokensLaunched: z.number().int().nonnegative(),
  graduations: z.number().int().nonnegative(),
  volume24hEth: decimalStringSchema,
  volume24h: usdValueSchema,
  treasuryFeesCollectedWeth: decimalStringSchema,
  treasuryFeesCollected: usdValueSchema,
});

/** GET /v1/confirmations (api.md §3.5; SSR initial state). */
export const confirmationsResponseSchema = z.object({
  safeBlock: z.number().int().nonnegative(),
  finalizedBlock: z.number().int().nonnegative(),
  latestBlock: z.number().int().nonnegative(),
  updatedAt: z.string(),
});

/** GET /v1/eth-usd (api.md §3.5) — live-or-dated source, never a constant (§2). */
export const ethUsdResponseSchema = z.object({
  price: z.number(),
  source: z.string(), // e.g. 'chainlink:4663', 'defillama'
  asOf: z.string(),
});

// ── Launch flow (api.md §3.1, §3.2) ─────────────────────────────────────────

/** 200 of POST /v1/uploads/image. */
export const uploadImageResponseSchema = z.object({
  imageUrl: z.string(),
  imageHash: hex32Schema, // keccak256 of the RE-ENCODED bytes (canonical image)
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
});

/** Request body of POST /v1/metadata (api.md §3.2; server adds the version tag). */
export const metadataRequestSchema = z.object({
  // Byte-length limits (§12.30) — same on-chain-mirroring refinement as the
  // metadata document schema, sourced from the same constants (no parallel cap).
  name: byteBoundedString(METADATA_NAME_MAX, "name"),
  ticker: byteBoundedString(METADATA_TICKER_MAX, "ticker"),
  description: z.string().max(METADATA_DESCRIPTION_MAX).optional(),
  links: z
    .object({
      website: z.url().optional(),
      x: z.url().optional(),
      telegram: z.url().optional(),
    })
    .optional(),
  imageUrl: z.url(), // must be our CDN origin (server-enforced)
  imageHash: z.string().regex(/^0x[0-9a-f]{64}$/), // must match an object we produced
});
export type MetadataRequest = z.infer<typeof metadataRequestSchema>;

/**
 * 200 of POST /v1/metadata. The client MUST re-verify `metadataHash` against
 * its own `metadataHash(JSON.parse(canonicalJson))` computation with the
 * shared canonicalizer before signing the tx (spec §12.19 — normative for M3).
 */
export const metadataResponseSchema = z.object({
  metadataHash: hex32Schema,
  metadataUri: z.string(),
  canonicalJson: z.string(),
});

// ── Admin (api.md §3.6) ─────────────────────────────────────────────────────

export const adminVisibilityRequestSchema = z.object({
  visibility: z.enum(["visible", "hidden"]), // admin can hide listings ONLY (§8.4)
  reason: z.string().min(1),
});
export const adminImpersonationRequestSchema = z.object({
  flagged: z.boolean(),
  ticker: z.string().optional(),
  reason: z.string().min(1),
});

/**
 * Moderation queue item (api.md §3.6: "token, image, metadata, vendor scores,
 * impersonation match, current visibility" — projection of moderation_status
 * joined to tokens; exact enumeration is this schema).
 */
export const moderationQueueItemSchema = z.object({
  tokenAddress: addressSchema,
  name: z.string(),
  ticker: z.string(),
  imageUrl: z.string().nullable(),
  metadataUri: z.string().nullable(),
  nsfwScore: z.number().nullable(),
  csamFlag: z.boolean(),
  impersonationFlag: z.boolean(),
  impersonationTicker: z.string().nullable(),
  visibility: moderationVisibilitySchema,
  updatedAt: z.string(),
});
export const moderationQueueResponseSchema = z.object({
  items: z.array(moderationQueueItemSchema),
  nextCursor: nextCursorSchema,
});

/** Audit-log entry (api.md §6.2: actor, action, target, reason, ts). */
export const auditLogEntrySchema = z.object({
  actor: z.string(),
  action: z.string(),
  target: z.string(),
  reason: z.string().nullable(),
  ts: z.string(),
});
export const auditLogResponseSchema = z.object({
  entries: z.array(auditLogEntrySchema),
  nextCursor: nextCursorSchema,
});

// ── Query enums (api.md §3.4) ───────────────────────────────────────────────

export const tokenSortSchema = z.enum([
  "trending",
  "newest",
  "mcap",
  "volume24h",
  "progress",
]);
export const tokenFilterSchema = z.enum(["pregrad", "graduated", "all"]);
