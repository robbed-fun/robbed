/**
 * Ponder DB schema (indexer.md §3) — the seven reorg-tracked, Ponder-managed
 * tables (§7.3): tokens, trades, transfers, graduations, fee_collections,
 * balances, candles.
 *
 * The relational shapes (snake_case column names + types) are the NORMATIVE
 * §3 shapes and MUST match `@robbed/shared` db-rows (TokenRow, TradeRowDb,
 * TransferRow, GraduationRow, FeeCollectionRow, BalanceRow, CandleRow) — the
 * shared types are the source of truth and the API reads these tables by those
 * snake_case names. Ponder/Drizzle would otherwise name columns after the JS
 * property (camelCase), so EVERY column passes an explicit snake_case DB name;
 * handlers still use the camelCase JS keys.
 *
 * ONE deliberate exception (OI-11 / spec §12.48c): the shared db-row types'
 * `confirmation_state` field is NOT a stored column here. Per-row storage on
 * Ponder tables cannot be maintained (the indexing-store cache silently
 * reverts external UPDATEs on handler-mutated rows — decisions.md §11), so the
 * tier is DERIVED at read time from `block_number` vs the offchain
 * `confirmation_watermarks` sidecar singleton (§3.8): the API's SELECTs emit a
 * derived `confirmation_state` column (`apps/api/src/lib/confirmation.ts`),
 * satisfying the shared row shapes without any write-back.
 *
 * Type mapping (Ponder 0.16, verified against ponder.sh docs):
 * - uint256 amounts        → t.bigint()          (NUMERIC(78,0), JS bigint)
 * - L2 block/ts (bigint)   → t.bigint()          (NUMERIC — avoids int4 overflow
 *                                                  on a ~100ms L2; API coerces to
 *                                                  number, < 2^53 per db-rows)
 * - log_index / small ints → t.integer()         (int4)
 * - display-only prices    → t.doublePrecision() (float8; float4 `real()` would
 *                                                  lose precision on ETH prices)
 * - addresses/hashes/enums → t.text()            (stored lowercase, §3 convention;
 *                                                  confirmation_state/venue CHECK
 *                                                  enforced app-side by shared zod)
 * - links jsonb            → t.json()
 *
 * The §3.8-§3.11 [offchain] tables and the §8.5 flow tables are NOT here — they
 * live in `migrations/` (plain SQL, schema `public`) because side processes
 * write them and they must not be rolled back by Ponder reorg handling (§7.3).
 * pg_trgm GIN search indexes are applied by `migrations/0003_trgm_gin_indexes.sql`.
 */
import { index, onchainTable, primaryKey } from "ponder";

