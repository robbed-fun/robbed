/**
 * Bun-native Postgres implementation of the `Db` interface (Bun's built-in `SQL`
 * — no `pg`/`postgres` dependency). Two clients enforce the role split (§7): `ro`
 * reads indexer-owned tables; `rw` writes ONLY the API-owned tables
 * (`moderation_status`, `moderation_audit_log`). The grant boundary is created in
 * `migrations/001_api_tables.sql`; this file honors it structurally by never
 * issuing a write on `ro`.
 *
 * Row coercion: `numeric(78,0)` arrives as string (kept as-is → decimal string
 * DTOs); `int8`/`integer` are coerced to `number` (indexer.md §3 convention);
 * `timestamptz` to ISO string. All parameterized — no string interpolation of
 * user input (search/list order expressions inline only server-computed numbers).
 */
import { SQL } from "bun";
import type {
  AddressPnlRow,
  BotFlag,
  CandleRow,
  ConfirmationWatermarksRow,
  EthUsdSnapshotRow,
  FeeCollectionRow,
  MetadataVerificationStatus,
  ModerationStatusRow,
  TokenFlowStatsRow,
  TradeRowDb,
} from "@robbed/shared";
import type { Config } from "../config";
import type {
  Change24hAnchor,
  Db,
  HolderJoinedRow,
  ListTokensInput,
  PortfolioHoldingRow,
  RawQuery,
  TokenDetailRow,
  TokenListRow,
} from "./db";
import { sortDef } from "../search/sort";

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const str = (v: unknown): string => (v == null ? "0" : String(v));
const nstr = (v: unknown): string | null => (v == null ? null : String(v));
const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v ?? new Date(0).toISOString());

const TOKEN_LIST_SELECT = `
  t.*, m.visibility AS m_visibility, m.impersonation_flag AS m_impersonation_flag,
  m.impersonation_ticker AS m_impersonation_ticker`;
const TOKEN_LIST_FROM = `
  FROM tokens t LEFT JOIN moderation_status m ON m.token_address = t.address`;

function mapTokenList(r: Record<string, unknown>): TokenListRow {
  return {
    address: String(r.address),
    curve_address: String(r.curve_address),
    creator: String(r.creator),
    creator_fee_bps: num(r.creator_fee_bps),
    // §12.40d: per-curve immutable trade fee; Trust-panel/card fee source (NOT
    // the factory-current config value, which misreports older curves).
    trade_fee_bps: num(r.trade_fee_bps),
    name: String(r.name),
    ticker: String(r.ticker),
    metadata_hash: String(r.metadata_hash),
    metadata_uri: nstr(r.metadata_uri),
    image_url: nstr(r.image_url),
    description: nstr(r.description),
    links: (r.links as Record<string, string> | null) ?? null,
    total_supply: str(r.total_supply),
    virtual_eth: str(r.virtual_eth),
    virtual_token: str(r.virtual_token),
    real_eth_reserves: str(r.real_eth_reserves),
    real_token_reserves: str(r.real_token_reserves),
    graduation_eth: str(r.graduation_eth),
    graduated: Boolean(r.graduated),
    v3_pool_address: nstr(r.v3_pool_address),
    graduated_at: r.graduated_at == null ? null : num(r.graduated_at),
    last_price_eth: r.last_price_eth == null ? null : Number(r.last_price_eth),
    volume_eth_24h: str(r.volume_eth_24h),
    trade_count: num(r.trade_count),
    holder_count: num(r.holder_count),
    created_at: num(r.created_at),
    block_number: num(r.block_number),
    tx_hash: String(r.tx_hash),
    log_index: num(r.log_index),
    confirmation_state: r.confirmation_state as TokenListRow["confirmation_state"],
    m_visibility: (r.m_visibility as TokenListRow["m_visibility"]) ?? null,
    m_impersonation_flag: r.m_impersonation_flag == null ? null : Boolean(r.m_impersonation_flag),
    m_impersonation_ticker: nstr(r.m_impersonation_ticker),
  };
}

function mapTrade(r: Record<string, unknown>): TradeRowDb {
  return {
    id: String(r.id),
    token_address: String(r.token_address),
    trader: String(r.trader),
    venue: r.venue as TradeRowDb["venue"],
    is_buy: Boolean(r.is_buy),
    eth_amount: str(r.eth_amount),
    token_amount: str(r.token_amount),
    fee_eth: str(r.fee_eth),
    price_eth: Number(r.price_eth),
    block_number: num(r.block_number),
    block_timestamp: num(r.block_timestamp),
    tx_hash: String(r.tx_hash),
    log_index: num(r.log_index),
    confirmation_state: r.confirmation_state as TradeRowDb["confirmation_state"],
  };
}

