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
  AddressPnlRow,
  AnchorCandle,
  BalanceRow,
  BotFlag,
  CandleRow,
  CompetitorSnapshotRow,
  ConfirmationWatermarksRow,
  CreatorClaimableRow,
  EthUsdSnapshotRow,
  FeeCollectionRow,
  HolderSortField,
  MetadataVerificationRow,
  ModerationStatusRow,
  ModerationVisibility,
  SortDir,
  TokenFlowStatsRow,
  TokenRow,
  TradeRowDb,
  TradeSortField,
} from "@robbed/shared";
import type { CandleInterval } from "@robbed/shared";
import type { HolderSpecialAddresses } from "./listSort";

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

/**
 * A persisted `comments` row (API-owned table, migrations/002_comments.sql;
 * spec §12.63b). INTERNAL query artifact — projected to the shared `Comment`
 * DTO by `projections/comment.ts` (like `TradeRowDb`→`toTradeRow`); the wire
 * shape stays single-sourced in @robbed/shared. `created_at` is unix seconds
 * (integer column), `id` the bigserial as a string (keyset tiebreak).
 */
export interface CommentRowDb {
  id: string;
  token_address: string;
  author: string;
  body: string;
  moderation_status: ModerationVisibility;
  created_at: number;
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
  /**
   * LP NFT tokenId from `graduations.lp_token_id` (LEFT JOIN; null pre-grad).
   * Surfaces as the detail DTO's optional `lpTokenId` (shared api-types).
   */
  lp_token_id: string | null;
  verification: Pick<
    MetadataVerificationRow,
    "onchain_hash" | "computed_hash" | "status" | "verified_at"
  > | null;
  flow: TokenFlowStatsRow | null;
}

export interface HolderJoinedRow extends BalanceRow {
  flags: Pick<AddressFlagsRow, "flags" | "cluster_id"> | null;
  /**
   * True balance-descending rank within the token (§12.59 / api.md §3.4), from
   * `ROW_NUMBER() OVER (ORDER BY balance::numeric DESC, holder DESC)` over the
   * WHOLE token — so a page sorted by address/label still carries the real rank
   * (surfaces as the optional `HolderRow.rank`). Always populated now.
   */
  rank: number;
  /**
   * Deterministic label-sort key (§12.58/§12.59) from the role/flag CASE
   * (listSort.ts `holderLabelRank`) — only consumed as the `label` sort's keyset
   * value; not a wire field.
   */
  label_rank: number;
}

/**
 * §8.5 advisory bot-flag summary over a token's CURRENT holders (api.md §3.7,
 * D-4/M2-13). Query artifact, not a wire shape — the route zero-fills `byFlag`
 * into the full shared `BotFlag` record. Advisory only (§8.4/§8.5).
 */
export interface TokenFlagSummary {
  /** Holders (balance > 0) carrying at least one bot flag. */
  flaggedHolders: number;
  /** Distinct funder clusters among the flagged holders. */
  clusterCount: number;
  /** Per-flag holder counts; flags no holder carries are simply absent. */
  byFlag: Partial<Record<BotFlag, number>>;
}

/**
 * A Portfolio HOLDINGS row: `balances` (Transfer-truth balance + cost-basis
 * accumulators) JOINed to the token pricing/ref columns. NOT a new wire shape —
 * it projects into `@robbed/shared` `portfolioHoldingSchema` (anti-drift:
 * `BalanceRow` already IS the holding, db-rows.ts). Only the balance/cost-basis
 * columns the read-time price + unrealized-PnL math consumes are carried, plus
 * the `tokenRef` fields (name/ticker/image/graduated/status inputs).
 */