// ── §3.1 tokens ─────────────────────────────────────────────────────────────
export const tokens = onchainTable(
  "tokens",
  (t) => ({
    address: t.text("address").primaryKey(),
    curveAddress: t.text("curve_address").notNull(),
    creator: t.text("creator").notNull(), // §7: from day 1
    creatorFeeBps: t.integer("creator_fee_bps").notNull().default(0), // §7: 0 in v1
    // §12.40d: per-token immutable snapshot of the curve's TRADE_FEE_BPS, read
    // from the BondingCurve at TokenCreated (NOT factory config — setTradeFeeBps
    // only affects future curves). Trust-panel `feePolicy.tradeFeeBps` source.
    // NOTE: @robbed/shared `TokenRow` must gain `trade_fee_bps: number` to
    // mirror this column (reported as a shared gap — hoodpad-shared ratifies).
    tradeFeeBps: t.integer("trade_fee_bps").notNull(),
    name: t.text("name").notNull(),
    ticker: t.text("ticker").notNull(),
    metadataHash: t.text("metadata_hash").notNull(), // bytes32 hex, verbatim (§8.3)
    metadataUri: t.text("metadata_uri"),
    imageUrl: t.text("image_url"), // from verified metadata JSON (null until fetch)
    description: t.text("description"),
    links: t.json("links"),
    totalSupply: t.bigint("total_supply").notNull(),
    // live curve state
    virtualEth: t.bigint("virtual_eth").notNull(),
    virtualToken: t.bigint("virtual_token").notNull(),
    realEthReserves: t.bigint("real_eth_reserves").notNull().default(0n),
    realTokenReserves: t.bigint("real_token_reserves").notNull(), // X-4: seeded = CURVE_SUPPLY
    graduationEth: t.bigint("graduation_eth").notNull(),
    // venue
    graduated: t.boolean("graduated").notNull().default(false),
    v3PoolAddress: t.text("v3_pool_address"),
    graduatedAt: t.bigint("graduated_at"),
    // denormalized market stats (derived, rebuildable)
    lastPriceEth: t.doublePrecision("last_price_eth"),
    volumeEth24h: t.bigint("volume_eth_24h").notNull().default(0n),
    tradeCount: t.bigint("trade_count").notNull().default(0n),
    holderCount: t.integer("holder_count").notNull().default(0),
    // provenance (confirmation tier derived at read time — see header, OI-11)
    createdAt: t.bigint("created_at").notNull(),
    blockNumber: t.bigint("block_number").notNull(),
    txHash: t.text("tx_hash").notNull(),
    logIndex: t.integer("log_index").notNull(),
  }),
  (table) => ({
    createdAtIdx: index().on(table.createdAt),
    volume24hIdx: index().on(table.volumeEth24h),
    progressIdx: index().on(table.graduated, table.realEthReserves),
    blockNumberIdx: index().on(table.blockNumber), // provenance / range reads
    txLogIdx: index().on(table.txHash, table.logIndex), // (tx,log) dedup lookup
  }),
);

// ── §3.2 trades (unified curve `Trade` + V3 `Swap`, venue discriminator) ─────
export const trades = onchainTable(
  "trades",
  (t) => ({
    id: t.text("id").primaryKey(), // `${txHash}-${logIndex}`
    tokenAddress: t.text("token_address").notNull(),
    trader: t.text("trader").notNull(),
    venue: t.text("venue").notNull().default("curve"), // 'curve' | 'v3'
    isBuy: t.boolean("is_buy").notNull(),
    ethAmount: t.bigint("eth_amount").notNull(),
    tokenAmount: t.bigint("token_amount").notNull(),
    feeEth: t.bigint("fee_eth").notNull(), // 0 for v3 rows
    priceEth: t.doublePrecision("price_eth").notNull(),
    blockNumber: t.bigint("block_number").notNull(),
    blockTimestamp: t.bigint("block_timestamp").notNull(),
    txHash: t.text("tx_hash").notNull(),
    logIndex: t.integer("log_index").notNull(),
  }),
  (table) => ({
    tokenTimeIdx: index().on(table.tokenAddress, table.blockTimestamp),
    traderIdx: index().on(table.trader, table.blockTimestamp), // Phase-2 portfolio
    blockNumberIdx: index().on(table.blockNumber),
  }),
);

// ── §3.6 transfers (sixth event family, sole balance-truth anchor, X-5) ──────
export const transfers = onchainTable(
  "transfers",
  (t) => ({
    id: t.text("id").primaryKey(), // `${txHash}-${logIndex}` (dedup anchor)
    tokenAddress: t.text("token_address").notNull(),
    fromAddress: t.text("from_address").notNull(),
    toAddress: t.text("to_address").notNull(),
    value: t.bigint("value").notNull(),
    blockNumber: t.bigint("block_number").notNull(),
    blockTimestamp: t.bigint("block_timestamp").notNull(),
    txHash: t.text("tx_hash").notNull(),
    logIndex: t.integer("log_index").notNull(),
  }),
  (table) => ({
    tokenTimeIdx: index().on(table.tokenAddress, table.blockTimestamp),
    blockNumberIdx: index().on(table.blockNumber),
  }),
);

