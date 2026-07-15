/**
 * REST response/request DTO schemas + types (api.md) — single
 * source: the API shapes responses with these, the frontend imports them and
 * never redeclares.
 *
 * Conventions (api.md):
 * - envelope `{ data, error: null } | { data: null, error: { code, message } }`;
 * - all uint256 values as decimal strings;
 * - every event-derived object carries `confirmationState`;
 * - every USD-derived field is `{ usd, ethUsd, asOf }` computed at request
 * time from `eth_usd_snapshots` — never a constant; `stale: true` added
 *   when the snapshot is older than 5 minutes;
 * - cursor pagination: `?cursor=&limit=` (limit ≤ 100, default 50).
 */
import { z } from "zod";
import { confirmationStateSchema } from "./confirmation";
import {
  CANDLE_INTERVALS,
  isCombinedTradeFeeWithinCap,
  LP_COPY,
  MAX_TRADE_FEE_BPS,
  METADATA_DESCRIPTION_MAX,
  METADATA_NAME_MAX,
  METADATA_TICKER_MAX,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
} from "./constants";
import { byteBoundedString } from "./text";
import {
  addressSchema,
  decimalStringSchema,
  hex32Schema,
  signedDecimalStringSchema,
  venueSchema,
  wsGraduatedDataSchema,
  wsLaunchDataSchema,
  wsTradeDataSchema,
} from "./ws-messages";
import { tokenStatusSchema, type TokenStatus } from "./token-status";

// ── Envelope & errors (api.md) ───────────────────────────────────────────

/**
 * Closed set of `error.code` values the API emits — the enumeration the API
 * flagged as belonging in shared (api.md "error codes"; upload 4xx =
 * oversized/unsupported_type/decode_failed; rate limiting; plus the generic
 * envelope codes). SINGLE SOURCE: this is the only place the code vocabulary is
 * defined; both `errorCodeSchema` (validation) and `ERROR_CODES` (producer
 * ergonomics) derive from this tuple, and `apiEnvelopeSchema`'s error arm is
 * typed by it — a new code MUST be added here (and in openapi.yaml `Error.code`)
 * so producer/consumer can never drift.
 *
 * RATIFIED additions (2026-07-10; api.md disposition, flagged by the API
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

/** USD-derived field (api.md) — computed at request time, never constant. */
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
/**
 * Derived, not stored (indexer.md) venue/status pill driver.
 * MOVED to the cycle-free `token-status.ts` (D-70, 2026-07-14) so `ws-messages.ts`
 * — the lower-level module api-types imports FROM — can reuse it in the new
 * `token_metrics` WS payload without an api-types → ws-messages import cycle.
 * Re-exported here (value + inferred type) so every existing `@robbed/shared` and
 * `./api-types` importer of `tokenStatusSchema` / `TokenStatus` is unchanged.
 */
export { tokenStatusSchema };
export type { TokenStatus };
export const candleIntervalParamSchema = z.enum(CANDLE_INTERVALS);

// ── TokenCard (api.md GET /v1/tokens; card fields) ────────────────