function mapFee(r: Record<string, unknown>): FeeCollectionRow {
  return {
    id: String(r.id),
    token_address: String(r.token_address),
    pool_address: String(r.pool_address),
    lp_token_id: str(r.lp_token_id),
    recipient: String(r.recipient),
    amount_token: str(r.amount_token),
    amount_weth: str(r.amount_weth),
    block_number: num(r.block_number),
    block_timestamp: num(r.block_timestamp),
    tx_hash: String(r.tx_hash),
    log_index: num(r.log_index),
    confirmation_state: r.confirmation_state as FeeCollectionRow["confirmation_state"],
  };
}

/** balances ⋈ tokens → the Portfolio HOLDINGS join row (pricing + ref columns). */
function mapHolding(r: Record<string, unknown>): PortfolioHoldingRow {
  return {
    token_address: String(r.token_address),
    balance: str(r.balance),
    total_eth_in: str(r.total_eth_in),
    total_bought_tokens: str(r.total_bought_tokens),
    name: String(r.name),
    ticker: String(r.ticker),
    image_url: nstr(r.image_url),
    graduated: Boolean(r.graduated),
    real_eth_reserves: str(r.real_eth_reserves),
    graduation_eth: str(r.graduation_eth),
    virtual_eth: str(r.virtual_eth),
    virtual_token: str(r.virtual_token),
    last_price_eth: r.last_price_eth == null ? null : Number(r.last_price_eth),
    trade_fee_bps: num(r.trade_fee_bps),
  };
}

const HOLDING_SELECT = `
  b.token_address, b.balance, b.total_eth_in, b.total_bought_tokens,
  t.name, t.ticker, t.image_url, t.graduated, t.real_eth_reserves, t.graduation_eth,
  t.virtual_eth, t.virtual_token, t.last_price_eth, t.trade_fee_bps`;
const HOLDING_FROM = `FROM balances b JOIN tokens t ON t.address = b.token_address`;

function mapModeration(r: Record<string, unknown>): ModerationStatusRow {
  return {
    token_address: String(r.token_address),
    visibility: r.visibility as ModerationStatusRow["visibility"],
    nsfw_score: r.nsfw_score == null ? null : Number(r.nsfw_score),
    csam_flag: Boolean(r.csam_flag),
    impersonation_flag: Boolean(r.impersonation_flag),
    impersonation_ticker: nstr(r.impersonation_ticker),
    reason: nstr(r.reason),
    reviewed_by: nstr(r.reviewed_by),
    updated_at: iso(r.updated_at),
  };
}