// ── §3.3 graduations (single-fire per token) ────────────────────────────────
export const graduations = onchainTable(
  "graduations",
  (t) => ({
    tokenAddress: t.text("token_address").primaryKey(), // single-fire (gate-2)
    poolAddress: t.text("pool_address").notNull(),
    lpTokenId: t.bigint("lp_token_id").notNull(),
    tokenIsToken0: t.boolean("token_is_token0").notNull(), // cached orientation (X-2)
    ethToLp: t.bigint("eth_to_lp").notNull(),
    tokensToLp: t.bigint("tokens_to_lp").notNull(),
    graduationFeeEth: t.bigint("graduation_fee_eth").notNull(),
    caller: t.text("caller").notNull(),
    blockNumber: t.bigint("block_number").notNull(),
    blockTimestamp: t.bigint("block_timestamp").notNull(),
    txHash: t.text("tx_hash").notNull(),
    logIndex: t.integer("log_index").notNull(),
  }),
  (table) => ({
    blockNumberIdx: index().on(table.blockNumber),
    poolIdx: index().on(table.poolAddress),
  }),
);

// ── §3.5 fee_collections (V3 Collect on the LPFeeVault position) ─────────────
export const feeCollections = onchainTable(
  "fee_collections",
  (t) => ({
    id: t.text("id").primaryKey(), // `${txHash}-${logIndex}`
    tokenAddress: t.text("token_address").notNull(),
    poolAddress: t.text("pool_address").notNull(),
    lpTokenId: t.bigint("lp_token_id").notNull(),
    recipient: t.text("recipient").notNull(), // must equal treasury; alert otherwise
    amountToken: t.bigint("amount_token").notNull(), // oriented via token_is_token0
    amountWeth: t.bigint("amount_weth").notNull(),
    blockNumber: t.bigint("block_number").notNull(),
    blockTimestamp: t.bigint("block_timestamp").notNull(),
    txHash: t.text("tx_hash").notNull(),
    logIndex: t.integer("log_index").notNull(),
  }),
  (table) => ({
    tokenIdx: index().on(table.tokenAddress, table.blockTimestamp),
    blockNumberIdx: index().on(table.blockNumber),
  }),
);

// ── §3.6 balances (Transfer-driven; cost-basis columns from Trade/Swap) ──────
export const balances = onchainTable(
  "balances",
  (t) => ({
    tokenAddress: t.text("token_address").notNull(),
    holder: t.text("holder").notNull(),
    balance: t.bigint("balance").notNull().default(0n), // written ONLY by Transfer
    totalBoughtTokens: t.bigint("total_bought_tokens").notNull().default(0n),
    totalSoldTokens: t.bigint("total_sold_tokens").notNull().default(0n),
    totalEthIn: t.bigint("total_eth_in").notNull().default(0n),
    totalEthOut: t.bigint("total_eth_out").notNull().default(0n),
    firstSeenAt: t.bigint("first_seen_at").notNull(),
    lastActiveAt: t.bigint("last_active_at").notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.tokenAddress, table.holder] }),
    topHoldersIdx: index().on(table.tokenAddress, table.balance),
    holderIdx: index().on(table.holder), // portfolio lookup (Phase 2)
  }),
);

// ── §3.7 candles (derived, rebuildable; six intervals) ──────────────────────
export const candles = onchainTable(
  "candles",
  (t) => ({
    tokenAddress: t.text("token_address").notNull(),
    interval: t.text("interval").notNull(), // '1s'|'15s'|'1m'|'5m'|'15m'|'1h'
    bucketStart: t.bigint("bucket_start").notNull(),
    open: t.doublePrecision("open").notNull(),
    high: t.doublePrecision("high").notNull(),
    low: t.doublePrecision("low").notNull(),
    close: t.doublePrecision("close").notNull(),
    volumeEth: t.bigint("volume_eth").notNull(),
    volumeToken: t.bigint("volume_token").notNull(),
    tradeCount: t.integer("trade_count").notNull(),
    lastBlockNumber: t.bigint("last_block_number").notNull(), // high-water mark
    lastLogIndex: t.integer("last_log_index").notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.tokenAddress, table.interval, table.bucketStart] }),
  }),
);
