/**
 * DB access boundary. Routes depend on this INTERFACE, never on a concrete
 * driver — so unit tests inject a fake and the Bun.sql implementation
 * (`db.bun.ts`) is swapped at boot. Two logical roles (api.md §7, spec §7):
 * every method here that reads indexer-owned tables runs on the READ-ONLY
 * connection; the four moderation/audit writers run on the READ-WRITE
 * connection scoped to API-owned tables only. The role split is enforced at the
 * Postgres grant level; this interface documents the boundary.
 *
 * Row shapes reuse `@robbed/shared/db-rows` and extend them with join columns
 * (internal query artifacts, not wire shapes — wire DTOs come from shared).
 */
import type {
  AddressFlagsRow,
  AnchorCandle,
  BalanceRow,
  CandleRow,
  ConfirmationWatermarksRow,
  EthUsdSnapshotRow,
  FeeCollectionRow,
  MetadataVerificationRow,
  ModerationStatusRow,
  ModerationVisibility,
  TokenFlowStatsRow,
  TokenRow,
  TradeRowDb,
} from "@robbed/shared";
import type { CandleInterval } from "@robbed/shared";

/**
 * Per-token inputs for the shared `computeChange24hPct` resolver
 * (`@robbed/shared/change24h`, spec §12.40e). Fetched batched per response page
 * (never N+1) and fed into the card/detail projection so the Δ% is identical
 * across `/tokens` list and `/tokens/:address` detail (indexer.md §4.5). The
 * anchor SELECTION (young-token / candle-close / fallback branches) stays in the
 * ONE shared function — this only carries the raw candle superset + first-trade
 * price it reads, so there is no second copy of the anchor logic (anti-drift).
 */
export interface Change24hAnchor {
  /** Price of the token's earliest trade; null if it has never traded. */
  firstTradePrice: number | null;
  /** 1h candle(s) at/before the now−24h cutoff (superset ok); `[]` if none. */
  hourCandles: AnchorCandle[];
}

/** Token row joined to moderation flags (list/search/card need these). */
export interface TokenListRow extends TokenRow {
  m_visibility: ModerationVisibility | null;
  m_impersonation_flag: boolean | null;
  m_impersonation_ticker: string | null;
}

/** Token row joined to everything the detail + Trust panel needs. */
export interface TokenDetailRow extends TokenListRow {
  creator_tokens_created: number;
  /** Token balance held by the curve address (supply.curveHeld, api.md §3.4). */
  curve_balance: string | null;
  /** Token balance held by the V3 pool (supply.lpTranche). */
  pool_balance: string | null;
  verification: Pick<
    MetadataVerificationRow,
    "onchain_hash" | "computed_hash" | "status" | "verified_at"
  > | null;
  flow: TokenFlowStatsRow | null;
}

export interface HolderJoinedRow extends BalanceRow {
  flags: Pick<AddressFlagsRow, "flags" | "cluster_id"> | null;
}

/** Result of a pre-built search/list query: rows + whether a sort key exists. */
export interface ListTokensInput {
  sort: "trending" | "newest" | "mcap" | "volume24h" | "progress";
  filter: "pregrad" | "graduated" | "all";
  cursorSortKey: string | null;
  cursorId: string | null;
  limit: number;
  /** Bind params for the trending order expression (search/sort.ts). */
  nowSec: number;
  trendingHalfLifeSeconds: number;
}

export interface RawQuery {
  text: string;
  params: unknown[];
}

export interface Db {
  // ── meta / watermarks ─────────────────────────────────────────────────────
  getWatermarks(): Promise<ConfirmationWatermarksRow | null>;
  getLatestEthUsd(): Promise<EthUsdSnapshotRow | null>;

  // ── tokens ────────────────────────────────────────────────────────────────
  getTokenListRow(address: string): Promise<TokenListRow | null>;
  getTokenDetailRow(address: string): Promise<TokenDetailRow | null>;
  tokenExists(address: string): Promise<boolean>;
  listTokens(input: ListTokensInput): Promise<TokenListRow[]>;
  kingOfTheHill(): Promise<TokenListRow | null>;
  /** Executes a pre-built search query (search/builder.ts) → joined list rows. */
  searchTokens(query: RawQuery): Promise<TokenListRow[]>;
  /**
   * Batched 24h-change anchors for a response page (spec §12.40e; indexer.md
   * §4.5). One query for all `tokens` — never per-row — keyed lowercase address →
   * {@link Change24hAnchor}. `nowSec` sets the `now−24h` candle cutoff. Missing
   * tokens (no trades / no candles) simply have no map entry (→ Δ% 0).
   */
  getChange24hAnchors(
    tokens: string[],
    nowSec: number,
  ): Promise<Map<string, Change24hAnchor>>;

  // ── trades / candles / holders / fees ─────────────────────────────────────
  listTrades(input: {
    token: string;
    since: number | null;
    cursorTs: number | null;
    cursorId: string | null;
    limit: number;
  }): Promise<TradeRowDb[]>;
  getTradesByTx(txHash: string): Promise<TradeRowDb[]>;
  getCandles(input: {
    token: string;
    interval: CandleInterval;
    from: number;
    to: number;
    limit: number;
  }): Promise<CandleRow[]>;
  getHolders(input: { token: string; limit: number }): Promise<HolderJoinedRow[]>;
  getFeeCollections(token: string): Promise<FeeCollectionRow[]>;

  // ── stats ─────────────────────────────────────────────────────────────────
  getStats(nowSec: number): Promise<{
    tokensLaunched: number;
    graduations: number;
    volume24hEthWei: string;
    treasuryFeesCollectedWeth: string;
  }>;

  // ── moderation (RW; API-owned tables only) ────────────────────────────────
  getModerationStatus(token: string): Promise<ModerationStatusRow | null>;
  upsertModerationStatus(
    token: string,
    patch: Partial<Omit<ModerationStatusRow, "token_address">>,
  ): Promise<ModerationStatusRow>;
  getModerationQueue(input: {
    status: "pending_review" | "flagged" | null;
    cursorId: string | null;
    limit: number;
  }): Promise<Array<TokenListRow & { m: ModerationStatusRow | null }>>;

  // ── audit (RW) ────────────────────────────────────────────────────────────
  insertAudit(entry: {
    actor: string;
    action: string;
    target: string;
    reason: string | null;
  }): Promise<void>;
  listAudit(input: {
    cursorId: string | null;
    limit: number;
  }): Promise<Array<{ id: string; actor: string; action: string; target: string; reason: string | null; ts: string }>>;

  // ── liveness ──────────────────────────────────────────────────────────────
  ping(): Promise<boolean>;
}
