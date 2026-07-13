/**
 * Test fakes + fixtures. In-memory Db/Storage/Redis/Reencoder so route + logic
 * tests run without Postgres/Redis/R2/sharp. Awaiting the shared-package
 * reconcile to execute (`bun test` — deps not installed yet).
 */
import { loadRankingConfig } from "../src/config/ranking";
import type { Config } from "../src/config";
import type {
  Change24hAnchor,
  Db,
  HolderJoinedRow,
  ListTokensInput,
  PortfolioHoldingRow,
  RawQuery,
  TokenDetailRow,
  TokenListRow,
} from "../src/lib/db";
import type { AppDeps } from "../src/deps";
import type { Redis } from "../src/lib/redis";
import { createFakeRedis } from "../src/lib/redis";
import type { Reencoder } from "../src/media/reencode";
import type { Storage } from "../src/media/storage";
import { InMemoryRateLimitStore } from "../src/mw/ratelimit";
import { stubVendors } from "../src/moderation/vendors";
import type {
  AddressPnlRow,
  CandleRow,
  CompetitorSnapshotRow,
  ConfirmationWatermarksRow,
  CreatorClaimableRow,
  EthUsdSnapshotRow,
  HolderSortField,
  ModerationStatusRow,
  SortDir,
  TokenFlowStatsRow,
  TradeRowDb,
  TradeSortField,
} from "@robbed/shared";
import type { TokenFlagSummary } from "../src/lib/db";
import {
  holderLabelRank,
  holderSortKey,
  type HolderSpecialAddresses,
  tradeSortKey,
} from "../src/lib/listSort";

/**
 * Bun's `Response.json()` is typed `Promise<unknown>`; tests read the loose
 * `{ data, error }` envelope, so unwrap through one typed helper rather than
 * casting at every call site.
 */
// biome-ignore lint/suspicious/noExplicitAny: test-only envelope reader
export const readJson = (res: Response): Promise<any> => res.json();

export const TEST_ADDR = "0x1111111111111111111111111111111111111111";
export const TEST_CREATOR = "0x2222222222222222222222222222222222222222";
export const TEST_CURVE = "0x3333333333333333333333333333333333333333";

export function fixtureToken(overrides: Partial<TokenDetailRow> = {}): TokenDetailRow {
  return {
    address: TEST_ADDR,
    curve_address: TEST_CURVE,
    creator: TEST_CREATOR,
    creator_fee_bps: 0,
    trade_fee_bps: 100, // §12.40d per-curve snapshot (Trust/card fee source)
    name: "Test Token",
    ticker: "TEST",
    metadata_hash: "0x" + "ab".repeat(32),
    metadata_uri: "https://cdn.test/metadata/abc.json",
    image_url: "https://cdn.test/images/" + "cd".repeat(32) + ".webp",
    description: "a token",
    links: { website: "https://test.xyz" },
    total_supply: (1_000_000_000n * 10n ** 18n).toString(),
    virtual_eth: (30n * 10n ** 18n).toString(),
    virtual_token: (1_073_000_000n * 10n ** 18n).toString(),
    real_eth_reserves: (5n * 10n ** 18n).toString(),
    real_token_reserves: (800_000_000n * 10n ** 18n).toString(),
    graduation_eth: (85n * 10n ** 18n).toString(),
    graduated: false,
    v3_pool_address: null,
    graduated_at: null,
    last_price_eth: 0.00000003,
    volume_eth_24h: (12n * 10n ** 18n).toString(),
    trade_count: 42,
    holder_count: 17,
    created_at: 1_700_000_000,
    block_number: 120,
    tx_hash: "0x" + "ef".repeat(32),
    log_index: 0,
    confirmation_state: "soft_confirmed",
    m_visibility: null,
    m_impersonation_flag: null,
    m_impersonation_ticker: null,
    creator_tokens_created: 3,
    curve_balance: (800_000_000n * 10n ** 18n).toString(),
    pool_balance: null,
    lp_token_id: null, // pre-grad default; graduated fixtures override

    verification: {
      onchain_hash: "0x" + "ab".repeat(32),
      computed_hash: "0x" + "ab".repeat(32),
      status: "match",
      verified_at: new Date(1_700_000_100_000).toISOString(),
    },
    flow: null,
    ...overrides,
  };
}

export const TEST_HOLDER = "0x4444444444444444444444444444444444444444";