export const tokenCardSchema = z.object({
  address: addressSchema,
  name: z.string(),
  ticker: z.string(),
  imageUrl: z.string().nullable(), // null until metadata fetched (indexer.md)
  /**
   * Card-preview description blurb (NEW — D-70; api.md section 3.4 / web.md section 3.1).
   * The API's `toTokenCard` projection truncates the stored `tokens.description` to
   * TOKEN_CARD_DESCRIPTION_MAX for the card/list variant; `TokenDetail` keeps the FULL
   * description (same `z.string().nullable()` shape — one description shape). Null when
   * the token has no description. NO indexer/DB change: `tokens.description` is already
   * SELECTed (TOKEN_LIST_SELECT) and mapped into `TokenListRow` — only `toTokenCard`
   * must project it (robbed-indexer follow-up; required key ⇒ every card producer emits it).
   */
  description: z.string().nullable(),
  creator: addressSchema,
  createdAt: z.number().int().nonnegative(), // block timestamp, unix seconds
  priceEth: z.number().nullable(), // display-only float; null before first trade
  mcap: usdValueSchema,
  /**
   * Native ETH market cap, wei decimal string (ETH-first refinement ratified
   * 2026-07-10 — OPTIONAL). ETH-first display source : OG images / cards render
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

// ── TokenDetail (api.md GET /v1/tokens/:address — + Trust panel) ──

/**
 * Organic-flow metrics (v1.2 —; DATA-GAP-1). Sourced from the
 * indexer's `token_flow_stats` (db-rows.ts `TokenFlowStatsRow`); advisory /
 * heuristic — NEVER gates chain state. The organic-holder estimate
 * is a RANGE (`holderPctLow`..`holderPctHigh`), never a point value — false
 * precision is forbidden. `updatedAt` is null until the stats job first
 * runs; the whole block is nullable while `token_flow_stats` has no row yet.
 */
export const organicFlowSchema = z.object({
  holderPctLow: z.number(),
  holderPctHigh: z.number(),
  volumePct: z.number(), // organic-volume % (wash-flagged volume excluded)
  flaggedClusterVolPct24h: z.number(), // flagged-cluster share of 24h curve volume
  methodology: z.string(), // tooltip source, e.g. "heuristic estimate — organic-flow scoring"
  updatedAt: z.string().nullable(),
});
export type OrganicFlow = z.infer<typeof organicFlowSchema>;

/**
 * Per-token fee split surfaced on the Trust panel / `/create`.
 * `tradeFeeBps` is the treasury curve fee; `creatorFeeBps` is the ADDITIVE creator
 * leg. Both are per-token snapshots read from `tokens.{trade,creator}_fee_bps`
 * (db-rows.ts) — never the factory-current config (which misreports older curves).
 *
 * UN-FROZEN 2026-07-13 : `creatorFeeBps` is now a first-class NONZERO value
 * on mainnet — the creator-fee generation ships `creatorFeeBps = 50` (0.5%),
 * additive with `tradeFeeBps = 100` (1%) ⇒ 150. The old "hardcoded 0 on mainnet"
 * framing is superseded; reading 0 stays valid (legacy/testnet-only v1 curves), so
 * this is additive/backward-compatible. The refinement enforces the SAME additive
 * hard cap the factory asserts on-chain — `tradeFeeBps + creatorFeeBps ≤
 * MAX_TRADE_FEE_BPS` (200) — via the single shared predicate
 * (`isCombinedTradeFeeWithinCap`, constants.ts), so validator/contract can't drift.
 */
export const feePolicySchema = z
  .object({
    tradeFeeBps: z.number().int().nonnegative(),
    creatorFeeBps: z.number().int().nonnegative(),
  })
  .refine((f) => isCombinedTradeFeeWithinCap(f.tradeFeeBps, f.creatorFeeBps), {
    message: `feePolicy: tradeFeeBps + creatorFeeBps must be ≤ ${MAX_TRADE_FEE_BPS} (hard cap / additive split)`,
  });
export type FeePolicy = z.infer<typeof feePolicySchema>;

export const trustPanelSchema = z.object({
  metadataVerification: z.object({
    status: metadataVerificationStatusSchema,
    onchainHash: hex32Schema,
    computedHash: hex32Schema.optional(),
    verifiedAt: z.string().optional(),
  }),
  /** Exact canonical string (CLAUDE.md hard rule). */
  lpCopy: z.literal(LP_COPY),
  /** Additive treasury + creator fee split, cap-refined. */
  feePolicy: feePolicySchema,
  /** v1.2 organic-flow metrics; null until stats computed. */
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
  /**
   * LP NFT tokenId from the `Graduated` event (indexer.md
   * `graduations.lp_token_id`) — present iff the token has graduated. Additive
   * optional field (2026-07-12, robbed-indexer; robbed-shared-reviewable): lets
   * the /fees surface and clients call `LPFeeVault.collect(tokenId)` without
   * re-reading the raw graduation log (e2e COLLECT-1 gap). uint256 → decimal
   * string, same convention as every other uint256 on the wire.
   */
  lpTokenId: decimalStringSchema.optional(),
  supply: z.object({
    total: decimalStringSchema,
    curveHeld: decimalStringSchema,
    lpTranche: decimalStringSchema,
  }),
  /** Live curve state (Trust panel). */
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
   * RATIFIED (findings X-13 disposition, 2026-07-09; api.md) TokenDetail's
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
  /**
   * Distinct holder count for the token (`tokens.holder_count`, indexer.md)
   * — the TokenHeader "Holders" stat. Additive + `.optional()`
   * (2026-07-12, robbed-indexer; robbed-shared-reviewable — same discipline as
   * `mcapEth` / `lpTokenId`): non-breaking restoration of the aggregate the
   * `/holders` `{ items, nextCursor }` migration dropped from the paged list
   * response. The detail projection always populates it; when present it is
   * authoritative. Not part of the OpenAPI `required` set for the same reason.
   */
  holderCount: z.number().int().nonnegative().optional(),
});
export type TokenDetail = z.infer<typeof tokenDetailSchema>;

// ── Trades (api.md) ────────────────────────────────────────────────────

/**
 * Trade feed row. Fields per indexer.md `trades` (api.md does not
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

// ── Candles (api.md; venue-continuous by construction) ─────────────────

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

// ── Holders (api.md GET /v1/tokens/:address/holders) ───────────────────

export const holderFlagSchema = z.enum(["creator", "curve", "lp_pool", "vault"]);

/**
 * Advisory bot/farm labels (v1.2 —; DATA-GAP-1). SINGLE SOURCE for
 * the flag vocabulary: the indexer's `address_flags.flags` (db-rows.ts
 * `AddressFlagsRow` imports `BotFlag` from here) and the holder-list projection
 * both use it, so the wire and the table can't diverge. Labeling only — never
 * gates any chain interaction or listing.
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
  /**
   * 1-based balance-descending rank of this holder within the token — DERIVED at
   * read time like `pct` (`ROW_NUMBER() OVER (ORDER BY balance::numeric DESC)`),
   * not a stored column. OPTIONAL + additive (2026-07-12, robbed-shared;
   * architect-reviewable — same additive-optional discipline as `mcapEth` /
   * `lpTokenId` / `botFlags`): the redesign's sortable HOLDERS table shows a
   * STABLE rank column even when a page is sorted by a non-balance field
   * (`address` / `label`), where the row's position on the page no longer equals
   * its rank. Absent until an endpoint populates it (the legacy top-20 holders
   * response never sorted by anything but balance, so position == rank there).
   */
  rank: z.number().int().positive().optional(),
  flags: z.array(holderFlagSchema),
  /** v1.2 advisory labels; absent when the address carries no bot flag. */
  botFlags: z.array(botFlagSchema).optional(),
  /** Shared gas-funder cluster id → grouped on the holder list. */
  clusterId: z.string().optional(),
});
export type HolderRow = z.infer<typeof holderRowSchema>;

