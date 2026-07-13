/**
 * DB row types matching the target relational shapes in indexer.md §3
 * (api.md §5 `db-rows.ts` row). Consumed by indexer and api.
 *
 * Conventions (indexer.md §3):
 * - addresses: lowercase `text` → `string`;
 * - `numeric(78,0)` (uint256-safe): decimal `string`;
 * - `bigint` unix-seconds timestamps / block numbers: `number` (L2 blocks and
 *   unix seconds are < 2^53; pg drivers must be configured to parse int8 to
 *   number or these arrive as strings — normative type here is number);
 * - `numeric` display-only floats (prices): `number`;
 * - `timestamptz`: ISO-8601 `string`.
 *
 * READ-DERIVATION CONSTRAINT (OI-11 rework, 2026-07-11 — spec §12.48c;
 * indexer.md §3.8/§5): `confirmation_state` is NOT a physical column on any
 * Ponder-managed table. The API derives it per row at read time via a SELECT
 * expression over the `confirmation_watermarks` sidecar —
 * `confirmationStateSql(blockCol)` in `apps/api/src/lib/confirmation.ts`.
 * These row shapes remain correct for API consumers, but any FUTURE direct
 * `SELECT *` against the underlying tables MUST include that derived
 * expression or the field will be absent at runtime (the shape here will not
 * catch it — interfaces don't validate). Highest risk: `transfers` and
 * `graduations`, which no API query selects today.
 */
import type { BotFlag } from "./api-types";
import type { ConfirmationState } from "./confirmation";
import type { CandleInterval } from "./constants";
import type { Venue } from "./ws-messages";

/** indexer.md §3.1 `tokens`. */
export interface TokenRow {
  address: string;
  curve_address: string;
  /** §7: tracked from day 1, even though creator fees are Phase 2. */
  creator: string;
  /**
   * Per-curve snapshot of the creator-fee leg, basis points (§7, §12.63). The
   * indexer writes this from the curve's immutable `CREATOR_FEE_BPS` at
   * TokenCreated. UN-FROZEN 2026-07-13 (robbed-shared, §12.63 creator-fee fold-in):
   * this was pinned to 0 in v1 ("no fee-path reader") but the landed creator-fee
   * factory makes it configurable and nonzero (testnet default 50). Constraint is
   * the SAME combined cap as `trade_fee_bps`: `trade_fee_bps + creator_fee_bps ≤
   * MAX_TRADE_FEE_BPS` (200) — the factory re-asserts it on every setter. Reading
   * 0 stays valid (mainnet v1 curves), so this is additive/backward-compatible.
   */
  creator_fee_bps: number;
  /**
   * Per-curve snapshot of the trade fee, basis points (spec §12.40d wiring
   * follow-up, ratified 2026-07-10). The indexer writes this from the curve's immutable
   * `TRADE_FEE_BPS` at TokenCreated; API card/detail projections read THIS
   * column, never `apps/api/src/config.ts` (factory-current, which misreports
   * older curves deployed under a different fee). `≤ MAX_TRADE_FEE_BPS` (200).
   */
  trade_fee_bps: number;
  name: string;
  ticker: string;
  /** bytes32 hex, verbatim from chain (§8.3). */
  metadata_hash: string;
  metadata_uri: string | null;
  image_url: string | null;
  description: string | null;
  links: Record<string, string> | null;
  total_supply: string;
  virtual_eth: string;
  virtual_token: string;
  real_eth_reserves: string;
  real_token_reserves: string;
  graduation_eth: string;
  graduated: boolean;
  v3_pool_address: string | null;
  graduated_at: number | null;
  last_price_eth: number | null;
  volume_eth_24h: string;
  trade_count: number;
  holder_count: number;
  created_at: number;
  block_number: number;
  tx_hash: string;
  log_index: number;
  /** Read-derived, never stored (§12.48c) — see file-header constraint. */
  confirmation_state: ConfirmationState;
}

/** indexer.md §3.2 `trades` (unified curve `Trade` + V3 `Swap`). */
export interface TradeRowDb {
  /** `${tx_hash}-${log_index}`. */
  id: string;
  token_address: string;
  trader: string;
  venue: Venue;
  is_buy: boolean;
  eth_amount: string;
  token_amount: string;
  /** "0" for v3 rows (fee lives in the pool; Collect tracks it). */
  fee_eth: string;
  price_eth: number;
  block_number: number;
  block_timestamp: number;
  tx_hash: string;
  log_index: number;
  /** Read-derived, never stored (§12.48c) — see file-header constraint. */
  confirmation_state: ConfirmationState;
}

/**
 * indexer.md §3.6 `transfers` — the sixth event family (X-5). Persisted per
 * ERC-20 `Transfer`, keyed `(tx_hash, log_index)`, the SOLE source of balance
 * truth (§12.16): the balance deltas are applied in the same handler guarded by
 * this row's insert, so a re-delivered log is a no-op and increments run exactly
 * once (the §7.1 idempotency anchor). `rebuild` replays these in
 * `(block_number, log_index)` order to reconstruct `balances` exactly.
 */