/** A Portfolio HOLDINGS join row (balances ⋈ tokens) — pre-graduation curve token. */
export function fixtureHolding(
  overrides: Partial<PortfolioHoldingRow> = {},
): PortfolioHoldingRow {
  return {
    token_address: TEST_ADDR,
    balance: (1_000_000n * 10n ** 18n).toString(), // 1M tokens held
    total_eth_in: (1n * 10n ** 18n).toString(), // spent 1 ETH buying
    total_bought_tokens: (1_000_000n * 10n ** 18n).toString(),
    name: "Test Token",
    ticker: "TEST",
    image_url: "https://cdn.test/images/x.webp",
    graduated: false,
    real_eth_reserves: (5n * 10n ** 18n).toString(),
    graduation_eth: (85n * 10n ** 18n).toString(),
    virtual_eth: (30n * 10n ** 18n).toString(),
    virtual_token: (1_073_000_000n * 10n ** 18n).toString(),
    last_price_eth: 0.00000003,
    trade_fee_bps: 100,
    ...overrides,
  };
}

/** A raw `trades` row (curve, 1 ETH buy) for the token-detail feed tests. */
export function fixtureTrade(overrides: Partial<TradeRowDb> = {}): TradeRowDb {
  return {
    id: `${"0x" + "11".repeat(32)}-0`,
    token_address: TEST_ADDR,
    trader: TEST_HOLDER,
    venue: "curve",
    is_buy: true,
    eth_amount: (1n * 10n ** 18n).toString(),
    token_amount: (1000n * 10n ** 18n).toString(),
    fee_eth: (1n * 10n ** 16n).toString(),
    price_eth: 0.00000001,
    block_number: 100,
    block_timestamp: 1_700_000_000,
    tx_hash: "0x" + "11".repeat(32),
    log_index: 0,
    confirmation_state: "soft_confirmed",
    ...overrides,
  };
}

/** A raw `balances`⋈`address_flags` holder row; rank/label_rank are recomputed by
 * FakeDb.getHolders (mirroring the SQL ROW_NUMBER + label CASE). */
export function fixtureHolder(overrides: Partial<HolderJoinedRow> = {}): HolderJoinedRow {
  return {
    token_address: TEST_ADDR,
    holder: TEST_HOLDER,
    balance: (1000n * 10n ** 18n).toString(),
    total_bought_tokens: "0",
    total_sold_tokens: "0",
    total_eth_in: "0",
    total_eth_out: "0",
    first_seen_at: 1_700_000_000,
    last_active_at: 1_700_000_000,
    flags: null,
    rank: 0,
    label_rank: 0,
    ...overrides,
  };
}

// ── in-memory keyset sort (mirrors db.bun.ts SQL semantics for route tests) ──
// `kind` per field MIRRORS the `cast` in listSort.ts TRADE/HOLDER_SORT_COLUMNS
// (numeric→bigint, double precision→number, boolean, text; tiebreak always text).
// If these diverge from the real SQL, ordering tests pass while prod breaks — the
// live curl in the container-recreate step is the real-SQL end-to-end check.
type SortKind = "bigint" | "number" | "boolean" | "text";
const TRADE_KIND: Record<TradeSortField, SortKind> = {
  age: "number", side: "boolean", trader: "text", amount: "bigint", price: "number",
};
const HOLDER_KIND: Record<HolderSortField, SortKind> = {
  rank: "bigint", amount: "bigint", percent: "bigint", address: "text", label: "number",
};
function cmpKind(kind: SortKind, a: string, b: string): number {
  switch (kind) {
    case "bigint": { const d = BigInt(a) - BigInt(b); return d < 0n ? -1 : d > 0n ? 1 : 0; }
    case "number": { const d = Number(a) - Number(b); return d < 0 ? -1 : d > 0 ? 1 : 0; }
    case "boolean": return (a === "true" ? 1 : 0) - (b === "true" ? 1 : 0); // false<true
    case "text": return a < b ? -1 : a > b ? 1 : 0;
  }
}
const cmpText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Sort by (key, tiebreak) in `dir`, drop rows at/behind the cursor, take `limit`. */
function keysetPage<T>(
  rows: T[], dir: SortDir, kind: SortKind,
  keyOf: (r: T) => string, tbOf: (r: T) => string,
  cursor: { k: string; i: string } | null, limit: number,
): T[] {
  const sorted = [...rows].sort((a, b) => {
    const c = cmpKind(kind, keyOf(a), keyOf(b));
    const primary = c !== 0 ? c : cmpText(tbOf(a), tbOf(b));
    return dir === "desc" ? -primary : primary;
  });
  const filtered = cursor
    ? sorted.filter((r) => {
        const c = cmpKind(kind, keyOf(r), cursor.k);
        if (c !== 0) return dir === "desc" ? c < 0 : c > 0;
        const t = cmpText(tbOf(r), cursor.i);
        return dir === "desc" ? t < 0 : t > 0;
      })
    : sorted;
  return filtered.slice(0, limit);
}