// ── Portfolio (ROBBED_ redesign page 4 — `/portfolio`) ───────────
// Phase-2 page whose SCHEMA is ready day 1 (/ redesign-plan page-4
// inventory). ETH-first : value/PnL are wei decimal strings, USD mirrors
// derive at request time from `eth_usd_snapshots` (usdValueSchema), never a
// constant. Balances behind these DTOs are Transfer-derived truth (
// disposition 16 / X-4/X-5), never trusted from an external source.

/**
 * Best-effort signed ETH-value range (wei) for PnL where the cost basis is
 * imprecise. NO FALSE PRECISION : the V3-leg cost basis is
 * best-effort until the Phase-2 portfolio (disposition 16), so PnL is
 * expressed as a `low`..`high` range — mirroring the organic-flow low/high
 * convention (organicFlowSchema) — never a point value it can't justify. A
 * precisely-known value sets `low === high` with `confidence: "exact"`. The
 * whole field is `.nullable()` at each DTO site: null when NO cost basis exists
 * at all (e.g. tokens received purely by transfer-in, never bought).
 * Refinement: `low ≤ high` (compared as bigint — values exceed 2^53).
 */
export const ethPnlRangeSchema = z
  .object({
    low: signedDecimalStringSchema, // wei, may be negative
    high: signedDecimalStringSchema, // wei, may be negative
    confidence: z.enum(["exact", "estimated"]),
  })
  .refine(
    (r) => {
      // Defer to the field-level regex when a bound isn't a valid integer
      // string (Zod runs object refinements even after a field check fails).
      try {
        return BigInt(r.low) <= BigInt(r.high);
      } catch {
        return true;
      }
    },
    { message: "ethPnlRange: low must be ≤ high" },
  );
export type EthPnlRange = z.infer<typeof ethPnlRangeSchema>;

/**
 * Compact token reference for portfolio lists (avatar + ticker + venue pill).
 * DERIVED from `tokenCardSchema` via `.pick` — SINGLE SOURCE, so a card-field
 * rename can't drift the ref. Holdings rows carry this; the CREATED tab reuses
 * the full `TokenCard`.
 */
export const tokenRefSchema = tokenCardSchema.pick({
  address: true,
  name: true,
  ticker: true,
  imageUrl: true,
  graduated: true,
  status: true,
});
export type TokenRef = z.infer<typeof tokenRefSchema>;

/**
 * Per-address summary — `GET /v1/portfolio/:address` (Portfolio stat cells:
 * TOTAL VALUE / LOOT ALL-TIME / WALLET ETH + first-seen · trades). The
 * address-object convention (X-13): the subject address is the top-level
 * `address`. This is an aggregate roll-up (not a single event-derived object),
 * so — like `statsResponseSchema` / `holderRowSchema` — it carries NO
 * `confirmationState`.
 */
export const portfolioSummarySchema = z.object({
  address: addressSchema,
  /** Earliest Transfer touching this address (unix sec); null if never seen. */
  firstSeenAt: z.number().int().nonnegative().nullable(),
  /** Curve+V3 trades made by this address. */
  tradeCount: z.number().int().nonnegative(),
  /** Tokens whose `creator` == this address (drives the CREATED tab count). */
  tokensCreated: z.number().int().nonnegative(),
  /** Live native ETH balance, wei — RPC read (chain truth, exact). */
  walletEthBalance: decimalStringSchema,
  /** Sum of priceable holdings' value, wei; "0" when nothing is priceable. */
  totalValueEth: decimalStringSchema,
  /** USD mirror of `totalValueEth` (derived at request time). */
  totalValue: usdValueSchema,
  /**
   * All-time PnL ("LOOT") = realized + unrealized, best-effort range; null when
   * no cost basis exists at all (/ disposition 16).
   */
  pnlAllTime: ethPnlRangeSchema.nullable(),
});
export type PortfolioSummary = z.infer<typeof portfolioSummarySchema>;