export interface PortfolioHoldingRow {
  token_address: string;
  /** Current balance, wei — Transfer-truth (`balances.balance`). */
  balance: string;
  /** ETH spent buying (curve exact; v3 best-effort, OI-5) — cost-basis input. */
  total_eth_in: string;
  /** Tokens bought — cost-basis denominator (0 ⇒ no basis ⇒ unrealized null). */
  total_bought_tokens: string;
  // ── token pricing / ref columns (from `tokens`) ──
  name: string;
  ticker: string;
  image_url: string | null;
  graduated: boolean;
  real_eth_reserves: string;
  graduation_eth: string;
  virtual_eth: string;
  virtual_token: string;
  last_price_eth: number | null;
  /** Per-curve immutable fee snapshot (§12.40d) — the curve-quote fee input. */
  trade_fee_bps: number;
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
  /**
   * Token trade feed — SERVER-side sorted + keyset-paginated (§12.59). `sort`/`dir`
   * are already validated against the shared allowlist by the route; this method
   * maps `sort`→a fixed column via `listSort.ts` (never interpolates a caller
   * string). `cursorKey`/`cursorId` are the decoded keyset `(k, i)`. `since` is the
   * WS reconnect backfill floor (applies on top of the sort).
   */
  listTrades(input: {
    token: string;
    since: number | null;
    sort: TradeSortField;
    dir: SortDir;
    cursorKey: string | null;
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
  /**
   * Holders page — SERVER-side sorted + keyset-paginated (§12.59). Every row
   * carries the token-global balance `rank` (ROW_NUMBER) + a `label_rank` for the
   * `label` sort. `special` (creator/curve/pool/vault) drives the label CASE and
   * is passed as bind params (never interpolated). `sort` is pre-validated.
   */
  getHolders(input: {
    token: string;
    sort: HolderSortField;
    dir: SortDir;
    cursorKey: string | null;
    cursorId: string | null;
    limit: number;
    special: HolderSpecialAddresses;
  }): Promise<HolderJoinedRow[]>;
  getFeeCollections(token: string): Promise<FeeCollectionRow[]>;
  /**
   * `graduations.lp_token_id` for a graduated token (null pre-grad) — the LP
   * NFT the fees dashboard reads `tokensOwed` for (UncollectedFeesReader input).
   */
  getLpTokenId(token: string): Promise<string | null>;

  // ── creator-fee claimable (RO; Ponder `creator_claimable` — spec §12.63) ──
  /**
   * Per-creator claimable roll-up (accrued/claimed/vault) backing GET
   * /v1/creators/:address/claimable. Null when the creator has never accrued
   * (no row) — the route then falls back to the config vault (or 404s). The live
   * `CreatorVault.balanceOf` (CreatorVaultBalanceReader) is the authoritative
   * claimable value; this row supplies the vault + lifetime accrued/claimed.
   */
  getCreatorClaimable(creator: string): Promise<CreatorClaimableRow | null>;

  // ── portfolio (spec §5.4; api.md §3) ──────────────────────────────────────
  /** Per-address materialized roll-up backing GET /v1/portfolio/:address; null when the address never appeared. */
  getAddressPnl(address: string): Promise<AddressPnlRow | null>;
  /**
   * Live `count(*)` of the address's curve+V3 trades, straight off `trades`
   * (uses `trades_trader_idx`). The summary's `tradeCount` reads THIS, not the
   * advisory `address_pnl.trade_count` — the roll-up job ticks every ~60s, so a
   * fresh trade (or a fresh DB before the first tick) would show 0 (PORT-1).
   */
  countAddressTrades(address: string): Promise<number>;
  /**
   * ALL priceable holdings for an address (balance > 0), unpaginated — the
   * summary aggregates totalValueEth + unrealized PnL over the whole set. Bounded
   * by the address's distinct positive-balance token count.
   */
  getAllHoldings(address: string): Promise<PortfolioHoldingRow[]>;
  /** Cursor-paginated HOLDINGS tab (balance DESC, token_address DESC tiebreak). */
  listHoldings(input: {
    address: string;
    cursorBalance: string | null;
    cursorToken: string | null;
    limit: number;
  }): Promise<PortfolioHoldingRow[]>;
  /** Per-address ACTIVITY slice of the unified trade feed (reuse `TradeRowDb`). */
  listAddressTrades(input: {
    address: string;
    cursorTs: number | null;
    cursorId: string | null;
    limit: number;
  }): Promise<TradeRowDb[]>;
  /** CREATED tab: tokens whose `creator` == address (reuse the card row). */
  listCreatedTokens(input: {
    address: string;
    cursorTs: number | null;
    cursorToken: string | null;
    limit: number;
  }): Promise<TokenListRow[]>;

  // ── internal dashboard (D-4; api.md §3.7) — read-only, advisory §8.5 ──────
  /** `token_flow_stats` row for one token; null until the flow job computes. */
  getTokenFlowStats(token: string): Promise<TokenFlowStatsRow | null>;
  /** Bot-flag counts over the token's current holders (M2-13 flow quality). */
  getTokenFlagSummary(token: string): Promise<TokenFlagSummary>;
  /**
   * `competitor_snapshots` newest-first (M2-14; Gate G-A.2). Keyset cursor
   * `(captured_at, source)` DESC — rows are shared `CompetitorSnapshotRow`
   * verbatim (§2: source + captured_at always present, never fabricated).
   */
  listCompetitorSnapshots(input: {
    cursorCapturedAt: string | null;
    cursorSource: string | null;
    limit: number;
  }): Promise<CompetitorSnapshotRow[]>;

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

  // ── comments (RW; API-owned `comments` table — spec §12.63b) ──────────────
  /**
   * Insert one off-chain comment and return the persisted row (with its
   * assigned bigserial `id`). `author` is the SIWE-authenticated poster and
   * `moderation_status` the pipeline verdict — both server-set, never from the
   * client body. `created_at` is server unix-seconds. Runs on the RW role.
   */
  insertComment(input: {
    tokenAddress: string;
    author: string;
    body: string;
    moderationStatus: ModerationVisibility;
    createdAt: number;
  }): Promise<CommentRowDb>;
  /**
   * Public comment list for a token — newest-first (created_at DESC, id DESC
   * tiebreak) keyset page. EXCLUDES hidden comments (returns visible +
   * pending_review only — pending_review REMAINS LISTED, §12.21). `cursorKey` /
   * `cursorId` are the decoded keyset `(created_at, id)`.
   */
  listComments(input: {
    token: string;
    cursorKey: string | null;
    cursorId: string | null;
    limit: number;
  }): Promise<CommentRowDb[]>;

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