export class FakeDb implements Db {
  wm: ConfirmationWatermarksRow = {
    id: 1,
    latest_block: 150,
    safe_block: 100,
    finalized_block: 50,
    updated_at: new Date(1_700_000_200_000).toISOString(),
  };
  ethUsd: EthUsdSnapshotRow | null = {
    fetched_at: new Date(1_700_000_200_000).toISOString(),
    price_usd: 2000,
    source: "test",
  };
  tokens = new Map<string, TokenDetailRow>();
  moderation = new Map<string, ModerationStatusRow>();
  // ── portfolio fixtures (spec §5.4) ──
  pnl = new Map<string, AddressPnlRow>();
  holdings = new Map<string, PortfolioHoldingRow[]>();
  addressTrades: TradeRowDb[] = [];
  audit: Array<{ id: string; actor: string; action: string; target: string; reason: string | null; ts: string }> = [];

  constructor(tokens: TokenDetailRow[] = [fixtureToken()]) {
    for (const t of tokens) this.tokens.set(t.address, t);
  }

  async getWatermarks() {
    return this.wm;
  }
  async getLatestEthUsd() {
    return this.ethUsd;
  }
  async getTokenListRow(a: string): Promise<TokenListRow | null> {
    return this.tokens.get(a) ?? null;
  }
  async getTokenDetailRow(a: string) {
    return this.tokens.get(a) ?? null;
  }
  async tokenExists(a: string) {
    return this.tokens.has(a);
  }
  async listTokens(input: ListTokensInput) {
    return [...this.tokens.values()].slice(0, input.limit);
  }
  async kingOfTheHill() {
    return [...this.tokens.values()][0] ?? null;
  }
  async searchTokens(_q: RawQuery) {
    return [...this.tokens.values()];
  }
  /**
   * Anchors overridable per-address for tests. Default: for each known token,
   * derive a first-trade price from `last_price_eth` so the card's Δ% is a real
   * computed value (0 when the token has no price / no anchor override).
   */
  anchors = new Map<string, Change24hAnchor>();
  async getChange24hAnchors(tokens: string[], _nowSec: number) {
    const out = new Map<string, Change24hAnchor>();
    for (const a of tokens) {
      const override = this.anchors.get(a);
      if (override) out.set(a, override);
    }
    return out;
  }
  /** Raw token-detail feed rows (seed per test); FakeDb sorts + keysets them. */
  tokenTrades: TradeRowDb[] = [];
  async listTrades(input: {
    token: string;
    since: number | null;
    sort: TradeSortField;
    dir: SortDir;
    cursorKey: string | null;
    cursorId: string | null;
    limit: number;
  }) {
    let rows = this.tokenTrades.filter((t) => t.token_address === input.token);
    if (input.since != null)
      rows = rows.filter(
        (t) => t.block_timestamp >= input.since! || t.block_number >= input.since!,
      );
    const cursor =
      input.cursorKey != null && input.cursorId != null
        ? { k: input.cursorKey, i: input.cursorId }
        : null;
    return keysetPage(
      rows,
      input.dir,
      TRADE_KIND[input.sort],
      (r) => tradeSortKey(input.sort, r),
      (r) => r.id,
      cursor,
      input.limit,
    );
  }
  async getTradesByTx() {
    return [];
  }
  /** Overridable candle fixture (OG sparkline + candles route tests). */
  candles: CandleRow[] = [];
  async getCandles(): Promise<CandleRow[]> {
    return this.candles;
  }
  /** Raw holder rows (seed per test); FakeDb recomputes rank + label_rank. */
  tokenHolders: HolderJoinedRow[] = [];
  async getHolders(input: {
    token: string;
    sort: HolderSortField;
    dir: SortDir;
    cursorKey: string | null;
    cursorId: string | null;
    limit: number;
    special: HolderSpecialAddresses;
  }): Promise<HolderJoinedRow[]> {
    const all = this.tokenHolders.filter(
      (h) => h.token_address === input.token && BigInt(h.balance) > 0n,
    );
    // rank = ROW_NUMBER() OVER (ORDER BY balance::numeric DESC, holder DESC).
    const ranked = [...all].sort((a, b) => {
      const d = BigInt(b.balance) - BigInt(a.balance);
      if (d !== 0n) return d < 0n ? -1 : 1;
      return b.holder < a.holder ? -1 : b.holder > a.holder ? 1 : 0;
    });
    ranked.forEach((r, i) => {
      r.rank = i + 1;
      r.label_rank = holderLabelRank(
        { holder: r.holder, botFlags: r.flags?.flags ?? null },
        input.special,
      );
    });
    const cursor =
      input.cursorKey != null && input.cursorId != null
        ? { k: input.cursorKey, i: input.cursorId }
        : null;
    return keysetPage(
      ranked,
      input.dir,
      HOLDER_KIND[input.sort],
      (r) => holderSortKey(input.sort, r),
      (r) => r.holder,
      cursor,
      input.limit,
    );
  }
  async getFeeCollections() {
    return [];
  }
  async getLpTokenId(a: string) {
    return this.tokens.get(a)?.lp_token_id ?? null;
  }
  // ── creator-fee claimable (§12.63) ──
  creatorClaimable = new Map<string, CreatorClaimableRow>();
  async getCreatorClaimable(creator: string): Promise<CreatorClaimableRow | null> {
    return this.creatorClaimable.get(creator) ?? null;
  }
  async getAddressPnl(a: string) {
    return this.pnl.get(a) ?? null;
  }
  /** Live trade count — from addressTrades, overridable via `tradeCounts`. */
  tradeCounts = new Map<string, number>();
  async countAddressTrades(a: string) {
    return (
      this.tradeCounts.get(a) ??
      this.addressTrades.filter((t) => t.trader === a).length
    );
  }
  async getAllHoldings(a: string) {
    return this.holdings.get(a) ?? [];
  }
  async listHoldings(input: { address: string; limit: number }) {
    return (this.holdings.get(input.address) ?? []).slice(0, input.limit);
  }
  async listAddressTrades(input: { address: string; limit: number }) {
    return this.addressTrades
      .filter((t) => t.trader === input.address)
      .slice(0, input.limit);
  }
  async listCreatedTokens(input: { address: string; limit: number }) {
    return [...this.tokens.values()]
      .filter((t) => t.creator === input.address)
      .slice(0, input.limit);
  }
  async getStats() {
    return {
      tokensLaunched: this.tokens.size,
      graduations: 0,
      volume24hEthWei: "0",
      treasuryFeesCollectedWeth: "0",
    };
  }
  // ── internal dashboard fixtures (D-4; api.md §3.7) ──
  flowStats = new Map<string, TokenFlowStatsRow>();
  flagSummaries = new Map<string, TokenFlagSummary>();
  competitorSnapshots: CompetitorSnapshotRow[] = [];
  async getTokenFlowStats(token: string) {
    return this.flowStats.get(token) ?? null;
  }
  async getTokenFlagSummary(token: string): Promise<TokenFlagSummary> {
    return (
      this.flagSummaries.get(token) ?? { flaggedHolders: 0, clusterCount: 0, byFlag: {} }
    );
  }
  async listCompetitorSnapshots(input: {
    cursorCapturedAt: string | null;
    cursorSource: string | null;
    limit: number;
  }) {
    // Mirrors the real keyset: (captured_at, source) DESC, strictly-less filter.
    const sorted = [...this.competitorSnapshots].sort((a, b) =>
      a.captured_at === b.captured_at
        ? b.source.localeCompare(a.source)
        : b.captured_at.localeCompare(a.captured_at),
    );
    const cAt = input.cursorCapturedAt;
    const cSrc = input.cursorSource;
    const after =
      cAt != null && cSrc != null
        ? sorted.filter(
            (s) => s.captured_at < cAt || (s.captured_at === cAt && s.source < cSrc),
          )
        : sorted;
    return after.slice(0, input.limit);
  }
  async getModerationStatus(t: string) {
    return this.moderation.get(t) ?? null;
  }
  async upsertModerationStatus(t: string, patch: Partial<Omit<ModerationStatusRow, "token_address">>) {
    const prev =
      this.moderation.get(t) ??
      ({
        token_address: t,
        visibility: "visible",
        nsfw_score: null,
        csam_flag: false,
        impersonation_flag: false,
        impersonation_ticker: null,
        reason: null,
        reviewed_by: null,
        updated_at: new Date(0).toISOString(),
      } satisfies ModerationStatusRow);
    const next = { ...prev, ...patch, token_address: t } as ModerationStatusRow;
    this.moderation.set(t, next);
    return next;
  }
  async getModerationQueue() {
    return [...this.moderation.entries()].map(([addr, m]) => {
      const token = this.tokens.get(addr);
      return { ...(token as TokenListRow), m };
    });
  }