/**
 * Holdings list item — `GET /v1/portfolio/:address/holdings` (HOLDINGS table:
 * TOKEN / BALANCE / PRICE / VALUE / PNL). Backed by the EXISTING db-rows
 * `BalanceRow` (per (token, holder): balance + cost-basis accumulators) joined
 * to the token projection — NOT a new row (anti-drift: `BalanceRow` already is
 * the holding). `balance` is Transfer-truth; `priceEth`/`valueEth`/`value` are
 * null when the token has never traded (indexer can't price it — no false
 * precision), and `unrealizedPnl` is null when there is no cost basis.
 */
export const portfolioHoldingSchema = z.object({
  token: tokenRefSchema,
  /** Current balance, wei — Transfer-truth (`BalanceRow.balance`). */
  balance: decimalStringSchema,
  /** Display price, ETH float; null before the token's first trade. */
  priceEth: z.number().nullable(),
  /** `balance × priceEth`, wei; null when unpriceable (`priceEth` null). */
  valueEth: decimalStringSchema.nullable(),
  /** USD mirror of `valueEth` (derived); null when unpriceable. */
  value: usdValueSchema.nullable(),
  /** Unrealized PnL best-effort range, wei; null when no cost basis. */
  unrealizedPnl: ethPnlRangeSchema.nullable(),
});
export type PortfolioHolding = z.infer<typeof portfolioHoldingSchema>;

// ── Response payloads (api.md) ────────────────────────────────────

export const tokensResponseSchema = z.object({
  tokens: z.array(tokenCardSchema),
  nextCursor: nextCursorSchema,
});
export const kingOfTheHillResponseSchema = z.object({
  token: tokenCardSchema.nullable(), // null when no pre-grad tokens exist
});
export const searchResponseSchema = z.object({
  results: z.array(tokenCardSchema), // same card projection as /tokens (api.md)
});
export type SearchResult = TokenCard;

export const tradesResponseSchema = z.object({
  trades: z.array(tradeRowSchema),
  nextCursor: nextCursorSchema,
});
/** GET /v1/trades/:txHash — all Trade rows in that tx (api.md). */
export const txTradesResponseSchema = z.object({
  trades: z.array(tradeRowSchema),
});

// ── Discover event feed / tape (GET /v1/events) ──────────────────────────────
//
// PROPOSAL (routed to robbed-shared for ratification) — added by robbed-indexer
// to close the "graduation never appears on the Discover tape" gap: the tape
// (`apps/web/src/widgets/event-tape`) had NO server-side historical seed for
// GRADUATE/TRADE rows — it seeded LAUNCH rows from `/v1/tokens` and otherwise
// relied on live WS (no replay; backfill-suppressed for already-indexed events).
// The tape's own model note asked for exactly this endpoint. Shapes REUSE the
// existing WS payloads verbatim (`wsLaunchDataSchema` / `wsTradeDataSchema` /
// `wsGraduatedDataSchema`) so a REST-seeded row and a live-WS row are the SAME
// shape — the frontend maps both with its existing launchToEvent/tradeToEvent/
// graduateToEvent, no second shape invented (anti-drift). No new field-level
// primitive is introduced here.
export const eventFeedFilterSchema = z.enum(["all", "launches", "trades", "graduations"]);
export type EventFeedFilter = z.infer<typeof eventFeedFilterSchema>;

/**
 * One row of the merged Discover feed. `type` discriminates; `data` is the
 * matching existing WS payload (launch/trade/graduated), so REST seed and WS
 * stream carry identical row shapes.
 */
export const eventFeedRowSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("launch"), data: wsLaunchDataSchema }),
  z.object({ type: z.literal("trade"), data: wsTradeDataSchema }),
  z.object({ type: z.literal("graduated"), data: wsGraduatedDataSchema }),
]);
export type EventFeedRow = z.infer<typeof eventFeedRowSchema>;

/**
 * GET /v1/events?type=all|launches|trades|graduations — newest-first, keyset
 * cursor over the globally-unique `(blockNumber, logIndex)` composite. Powers
 * the Discover tape's server-side seed across ALL tabs incl. GRADUATIONS.
 */
export const eventsResponseSchema = z.object({
  events: z.array(eventFeedRowSchema),
  nextCursor: nextCursorSchema,
});
export type EventsResponse = z.infer<typeof eventsResponseSchema>;
export const candlesResponseSchema = z.object({
  candles: z.array(candleSchema),
});
export const holdersResponseSchema = z.object({
  holders: z.array(holderRowSchema),
  holderCount: z.number().int().nonnegative(),
});

// ── Portfolio responses (`/portfolio` HOLDINGS/ACTIVITY/CREATED) ──
/** GET /v1/portfolio/:address/holdings — cursor-paginated HOLDINGS tab. */
export const portfolioHoldingsResponseSchema = z.object({
  holdings: z.array(portfolioHoldingSchema),
  nextCursor: nextCursorSchema,
});
/**
 * GET /v1/portfolio/:address/activity — ACTIVITY tab. REUSES the shared
 * `tradeRowSchema` (per-address slice of the trade feed) — no parallel shape.
 */