export interface TransferRow {
  /** `${tx_hash}-${log_index}` (dedup anchor). */
  id: string;
  token_address: string;
  from_address: string;
  to_address: string;
  value: string;
  block_number: number;
  block_timestamp: number;
  tx_hash: string;
  log_index: number;
  /**
   * NOT a physical column on `transfers` (OI-11 rework — spec §12.48c;
   * indexer.md §3.8/§5): derived at read time from the
   * `confirmation_watermarks` sidecar via
   * `confirmationStateSql("block_number")` (apps/api/src/lib/confirmation.ts).
   * No API query selects from `transfers` today — the FIRST direct
   * `SELECT *` against it MUST add that derived expression or this field
   * will be absent at runtime. See the file-header constraint.
   */
  confirmation_state: ConfirmationState;
}

/** indexer.md §3.3 `graduations`. */
export interface GraduationRow {
  token_address: string;
  pool_address: string;
  lp_token_id: string;
  token_is_token0: boolean;
  eth_to_lp: string;
  tokens_to_lp: string;
  graduation_fee_eth: string;
  caller: string;
  block_number: number;
  block_timestamp: number;
  tx_hash: string;
  log_index: number;
  /**
   * NOT a physical column on `graduations` (OI-11 rework — spec §12.48c;
   * indexer.md §3.8/§5): derived at read time from the
   * `confirmation_watermarks` sidecar via
   * `confirmationStateSql("block_number")` (apps/api/src/lib/confirmation.ts).
   * No API query selects from `graduations` today — the FIRST direct
   * `SELECT *` against it MUST add that derived expression or this field
   * will be absent at runtime. See the file-header constraint.
   */
  confirmation_state: ConfirmationState;
}

/** indexer.md §3.5 `fee_collections`. */
export interface FeeCollectionRow {
  id: string;
  token_address: string;
  pool_address: string;
  lp_token_id: string;
  recipient: string;
  amount_token: string;
  amount_weth: string;
  block_number: number;
  block_timestamp: number;
  tx_hash: string;
  log_index: number;
  /** Read-derived, never stored (§12.48c) — see file-header constraint. */
  confirmation_state: ConfirmationState;
}

/**
 * `creator_claimable` — per-CREATOR pull-payment roll-up backing the creator-fee
 * claim surface (spec §7 / §12.63; ROBBED_ redesign Portfolio CreatedTab). ONE row
 * per creator address, rebuildable from the on-chain creator-fee events:
 *  - `total_accrued_eth`  = Σ `CreatorFeeDeposited.amount` (curve→vault sweeps credited
 *                           to this creator; == Σ `CreatorFeesSwept.amount` for its curves)
 *  - `total_claimed_eth`  = Σ `CreatorFeeClaimed.amount` (paid out to the creator)
 * The materialized `claimable_eth` (accrued − claimed) is an event-derived MIRROR;
 * the AUTHORITATIVE claimable value the API serves is the live on-chain
 * `CreatorVault.balanceOf(creator)` read (asOf), exactly like `feesResponseSchema`'s
 * `uncollected` uses a live NPM read rather than trusting a projection. Like
 * `AddressPnlRow` / `TokenFlowStatsRow` this is an [offchain] roll-up, NOT an event
 * row, so it carries no `confirmation_state`. `vault` is the CreatorVault the balance
 * lives in (constant per creator-fee factory version). Additive — absent for every
 * pre-creator-fee (v1) deployment where no vault exists.
 *
 * OWNER NOTE (report / doc-lockstep): the exact table + any per-event history table
 * (a `creator_fee_claims` mirror of `FeeCollectionRow`, if a claim-history endpoint is
 * wanted) are robbed-indexer's to define in indexer.md §3 — this is the single-source
 * TYPE for the projection both services build against, not a ratified schema decision.
 */
export interface CreatorClaimableRow {
  creator: string;
  vault: string;
  total_accrued_eth: string;
  total_claimed_eth: string;
  /** accrued − claimed, wei decimal string (event-derived mirror; live `balanceOf` is authoritative). */
  claimable_eth: string;
  /** Unix seconds of the most recent `CreatorFeeClaimed`; null if never claimed. */
  last_claim_at: number | null;
  updated_at: string;
}

/**
 * indexer.md §3.6 `balances` (Transfer-driven, portfolio-ready day 1). This IS
 * the per-(token, holder) holding row: `balance` (Transfer-truth) + the
 * cost-basis accumulators (`total_eth_in/out`, `total_bought/sold_tokens`) that
 * back the Portfolio HOLDINGS list (`api-types.ts` portfolioHoldingSchema) and
 * its per-token unrealized-PnL range. Anti-drift: the portfolio holdings DTO is
 * a projection of THIS row joined to `tokens` — there is deliberately no
 * separate `address_holdings` table (it would be a structural duplicate).
 */
export interface BalanceRow {
  token_address: string;
  holder: string;
  balance: string;
  total_bought_tokens: string;
  total_sold_tokens: string;
  total_eth_in: string;
  total_eth_out: string;
  first_seen_at: number;
  last_active_at: number;
}