  async insertAudit(entry: { actor: string; action: string; target: string; reason: string | null }) {
    this.audit.push({ id: String(this.audit.length + 1), ...entry, ts: new Date().toISOString() });
  }
  async listAudit() {
    return [...this.audit].reverse();
  }
  async ping() {
    return true;
  }
}

/** Fake storage: in-memory content-addressed put + exists. */
export function makeFakeStorage(base = "https://cdn.test"): Storage & { objects: Map<string, Uint8Array | string> } {
  const objects = new Map<string, Uint8Array | string>();
  const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
  const imageKey = (h: string) => `images/${strip(h)}.webp`;
  const metadataKey = (h: string) => `metadata/${strip(h)}.json`;
  const ogKey = (a: string, v: string) => `og/${strip(a).toLowerCase()}/${v}.png`;
  return {
    objects,
    imageKey,
    metadataKey,
    imageUrl: (h) => `${base}/${imageKey(h)}`,
    metadataUrl: (h) => `${base}/${metadataKey(h)}`,
    async putImage(h, bytes) {
      objects.set(imageKey(h), bytes);
    },
    async putMetadata(h, json) {
      objects.set(metadataKey(h), json);
    },
    async imageExists(h) {
      return objects.has(imageKey(h));
    },
    ogKey,
    ogUrl: (a, v) => `${base}/${ogKey(a, v)}`,
    async putOg(a, v, bytes) {
      objects.set(ogKey(a, v), bytes);
    },
    async readOg(a, v) {
      const obj = objects.get(ogKey(a, v));
      return obj instanceof Uint8Array ? obj : null;
    },
    async ping() {
      return true;
    },
  };
}