export const portfolioActivityResponseSchema = z.object({
  activity: z.array(tradeRowSchema),
  nextCursor: nextCursorSchema,
});
/**
 * GET /v1/portfolio/:address/created — CREATED tab. REUSES the `tokenCardSchema`
 * projection (tokens whose `creator` == the address); same card as `/tokens`.
 */
export const portfolioCreatedResponseSchema = z.object({
  tokens: z.array(tokenCardSchema),
  nextCursor: nextCursorSchema,
});

/** GET /v1/tokens/:address/fees (api.md; per-collection rows from fee_collections). */
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

// ── Creator-fee claim surface (pull-payment CreatorVault) ─
// ADDITIVE Phase-2 fold-in mirroring the landed on-chain surface (ICreatorVault /
// IBondingCurve creator leg). The Portfolio CreatedTab claim widget reads the
// claimable balance and submits a `CreatorVault.claim(creator)` tx. Anti-drift: every
// scalar reuses the shared wire conventions (addressSchema / decimalStringSchema /
// usdValueSchema) — no new value object. Like `feesResponseSchema` / `portfolioSummary`
// this is an aggregate roll-up, so it carries NO `confirmationState`.
//
// DOC-LOCKSTEP (report): the endpoint shape (e.g. GET /v1/creators/:address/claimable)
// + its openapi.yaml entry are api.md additions the API/architect must ratify —
// this is the single-source DTO both services build against, not a settled endpoint.

export const creatorClaimableSchema = z.object({
  creator: addressSchema,
  /** The CreatorVault the balance lives in (constant per creator-fee factory version). */
  vault: addressSchema,
  /** Live on-chain `CreatorVault.balanceOf(creator)`, wei — the AUTHORITATIVE claimable value. */
  claimableEth: decimalStringSchema,
  /** USD mirror of `claimableEth` (derived at request time). */
  claimable: usdValueSchema,
  /** Lifetime accrued (Σ `CreatorFeeDeposited`), wei — from the `creator_claimable` roll-up. */
  totalAccruedEth: decimalStringSchema,
  /** Lifetime claimed (Σ `CreatorFeeClaimed`), wei. */
  totalClaimedEth: decimalStringSchema,
  /** ISO-8601 timestamp of the live `balanceOf` read (mirrors `feesResponse.uncollected.asOf`). */
  asOf: z.string(),
});
export type CreatorClaimable = z.infer<typeof creatorClaimableSchema>;

/**
 * Unswept pre-graduation creator fees still sitting on each BondingCurve.
 * These are not yet `CreatorVault.balanceOf(creator)`, but the Portfolio claim
 * button can sweep them permissionlessly before calling `CreatorVault.claim`.
 */
export const creatorCurveClaimableSchema = z.object({
  creator: addressSchema,
  token: addressSchema,
  ticker: z.string(),
  curve: addressSchema,
  /** Live `BondingCurve.accruedCreatorFees()`, wei of native ETH. */
  unsweptEth: decimalStringSchema,
  /** ISO-8601 timestamp of the live curve read. */
  asOf: z.string(),
});
export type CreatorCurveClaimable = z.infer<typeof creatorCurveClaimableSchema>;

/**
 * `CLAIM_CREATOR_FEE` transaction metadata. The shared shape the
 * frontend attaches to a pending `CreatorVault.claim(creator)` tx so the
 * confirmation-tier tracker/toast can label and reconcile it. `type` is a
 * literal tag deliberately shaped to seed a discriminated union IF a broader shared
 * tx-metadata catalog is later introduced — none exists in packages/shared today
 * (flagged for architect; the web models `SideBadge`/`TapeKind` locally). `amountEth`
 * is the expected payout (from `creatorClaimableSchema.claimableEth`), shown
 * optimistically until the receipt confirms the actual `CreatorFeeClaimed.amount`.
 */
export const claimCreatorFeeTxMetaSchema = z.object({
  type: z.literal("CLAIM_CREATOR_FEE"),
  creator: addressSchema,
  vault: addressSchema,
  amountEth: decimalStringSchema,
});
export type ClaimCreatorFeeTxMeta = z.infer<typeof claimCreatorFeeTxMetaSchema>;