export function createBunDb(config: Config): Db {
  const ro = new SQL(config.databaseUrlRo);
  const rw = new SQL(config.databaseUrlRw);

  return {
    async getWatermarks() {
      const rows = (await ro.unsafe(
        "SELECT latest_block, safe_block, finalized_block, updated_at FROM confirmation_watermarks WHERE id = 1",
      )) as Record<string, unknown>[];
      const r = rows[0];
      if (!r) return null;
      return {
        id: 1,
        latest_block: num(r.latest_block),
        safe_block: num(r.safe_block),
        finalized_block: num(r.finalized_block),
        updated_at: iso(r.updated_at),
      } satisfies ConfirmationWatermarksRow;
    },

    async getLatestEthUsd() {
      const rows = (await ro.unsafe(
        "SELECT fetched_at, price_usd, source FROM eth_usd_snapshots ORDER BY fetched_at DESC LIMIT 1",
      )) as Record<string, unknown>[];
      const r = rows[0];
      if (!r) return null;
      return {
        fetched_at: iso(r.fetched_at),
        price_usd: Number(r.price_usd),
        source: String(r.source),
      } satisfies EthUsdSnapshotRow;
    },

    async getTokenListRow(address) {
      const rows = (await ro.unsafe(
        `SELECT ${TOKEN_LIST_SELECT} ${TOKEN_LIST_FROM} WHERE t.address = $1`,
        [address],
      )) as Record<string, unknown>[];
      return rows[0] ? mapTokenList(rows[0]) : null;
    },

    async getTokenDetailRow(address) {
      const rows = (await ro.unsafe(
        `SELECT ${TOKEN_LIST_SELECT},
           (SELECT count(*) FROM tokens tc WHERE tc.creator = t.creator) AS creator_tokens_created,
           bc.balance AS curve_balance, bp.balance AS pool_balance,
           mv.onchain_hash AS mv_onchain, mv.computed_hash AS mv_computed,
           mv.status AS mv_status, mv.verified_at AS mv_verified_at,
           fs.organic_holder_pct_low AS fs_hlow, fs.organic_holder_pct_high AS fs_hhigh,
           fs.organic_volume_pct AS fs_vol, fs.flagged_cluster_vol_pct_24h AS fs_cluster,
           fs.updated_at AS fs_updated
         ${TOKEN_LIST_FROM}
         LEFT JOIN balances bc ON bc.token_address = t.address AND bc.holder = t.curve_address
         LEFT JOIN balances bp ON bp.token_address = t.address AND bp.holder = t.v3_pool_address
         LEFT JOIN metadata_verifications mv ON mv.token_address = t.address
         LEFT JOIN token_flow_stats fs ON fs.token_address = t.address
         WHERE t.address = $1`,
        [address],
      )) as Record<string, unknown>[];
      const r = rows[0];
      if (!r) return null;
      const base = mapTokenList(r);
      const flow: TokenFlowStatsRow | null =
        r.fs_updated == null
          ? null
          : {
              token_address: base.address,
              organic_holder_pct_low: Number(r.fs_hlow),
              organic_holder_pct_high: Number(r.fs_hhigh),
              organic_volume_pct: Number(r.fs_vol),
              flagged_cluster_vol_pct_24h: Number(r.fs_cluster),
              updated_at: iso(r.fs_updated),
            };
      const detail: TokenDetailRow = {
        ...base,
        creator_tokens_created: num(r.creator_tokens_created),
        curve_balance: nstr(r.curve_balance),
        pool_balance: nstr(r.pool_balance),
        verification: r.mv_onchain
          ? {
              onchain_hash: String(r.mv_onchain),
              computed_hash: nstr(r.mv_computed),
              status: r.mv_status as MetadataVerificationStatus,
              verified_at: r.mv_verified_at == null ? null : iso(r.mv_verified_at),
            }
          : null,
        flow,
      };
      return detail;
    },

    async tokenExists(address) {
      const rows = (await ro.unsafe("SELECT 1 FROM tokens WHERE address = $1", [
        address,
      ])) as unknown[];
      return rows.length > 0;
    },

    async listTokens(input: ListTokensInput) {
      const def = sortDef(input.sort);
      const orderExpr =
        input.sort === "trending"
          ? `(t.volume_eth_24h::double precision) * exp(-((${input.nowSec}) - t.created_at) / (${input.trendingHalfLifeSeconds}))`
          : def.orderExpr;
      const where: string[] = ["(m.visibility IS DISTINCT FROM 'hidden')"];
      const params: unknown[] = [];
      if (input.filter === "pregrad") where.push("t.graduated = false");
      else if (input.filter === "graduated") where.push("t.graduated = true");
      if (input.cursorSortKey != null && input.cursorId != null) {
        params.push(input.cursorSortKey, input.cursorId);
        where.push(
          `(${orderExpr}, t.address) < ($${params.length - 1}::${def.castType}, $${params.length})`,
        );
      }
      params.push(input.limit);
      const text = `SELECT ${TOKEN_LIST_SELECT} ${TOKEN_LIST_FROM}
        WHERE ${where.join(" AND ")}
        ORDER BY ${orderExpr} DESC, t.address DESC
        LIMIT $${params.length}`;
      const rows = (await ro.unsafe(text, params)) as Record<string, unknown>[];
      return rows.map(mapTokenList);
    },

    async kingOfTheHill() {
      const rows = (await ro.unsafe(
        `SELECT ${TOKEN_LIST_SELECT} ${TOKEN_LIST_FROM}
         WHERE t.graduated = false AND (m.visibility IS DISTINCT FROM 'hidden')
         ORDER BY (t.real_eth_reserves::double precision / NULLIF(t.graduation_eth::double precision, 0))
                  * ln(1 + t.volume_eth_24h::double precision) DESC NULLS LAST, t.address DESC
         LIMIT 1`,
      )) as Record<string, unknown>[];
      return rows[0] ? mapTokenList(rows[0]) : null;
    },

    async searchTokens(query: RawQuery) {
      const rows = (await ro.unsafe(query.text, query.params)) as Record<string, unknown>[];
      return rows.map(mapTokenList);
    },

    async getChange24hAnchors(tokens: string[], nowSec: number) {
      const result = new Map<string, Change24hAnchor>();
      if (tokens.length === 0) return result;
      const cutoff = nowSec - 86_400;
      // $1..$n = addresses, $(n+1) = 24h cutoff. Per-token subqueries: earliest
      // trade price + the single 1h candle at/before the cutoff (LATERAL LIMIT 1).
      // The anchor SELECTION stays in the shared resolver — this only fetches the
      // raw inputs it reads (indexer.md §4.5; anti-drift).
      const placeholders = tokens.map((_, i) => `$${i + 1}`).join(",");
      const cutoffParam = `$${tokens.length + 1}`;
      const text = `
        SELECT t.address,
          (SELECT tr.price_eth FROM trades tr
             WHERE tr.token_address = t.address
             ORDER BY tr.block_number ASC, tr.log_index ASC LIMIT 1) AS first_trade_price,
          ac.bucket_start AS anchor_bucket,
          ac.close AS anchor_close
        FROM tokens t
        LEFT JOIN LATERAL (
          SELECT c.bucket_start, c.close FROM candles c
          WHERE c.token_address = t.address AND c.interval = '1h'
            AND c.bucket_start <= ${cutoffParam}
          ORDER BY c.bucket_start DESC LIMIT 1
        ) ac ON true
        WHERE t.address IN (${placeholders})`;
      const rows = (await ro.unsafe(text, [...tokens, cutoff])) as Record<string, unknown>[];
      for (const r of rows) {
        const hourCandles =
          r.anchor_close == null
            ? []
            : [{ bucket_start: num(r.anchor_bucket), close: Number(r.anchor_close) }];
        result.set(String(r.address), {
          firstTradePrice: r.first_trade_price == null ? null : Number(r.first_trade_price),
          hourCandles,
        });
      }
      return result;
    },

    async listTrades(input) {
      const where: string[] = ["token_address = $1"];
      const params: unknown[] = [input.token];
      if (input.since != null) {
        params.push(input.since);
        where.push(`(block_timestamp >= $${params.length} OR block_number >= $${params.length})`);
      }
      if (input.cursorTs != null && input.cursorId != null) {
        params.push(input.cursorTs, input.cursorId);
        where.push(`(block_timestamp, id) < ($${params.length - 1}, $${params.length})`);
      }
      params.push(input.limit);
      const text = `SELECT * FROM trades WHERE ${where.join(" AND ")}
        ORDER BY block_timestamp DESC, id DESC LIMIT $${params.length}`;
      const rows = (await ro.unsafe(text, params)) as Record<string, unknown>[];
      return rows.map(mapTrade);
    },

    async getTradesByTx(txHash) {
      const rows = (await ro.unsafe(
        "SELECT * FROM trades WHERE tx_hash = $1 ORDER BY log_index ASC",
        [txHash],
      )) as Record<string, unknown>[];
      return rows.map(mapTrade);
    },

    async getCandles(input) {
      const rows = (await ro.unsafe(
        `SELECT * FROM candles
         WHERE token_address = $1 AND interval = $2 AND bucket_start >= $3 AND bucket_start <= $4
         ORDER BY bucket_start ASC LIMIT $5`,
        [input.token, input.interval, input.from, input.to, input.limit],
      )) as Record<string, unknown>[];
      return rows.map(
        (r): CandleRow => ({
          token_address: String(r.token_address),
          interval: r.interval as CandleRow["interval"],
          bucket_start: num(r.bucket_start),
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
          volume_eth: str(r.volume_eth),
          volume_token: str(r.volume_token),
          trade_count: num(r.trade_count),
          last_block_number: num(r.last_block_number),
          last_log_index: num(r.last_log_index),
        }),
      );
    },

    async getHolders(input) {
      const rows = (await ro.unsafe(
        `SELECT b.*, af.flags AS af_flags, af.cluster_id AS af_cluster
         FROM balances b LEFT JOIN address_flags af ON af.address = b.holder
         WHERE b.token_address = $1 AND b.balance::numeric > 0
         ORDER BY b.balance::numeric DESC LIMIT $2`,
        [input.token, input.limit],
      )) as Record<string, unknown>[];
      return rows.map(
        (r): HolderJoinedRow => ({
          token_address: String(r.token_address),
          holder: String(r.holder),
          balance: str(r.balance),
          total_bought_tokens: str(r.total_bought_tokens),
          total_sold_tokens: str(r.total_sold_tokens),
          total_eth_in: str(r.total_eth_in),
          total_eth_out: str(r.total_eth_out),
          first_seen_at: num(r.first_seen_at),
          last_active_at: num(r.last_active_at),
          flags: r.af_flags
            ? { flags: r.af_flags as BotFlag[], cluster_id: nstr(r.af_cluster) }
            : null,
        }),
      );
    },

    async getFeeCollections(token) {
      const rows = (await ro.unsafe(
        "SELECT * FROM fee_collections WHERE token_address = $1 ORDER BY block_timestamp DESC",
        [token],
      )) as Record<string, unknown>[];
      return rows.map(mapFee);
    },

    // ── portfolio (spec §5.4) ─────────────────────────────────────────────────
    async getAddressPnl(address) {
      const rows = (await ro.unsafe(
        `SELECT address, first_seen_at, last_active_at, trade_count, tokens_created,
                total_eth_in, total_eth_out, realized_pnl_low, realized_pnl_high,
                pnl_confidence, updated_at
           FROM address_pnl WHERE address = $1`,
        [address],
      )) as Record<string, unknown>[];
      const r = rows[0];
      if (!r) return null;
      return {
        address: String(r.address),
        first_seen_at: num(r.first_seen_at),
        last_active_at: num(r.last_active_at),
        trade_count: num(r.trade_count),
        tokens_created: num(r.tokens_created),
        total_eth_in: str(r.total_eth_in),
        total_eth_out: str(r.total_eth_out),
        realized_pnl_low: str(r.realized_pnl_low),
        realized_pnl_high: str(r.realized_pnl_high),
        pnl_confidence: (r.pnl_confidence as AddressPnlRow["pnl_confidence"]) ?? null,
        updated_at: iso(r.updated_at),
      } satisfies AddressPnlRow;
    },

    async getAllHoldings(address) {
      const rows = (await ro.unsafe(
        `SELECT ${HOLDING_SELECT} ${HOLDING_FROM}
         WHERE b.holder = $1 AND b.balance::numeric > 0`,
        [address],
      )) as Record<string, unknown>[];
      return rows.map(mapHolding);
    },

    async listHoldings(input) {
      const where: string[] = ["b.holder = $1", "b.balance::numeric > 0"];
      const params: unknown[] = [input.address];
      if (input.cursorBalance != null && input.cursorToken != null) {
        params.push(input.cursorBalance, input.cursorToken);
        where.push(
          `(b.balance::numeric, b.token_address) < ($${params.length - 1}::numeric, $${params.length})`,
        );
      }
      params.push(input.limit);
      const text = `SELECT ${HOLDING_SELECT} ${HOLDING_FROM}
        WHERE ${where.join(" AND ")}
        ORDER BY b.balance::numeric DESC, b.token_address DESC
        LIMIT $${params.length}`;
      const rows = (await ro.unsafe(text, params)) as Record<string, unknown>[];
      return rows.map(mapHolding);
    },

    async listAddressTrades(input) {
      const where: string[] = ["trader = $1"];
      const params: unknown[] = [input.address];
      if (input.cursorTs != null && input.cursorId != null) {
        params.push(input.cursorTs, input.cursorId);
        where.push(`(block_timestamp, id) < ($${params.length - 1}, $${params.length})`);
      }
      params.push(input.limit);
      const text = `SELECT * FROM trades WHERE ${where.join(" AND ")}
        ORDER BY block_timestamp DESC, id DESC LIMIT $${params.length}`;
      const rows = (await ro.unsafe(text, params)) as Record<string, unknown>[];
      return rows.map(mapTrade);
    },

    async listCreatedTokens(input) {
      // Listing-gated like /tokens: hidden creations are excluded (§8.4). Ordered
      // newest-first with (created_at, address) keyset — stable under new launches.
      const where: string[] = ["t.creator = $1", "(m.visibility IS DISTINCT FROM 'hidden')"];
      const params: unknown[] = [input.address];
      if (input.cursorTs != null && input.cursorToken != null) {
        params.push(input.cursorTs, input.cursorToken);
        where.push(`(t.created_at, t.address) < ($${params.length - 1}, $${params.length})`);
      }
      params.push(input.limit);
      const text = `SELECT ${TOKEN_LIST_SELECT} ${TOKEN_LIST_FROM}
        WHERE ${where.join(" AND ")}
        ORDER BY t.created_at DESC, t.address DESC LIMIT $${params.length}`;
      const rows = (await ro.unsafe(text, params)) as Record<string, unknown>[];
      return rows.map(mapTokenList);
    },

    async getStats(nowSec) {
      const since = nowSec - 86_400;
      // Fixed 4-tuple cast (not `[][]`) so `noUncheckedIndexedAccess` treats each
      // result set as present; row access below still guards with `?.`.
      const [tl, gr, vol, fees] = (await Promise.all([
        ro.unsafe("SELECT count(*)::int AS n FROM tokens"),
        ro.unsafe("SELECT count(*)::int AS n FROM graduations"),
        ro.unsafe("SELECT coalesce(sum(eth_amount),0)::text AS v FROM trades WHERE block_timestamp >= $1", [since]),
        ro.unsafe("SELECT coalesce(sum(amount_weth),0)::text AS v FROM fee_collections"),
      ])) as [
        Record<string, unknown>[],
        Record<string, unknown>[],
        Record<string, unknown>[],
        Record<string, unknown>[],
      ];
      return {
        tokensLaunched: num(tl[0]?.n),
        graduations: num(gr[0]?.n),
        volume24hEthWei: str(vol[0]?.v),
        treasuryFeesCollectedWeth: str(fees[0]?.v),
      };
    },

    async getModerationStatus(token) {
      const rows = (await rw.unsafe(
        "SELECT * FROM moderation_status WHERE token_address = $1",
        [token],
      )) as Record<string, unknown>[];
      return rows[0] ? mapModeration(rows[0]) : null;
    },

    async upsertModerationStatus(token, patch) {
      const cols = Object.keys(patch);
      const vals = Object.values(patch);
      const insertCols = ["token_address", ...cols];
      const placeholders = insertCols.map((_, i) => `$${i + 1}`);
      const updates = cols.map((c, i) => `${c} = $${i + 2}`);
      const text = `INSERT INTO moderation_status (${insertCols.join(", ")}, updated_at)
        VALUES (${placeholders.join(", ")}, coalesce($${insertCols.length + 1}, now()))
        ON CONFLICT (token_address) DO UPDATE SET ${updates.join(", ")}, updated_at = now()
        RETURNING *`;
      const rows = (await rw.unsafe(text, [token, ...vals, patch.updated_at ?? null])) as Record<
        string,
        unknown
      >[];
      return mapModeration(rows[0]!);
    },

    async getModerationQueue(input) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (input.status === "pending_review") where.push("m.visibility = 'pending_review'");
      else if (input.status === "flagged")
        where.push("(m.impersonation_flag OR m.csam_flag OR m.nsfw_score >= 0.8)");
      else
        where.push(
          "(m.visibility = 'pending_review' OR m.impersonation_flag OR m.csam_flag OR m.visibility = 'hidden')",
        );
      if (input.cursorId != null) {
        params.push(input.cursorId);
        where.push(`t.address < $${params.length}`);
      }
      params.push(input.limit);
      const text = `SELECT ${TOKEN_LIST_SELECT}, m.*
        FROM moderation_status m JOIN tokens t ON t.address = m.token_address
        WHERE ${where.join(" AND ")}
        ORDER BY t.address DESC LIMIT $${params.length}`;
      const rows = (await rw.unsafe(text, params)) as Record<string, unknown>[];
      return rows.map((r) => ({ ...mapTokenList(r), m: mapModeration(r) }));
    },

    async insertAudit(entry) {
      await rw.unsafe(
        "INSERT INTO moderation_audit_log (actor, action, target, reason) VALUES ($1,$2,$3,$4)",
        [entry.actor, entry.action, entry.target, entry.reason],
      );
    },

    async listAudit(input) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (input.cursorId != null) {
        params.push(input.cursorId);
        where.push(`id < $${params.length}`);
      }
      params.push(input.limit);
      const text = `SELECT id::text AS id, actor, action, target, reason, ts
        FROM moderation_audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY id DESC LIMIT $${params.length}`;
      const rows = (await rw.unsafe(text, params)) as Record<string, unknown>[];
      return rows.map((r) => ({
        id: String(r.id),
        actor: String(r.actor),
        action: String(r.action),
        target: String(r.target),
        reason: nstr(r.reason),
        ts: iso(r.ts),
      }));
    },

    async ping() {
      try {
        await ro.unsafe("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
  };
}