/** Fake reencoder: identity re-encode (returns bytes as-is with fixed dims). */
export function makeFakeReencoder(dims = { width: 64, height: 64 }): Reencoder {
  return {
    async reencode(input) {
      return { data: input, width: dims.width, height: dims.height };
    },
  };
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    API_PORT: 3001,
    API_ENV: "test",
    REDIS_URL: "redis://localhost:6379",
    R2_REGION: "auto",
    R2_BUCKET: "robbed",
    R2_PUBLIC_BASE_URL: "https://cdn.test",
    SESSION_SECRET: "test-secret",
    ADMIN_ALLOWLIST: "",
    TRUSTED_PROXY_HEADER: "",
    MODERATION_ALLOW_STUBS: true,
    MODERATION_NSFW_HIDE_THRESHOLD: 0.95,
    MODERATION_NSFW_REVIEW_THRESHOLD: 0.8,
    databaseUrlRo: "",
    databaseUrlRw: "",
    adminAllowlist: new Set<string>(),
    // Public-CORS allowlist (api.md §6.1) — cors.test.ts uses this origin.
    corsAllowedOrigins: new Set<string>(["https://web.test"]),
    creatorVaultAddress: undefined, // §12.63 — overridden per creator-fee test
    ...overrides,
  } as Config;
}

export function makeTestDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  const config = overrides.config ?? testConfig();
  const redis: Redis = overrides.redis ?? createFakeRedis();
  return {
    config,
    ranking: loadRankingConfig(),
    db: overrides.db ?? new FakeDb(),
    redis,
    storage: overrides.storage ?? makeFakeStorage(config.R2_PUBLIC_BASE_URL),
    reencoder: overrides.reencoder ?? makeFakeReencoder(),
    vendors: overrides.vendors ?? stubVendors(),
    rateLimit: overrides.rateLimit ?? new InMemoryRateLimitStore(),
    watchlist:
      overrides.watchlist ??
      {
        source: "test",
        capturedAt: "2026-07-10",
        updatedAt: "2026-07-10",
        entries: [
          { ticker: "BTC", category: "top_asset", names: ["Bitcoin"] },
          { ticker: "HOOD", category: "stock_token", names: ["Robinhood"] },
        ],
      },
    uncollectedFees: overrides.uncollectedFees ?? { async read() {
      return { token: "0", weth: "0" };
    } },
    walletBalance: overrides.walletBalance ?? { async read() {
      return "0";
    } },
    // Default: null live balance ⇒ route uses the accrued − claimed mirror.
    creatorVaultBalance: overrides.creatorVaultBalance ?? { async read() {
      return null;
    } },
    // Hermetic OG image inliner: no network in tests → always the monogram path.
    ogImage: overrides.ogImage ?? (async () => null),
    now: overrides.now ?? (() => 1_700_000_300_000),
    secureCookies: overrides.secureCookies ?? false,
  };
}