// ── Post-graduation creator LP-fee split surface (50/50 split) ─
// The pre-grad creator leg (curve native-ETH fee, above) has a POST-GRAD half:
// the graduated V3 pool's 1% fees are split 50/50 creator/treasury at
// `LPFeeVault.collect(tokenId)`, on BOTH legs. Custody is Option B
// (LANDED) the creator share is credited in the pull-payment CreatorVault
// as a per-`(creator, token)` ERC20 balance via `depositERC20(creator, token, share)`,
// where `token` is the ERC20 — a graduated LAUNCH TOKEN (sell-leg) or canonical WETH
// (buy-leg), NOT unwrapped to ETH. Claimed per ERC20 via `claimERC20(creator, token)`;
// read live via `CreatorVault.tokenBalanceOf(creator, token)`. So this surface is
// per-`(creator, ERC20-token)` and SINGLE-asset, matching the claim entrypoint 1:1 —
// a WETH row aggregates the creator's WETH share across ALL their graduated tokens.
// The pre-grad native-ETH balance (`creatorClaimableSchema` above) stays SEPARATE.
//
// DOC-LOCKSTEP (report): the endpoint shape (e.g. GET /v1/creators/:address/claimable
// enumerating the creator's (token) rows) + its openapi.yaml entry are api.md
// additions the API/architect ratifies — this is the single-source DTO both services
// build against.

export const creatorTokenClaimableSchema = z.object({
  creator: addressSchema,
  /** The ERC20 the balance is denominated in — a graduated launch token OR canonical WETH. */
  token: addressSchema,
  /** The CreatorVault custodying the balance (constant per creator-fee factory version). */
  vault: addressSchema,
  /** Live claimable — `CreatorVault.tokenBalanceOf(creator, token)`, wei of `token`. AUTHORITATIVE. */
  claimable: decimalStringSchema,
  /** USD mirror — populated only when `token` is WETH (ETH-priced, derived); null for launch-token legs (unpriceable ERC20). */
  claimableUsd: usdValueSchema.nullable(),
  /** Lifetime accrued (Σ `CreatorTokenDeposited.amount` for this `(creator, token)`), wei. */
  totalAccrued: decimalStringSchema,
  /** Lifetime claimed (Σ `CreatorTokenClaimed.amount`), wei. */
  totalClaimed: decimalStringSchema,
  /** ISO-8601 timestamp of the live `tokenBalanceOf` read (mirrors feesResponse.uncollected.asOf). */
  asOf: z.string(),
});
export type CreatorTokenClaimable = z.infer<typeof creatorTokenClaimableSchema>;

/**
 * `CLAIM_CREATOR_TOKEN_FEE` transaction metadata — the post-grad ERC20
 * analog of `claimCreatorFeeTxMetaSchema`, matching `CreatorVault.claimERC20(creator,
 * token) → amount` 1:1 (single ERC20 per claim). Attached to a pending claim tx so the
 * confirmation-tier tracker can label + reconcile it; `amount` is the expected
 * payout (from `creatorTokenClaimableSchema.claimable`), shown optimistically until the
 * receipt confirms the actual `CreatorTokenClaimed.amount`.
 */
export const claimCreatorTokenFeeTxMetaSchema = z.object({
  type: z.literal("CLAIM_CREATOR_TOKEN_FEE"),
  creator: addressSchema,
  token: addressSchema,
  vault: addressSchema,
  amount: decimalStringSchema,
});
export type ClaimCreatorTokenFeeTxMeta = z.infer<typeof claimCreatorTokenFeeTxMetaSchema>;

/** GET /v1/stats (api.md — "tokens launched, graduations, 24h volume, treasury fees collected"). */
export const statsResponseSchema = z.object({
  tokensLaunched: z.number().int().nonnegative(),
  graduations: z.number().int().nonnegative(),
  volume24hEth: decimalStringSchema,
  volume24h: usdValueSchema,
  treasuryFeesCollectedWeth: decimalStringSchema,
  treasuryFeesCollected: usdValueSchema,
});

/** GET /v1/confirmations (api.md; SSR initial state). */
export const confirmationsResponseSchema = z.object({
  safeBlock: z.number().int().nonnegative(),
  finalizedBlock: z.number().int().nonnegative(),
  latestBlock: z.number().int().nonnegative(),
  updatedAt: z.string(),
});

/** GET /v1/eth-usd (api.md) — live-or-dated source, never a constant. */
export const ethUsdResponseSchema = z.object({
  price: z.number(),
  source: z.string(), // e.g. 'chainlink:4663', 'defillama'
  asOf: z.string(),
});

// ── Launch flow (api.md) ─────────────────────────────────────────

/** 200 of POST /v1/uploads/image. */
export const uploadImageResponseSchema = z.object({
  imageUrl: z.string(),
  imageHash: hex32Schema, // keccak256 of the RE-ENCODED bytes (canonical image)
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
});

