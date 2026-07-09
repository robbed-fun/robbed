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
 */
import type { ConfirmationState } from "./confirmation";
import type { CandleInterval } from "./constants";
import type { Venue } from "./ws-messages";

/** indexer.md §3.1 `tokens`. */
export interface TokenRow {
  address: string;
  curve_address: string;
  /** §7: tracked from day 1, even though creator fees are Phase 2. */
  creator: string;
  /** §7: 0 in v1; column exists so Phase 2 needs no migration. */
  creator_fee_bps: number;
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
  confirmation_state: ConfirmationState;
}

/** indexer.md §3.6 `balances` (Transfer-driven, portfolio-ready day 1). */
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