/**
 * `address_pnl` — per-ADDRESS portfolio roll-up backing GET /v1/portfolio/:address
 * (`api-types.ts` portfolioSummarySchema; spec §5.4 Phase-2 schema surfaced day
 * 1 by the ROBBED_ redesign). Aggregate across ALL of the address's tokens; the
 * per-(token, holder) detail stays in `BalanceRow` — this is its address-level
 * roll-up, NOT a duplicate. Cost-basis fields are best-effort: the V3-leg basis
 * is approximate until the Phase-2 portfolio (spec §12 disposition 16), so
 * REALIZED PnL is a RANGE (`_low`/`_high`, §5.2 forbids false precision), signed
 * wei decimal strings. UNREALIZED / all-time PnL is NOT materialized here — it
 * is computed at request time (live price × `BalanceRow.balance` − remaining
 * basis), since price is live. `pnl_confidence` is null when no cost basis
 * exists at all (pure transfer-in holdings). Every input balance derives from
 * Transfer truth (X-4/X-5), never external.
 */
export interface AddressPnlRow {
  address: string;
  /** Earliest Transfer touching the address, unix seconds. */
  first_seen_at: number;
  last_active_at: number;
  /** Curve+V3 trade count by the address. */
  trade_count: number;
  /** Tokens whose `creator` == address (CREATED tab count). */
  tokens_created: number;
  /** Aggregate ETH spent buying / received selling across all tokens, wei. */
  total_eth_in: string;
  total_eth_out: string;
  /** Realized PnL (closed legs) best-effort range, signed wei. */
  realized_pnl_low: string;
  realized_pnl_high: string;
  /** null when no cost basis exists at all; `estimated` when any V3-leg basis is involved. */
  pnl_confidence: "exact" | "estimated" | null;
  updated_at: string;
}

/** indexer.md §3.7 `candles` (derived, rebuildable). */
export interface CandleRow {
  token_address: string;
  interval: CandleInterval;
  bucket_start: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume_eth: string;
  volume_token: string;
  trade_count: number;
  last_block_number: number;
  last_log_index: number;
}

/** indexer.md §3.8 `confirmation_watermarks` [offchain] singleton. */
export interface ConfirmationWatermarksRow {
  id: 1;
  latest_block: number;
  safe_block: number;
  finalized_block: number;
  updated_at: string;
}

/** indexer.md §3.9 `eth_usd_snapshots` [offchain] (§2 hard rule: USD only from here). */
export interface EthUsdSnapshotRow {
  fetched_at: string;
  price_usd: number;
  source: string;
}

export type MetadataVerificationStatus = "match" | "mismatch" | "unfetched";

/** indexer.md §3.10 `metadata_verifications` [offchain]. */
export interface MetadataVerificationRow {
  token_address: string;
  onchain_hash: string;
  computed_hash: string | null;
  status: MetadataVerificationStatus;
  fetched_body_sha256: string | null;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  verified_at: string | null;
}

export type ModerationVisibility = "visible" | "pending_review" | "hidden";

/** indexer.md §3.11 `moderation_status` [offchain] — written by the API only. */
export interface ModerationStatusRow {
  token_address: string;
  visibility: ModerationVisibility;
  nsfw_score: number | null;
  csam_flag: boolean;
  impersonation_flag: boolean;
  impersonation_ticker: string | null;
  reason: string | null;
  reviewed_by: string | null;
  updated_at: string;
}

// ── Bot/farm heuristics [offchain, indexer-owned] (spec §8.5, v1.2) ─────────
// Derived side tables, rebuildable from `trades` + `transfers` (indexer.md
// §8.5.2). Advisory / labeling only — never gate chain state or listing.

/**
 * indexer.md §8.5.2 `address_flags` — per-address bot/farm label set + funding
 * cluster. `flags` uses the SAME `BotFlag` vocabulary the wire uses
 * (api-types.ts `botFlagSchema`) — one source, imported here.
 */
export interface AddressFlagsRow {
  address: string;
  flags: BotFlag[];
  cluster_id: string | null;
  updated_at: string;
}

/**
 * indexer.md §8.5.2 `token_flow_stats` — per-token organic estimates feeding the
 * Trust panel (`api-types.ts` `organicFlowSchema`) and the gate-7 cluster-alert
 * metric. Ranges (`_low`/`_high`) because the heuristics are estimates (§5.2
 * forbids false precision).
 */
export interface TokenFlowStatsRow {
  token_address: string;
  organic_holder_pct_low: number;
  organic_holder_pct_high: number;
  organic_volume_pct: number;
  flagged_cluster_vol_pct_24h: number;
  updated_at: string;
}

/**
 * indexer.md §8.5.3 `competitor_snapshots` — weekly source+timestamped snapshot
 * of hood.fun traction (own indexer or Dune), feeding Gate G-A.2 (spec §14).
 * NEVER a hardcoded metric (§2 hard rule): every row carries its `source` and
 * `captured_at`. `visible_volume_eth` is an ETH-denominated decimal string
 * (avoid float precision loss on aggregated volume).
 */
export interface CompetitorSnapshotRow {
  source: string;
  captured_at: string;
  tokens_per_day: number;
  graduations: number;
  visible_volume_eth: string;
}