/** Request body of POST /v1/metadata (api.md; server adds the version tag). */
export const metadataRequestSchema = z.object({
  // Byte-length limits — same on-chain-mirroring refinement as the
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
 * shared canonicalizer before signing the tx (normative for M3).
 */
export const metadataResponseSchema = z.object({
  metadataHash: hex32Schema,
  metadataUri: z.string(),
  canonicalJson: z.string(),
});

// ── Admin (api.md) ─────────────────────────────────────────────────────

export const adminVisibilityRequestSchema = z.object({
  visibility: z.enum(["visible", "hidden"]), // admin can hide listings ONLY
  reason: z.string().min(1),
});
export const adminImpersonationRequestSchema = z.object({
  flagged: z.boolean(),
  ticker: z.string().optional(),
  reason: z.string().min(1),
});

/**
 * Moderation queue item (api.md : "token, image, metadata, vendor scores,
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

/** Audit-log entry (api.md : actor, action, target, reason, ts). */
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

// ── Query enums (api.md) ───────────────────────────────────────────────

export const tokenSortSchema = z.enum([
  "trending",
  "newest",
  "mcap",
  "volume24h",
  "progress",
]);
export const tokenFilterSchema = z.enum(["pregrad", "graduated", "all"]);

// ── Sortable + keyset-paginated list tables (api.md; token-detail redesign) ─
//
// Contract-first shared shapes for SERVER-SIDE sorted, keyset-paginated tables
// consumed by BOTH apps/api (which builds a safe ORDER BY + keyset WHERE) and
// apps/web (the common DataTable + Pagination components). Defined ONCE here so
// the two services build against identical shapes (anti-drift — CLAUDE.md /
// CONTRIBUTING). The field allowlists + api.md wording are flagged for
// architect ratification in the change report; nothing shared is redeclared.
//
// Decisions owned per robbed-shared "decide-it-yourself" (basis recorded inline):
//  1. REUSES the existing keyset cursor mechanism (apps/api/src/lib/pagination.ts —
//     HMAC-signed base64url `{ k, i }`); `keysetCursorSchema` below is the LOGICAL
//     payload that file already encodes, NOT a parallel cursor. The API keeps
//     ownership of the HMAC signing/verification.
//  2. Sort fields are CLOSED enums = the security boundary: the API rejects any
//     value not in the enum, so no caller-chosen string reaches the ORDER BY (no
//     arbitrary-column SQL). label→column maps live in comments so the API
//     transcribes safe column names; the runtime column map stays API-local (one
// consumer — the SQL builder — single-consumer precedent).
//  3. `limit` CLAMPS (never rejects) to mirror the existing `clampLimit` behaviour
//     byte-for-byte — the friendlier existing contract, not a stricter fork.
//     `clampListLimit` is the extracted single source (apps/api `clampLimit`
//     should delegate to it — report note).
//  4. The `{ items, nextCursor }` envelope MATCHES the shape already used by
//     `moderationQueueResponseSchema` (and openapi.yaml) — a uniform key so the
//     DataTable never switches on a per-endpoint array name; not a new convention.

/** Sort direction — the only two values any sortable endpoint accepts. */
export const sortDirSchema = z.enum(["asc", "desc"]);
export type SortDir = z.infer<typeof sortDirSchema>;

/**
 * Trade-feed sort allowlist (GET /v1/tokens/:address/trades — token-detail TRADES
 * table). Each label → the indexed `trades` column the API builds ORDER BY over
 * (db-rows.ts `TradeRowDb`; indexer.md). The API MUST reject anything
 * outside this enum (no arbitrary-column SQL):
 *   age    → block_timestamp   (DESC = newest; block_number is the correlated fallback)
 *   side   → is_buy            (the DTO's `isBuy`; buy sorts vs sell)
 *   trader → trader            (address text)
 *   amount → eth_amount        (ETH notional; cast ::numeric to order as a number)
 *   price  → price_eth         (display float column)
 * Tiebreak for EVERY trade sort is the row `id` (`${tx_hash}-${log_index}`), the
 * keyset cursor's `i` — see keysetCursorSchema.
 */
export const TRADE_SORT_FIELDS = ["age", "side", "trader", "amount", "price"] as const;
export const tradeSortFieldSchema = z.enum(TRADE_SORT_FIELDS);
export type TradeSortField = z.infer<typeof tradeSortFieldSchema>;

/**
 * Holder-list sort allowlist (GET /v1/tokens/:address/holders — token-detail
 * HOLDERS table). Each label → its source (balances, indexer.md; address_flags,
 * ). The API MUST reject anything outside this enum:
 *   rank    → balance   (rank = ROW_NUMBER() OVER (ORDER BY balance::numeric DESC))
 *   address → holder    (the DTO exposes this column as `address`)
 *   label   → DERIVED    (creator/curve/lp_pool/vault flag-join precedence +
 *                         address_flags.flags — NO physical column; the API builds a
 *                         CASE ORDER BY from the SAME join `toHolderRow` uses, and the
 *                         FE renders the label from `flags`/`botFlags`)
 *   amount  → balance    (balance::numeric)
 *   percent → balance    (pct = balance/total_supply; total_supply is constant per
 *                         token ⇒ percent order == balance order)
 * NOTE: for a single token `rank`, `amount`, and `percent` all resolve to the SAME
 * `balance::numeric` ordering — distinct UI columns, one physical sort key. Tiebreak
 * for every holder sort is the `holder` address (the keyset cursor's `i`).
 */
export const HOLDER_SORT_FIELDS = ["rank", "address", "label", "amount", "percent"] as const;
export const holderSortFieldSchema = z.enum(HOLDER_SORT_FIELDS);
export type HolderSortField = z.infer<typeof holderSortFieldSchema>;

/**
 * Logical keyset-cursor payload — the shape apps/api HMAC-signs into the opaque
 * base64url cursor string (apps/api/src/lib/pagination.ts `Cursor`, which should
 * import THIS type rather than redeclare it — report note). Defined here so the
 * "sort key + stable tiebreak" contract that lets sort AND paginate COMPOSE is
 * single-sourced. The cursor stays OPAQUE to apps/web — the FE only echoes the
 * signed string back; it never parses this shape (so the API remains the sole
 * signer/decoder).
 *   k = string form of the ACTIVE sort column's value on the last row returned
 *       (e.g. `block_timestamp` for trades `age`, `balance` for holders `amount`).
 *   i = stable unique tiebreak of the last row — trades: `id` (`${tx}-${logIndex}`);
 *       holders: `holder` address. Guarantees a total order so no row is skipped or
 *       duplicated across pages under concurrent inserts.
 * dir-agnostic: the API applies `(sort_col, id) < (k, i)` for `desc`, `>` for `asc`.
 */
export const keysetCursorSchema = z.object({ k: z.string(), i: z.string() });
export type KeysetCursorPayload = z.infer<typeof keysetCursorSchema>;

/**
 * Canonical page-limit clamp — SINGLE SOURCE for the `[1, PAGE_LIMIT_MAX]` bound
 * with `PAGE_LIMIT_DEFAULT` fallback (constants.ts; api.md). CLAMPS and never
 * throws, so an over-large or malformed `?limit=` degrades to a valid page
 * instead of a 400 — byte-identical to the existing apps/api `clampLimit`, which
 * should delegate to this to kill the duplicate (report note).
 */
export function clampListLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return PAGE_LIMIT_DEFAULT;
  return Math.min(Math.floor(n), PAGE_LIMIT_MAX);
}

/**
 * `limit` field schema: accepts a query-string or a number and always resolves to
 * a bounded `number` via `clampListLimit`; absent `?limit=` → `PAGE_LIMIT_DEFAULT`.
 * `.default()` (not `.optional()`) is what makes the object key omittable in Zod 4
 * AND applies the default — a bare `z.undefined()` union member is still rejected
 * as `nonoptional` when the key is missing, and `.optional().transform()` lets
 * `undefined` bypass the transform (both verified against zod@4.4.3 / zod.dev).
 * A malformed present value (e.g. "abc") clamps to the default too — the clamp
 * never throws, so the endpoint never 400s on a bad limit.
 */
export const listLimitSchema = z
  .union([z.string(), z.number()])
  .transform(clampListLimit)
  .default(PAGE_LIMIT_DEFAULT);

/**
 * Generic list-query factory, parameterized by a per-table sort-field enum.
 * `sort`/`dir`/`cursor` optional; `limit` always bounded + defaulted. ONE factory
 * ⇒ every sortable endpoint shares the exact query grammar (fewer ways to diverge).
 */
export function listQueryParamsSchema<F extends z.ZodType>(sortField: F) {
  return z.object({
    sort: sortField.optional(),
    dir: sortDirSchema.optional(),
    cursor: z.string().optional(),
    limit: listLimitSchema,
  });
}

/** Concrete per-table query schemas — both services import THESE (identical shape). */
export const tradeListQuerySchema = listQueryParamsSchema(tradeSortFieldSchema);
export type TradeListQuery = z.infer<typeof tradeListQuerySchema>;
export const holderListQuerySchema = listQueryParamsSchema(holderSortFieldSchema);
export type HolderListQuery = z.infer<typeof holderListQuerySchema>;

/**
 * Generic keyset-paginated response envelope `{ items, nextCursor }` — the uniform
 * shape the redesign's common DataTable consumes for EVERY sortable table, so the
 * component never switches on a per-endpoint array key. Reuses `nextCursorSchema`
 * (string | null) — the same pagination convention as the existing named-key list
 * responses and `moderationQueueResponseSchema`, not a fork. `T` is the shared row
 * schema.
 */
export function paginatedResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: nextCursorSchema });
}
export type Paginated<T> = { items: T[]; nextCursor: string | null };

/**
 * Concrete redesign envelopes — apps/api shapes the response with THESE and
 * apps/web types its data as `Paginated<TradeRow>` / `Paginated<HolderRow>`, so
 * the wire shape is provably identical on both sides. These do NOT replace the
 * legacy `tradesResponseSchema` / `holdersResponseSchema` (which stay for the
 * existing endpoints); the /trades + /holders migration to `{ items, nextCursor }`
 * + sort/dir params is a ratified doc change — see the change report.
 */
export const paginatedTradesResponseSchema = paginatedResponseSchema(tradeRowSchema);
export type PaginatedTradesResponse = z.infer<typeof paginatedTradesResponseSchema>;
export const paginatedHoldersResponseSchema = paginatedResponseSchema(holderRowSchema);
export type PaginatedHoldersResponse = z.infer<typeof paginatedHoldersResponseSchema>;
