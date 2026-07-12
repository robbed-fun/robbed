# Service Design — Indexer (`apps/indexer`, Ponder)

**Status:** Design v1.0 — drives M2 implementation. Implementation must be a transcription of this document; deviations require an update here first.
**Spec coverage:** §2 (no hardcoded market metrics), §2.1 (confirmation semantics), §5.1/§5.2 (data the frontend consumes), §7 (creator tracking from day 1), §8 (off-chain architecture), §8.3 (metadata integrity), §10 gate 7 (monitoring), §13 (open items honored, not resolved here).
**Runtime:** Ponder in a Node container (§8) → Postgres (+`pg_trgm`) → Redis pub/sub. Upstream RPC: Alchemy WS. Chain ID 4663.

---

## 1. Purpose

The indexer is the single source of derived truth for ROBBED_:

1. Indexes the six event families (§8, §12.15–16): `TokenCreated`, `Trade`, `Graduated`, LaunchToken `Transfer`, V3 `Swap`, V3 `Collect`.
2. Maintains **venue-continuous** price/candle series per token across graduation (§5.2, §8) — one unbroken series from curve trades into V3 swaps.
3. Tracks **confirmation state** per indexed event: `soft_confirmed` → `posted_to_l1` → `finalized` (§2.1) — derived at read time from the `confirmation_watermarks` sidecar (§3.8/§5, spec §12.48c; per-row storage on Ponder tables is impossible, OI-11).
4. Verifies metadata integrity: R2 JSON vs on-chain `metadataHash` commitment (§8.3) — feeds the Trust panel (§5.2).
5. Maintains holder balances (portfolio-ready from day 1, §5.4) and `creator` / `creatorFeeBps` per token from day 1 (§7).
6. Publishes every indexed event to Redis for the Bun WS fanout with a <500ms event-to-browser target (§8).
7. Feeds the treasury fee-accrual dashboard from V3 `Collect` (§6.4 post-graduation revenue, §8).

Non-goals: the indexer never writes chain state, never gates listings by chain-side action (§8.4 — moderation is listing-only and lives in the API), and never computes USD figures from inline constants (§2 — ETH/USD comes from the `eth_usd_snapshots` table, sourced live and timestamped).

## 2. Configuration & addresses

All addresses come from config — never hardcoded except canonical WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (CLAUDE.md).

```
INDEXER_RPC_WS            Alchemy WS RPC for chain 4663
INDEXER_RPC_HTTP          HTTP fallback / historical backfill
CURVE_FACTORY_ADDRESS     from deploy artifacts (M1 output)
ROUTER_ADDRESS            from deploy artifacts (M1 output)
V3_FACTORY_ADDRESS        OPEN ITEM §13 — from official Uniswap registry at implementation time; startup MUST fail if unset
V3_NPM_ADDRESS            OPEN ITEM §13 — NonfungiblePositionManager, same rule
WETH_ADDRESS              0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 (asserted at startup, not configurable)
REDIS_URL                 pub/sub
DATABASE_URL              Postgres (pg_trgm extension required; migration asserts it)
R2_METADATA_BASE_URL      CDN base for canonical metadata JSON
ETH_USD_SOURCE_URL        HTTP fallback price source for snapshots (DefiLlama/Coinbase; see §3.9)
CHAINLINK_ETH_USD_FEED    §12.51 Chainlink ETH/USD proxy; default 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9; 'off' disables (LOCAL/TESTNET)
ETH_USD_POLL_INTERVAL_MS  poller cadence, default 30000 (§3.9 band 30–60s)
ETH_USD_CHAINLINK_STALENESS_SECONDS  reject feed answers older than this, default 3600 (§3.9)
START_BLOCK               factory deploy block (backfill floor)
```

Startup assertions: `pg_trgm` installed; V3 addresses present and non-zero; WETH matches the canonical constant; chain ID from RPC == 4663.

## 3. Event inventory & Postgres schema

Event signatures below are the **canonical shapes ratified in spec §12.15** and normatively defined in `docs/how-it-works/contracts.md` §2 (contracts.md is authoritative for ABIs; this doc mirrors them). M1 artifacts must match byte-for-byte; **any divergence at implementation time is reported to robbed-architect, not worked around** (OI-1, resolved — the shapes are now a contract, not an assumption).

Ponder note: tables are declared in `ponder.schema.ts`; the SQL below is the *target relational shape* Ponder must produce (Ponder generates DDL from the schema file — column names/types below are normative, exact DDL is Ponder's). Tables marked **[offchain]** are written outside Ponder's reorg-tracked store (see §7.3) because they are updated by side processes (confirmation tracker, metadata verifier, moderation sync) and must not be rolled back by Ponder reorg handling.

Conventions: addresses stored lowercase `text` (checksumming is a display concern); amounts `numeric(78,0)` (uint256-safe); timestamps `bigint` unix seconds from block timestamp (block.timestamp is reliable on Orbit; `block.number` on-chain is not — off-chain we store the **L2 block number from the log**, which is the real L2 sequence and safe to use); every event table carries the idempotency key `(tx_hash, log_index)` as primary key or unique.

### 3.1 `TokenCreated` (CurveFactory)

Canonical shape (spec §12.15, contracts.md §2.2):
```solidity
event TokenCreated(
  address indexed token,
  address indexed curve,
  address indexed creator,
  string  name,
  string  symbol,
  bytes32 metadataHash,
  string  metadataUri,      // R2 canonical JSON URL (event-only; hash is the commitment)
  address pool              // V3 pool, pre-created+initialized at creation (§6.3.2)
);
```

Initial `virtual_eth`/`virtual_token` and `graduation_eth` are **factory immutables** (contracts.md §2.2), read once at indexer startup from `CurveFactory.config()` (→ `virtualEth0`/`virtualToken0`/`graduationEth`/`curveSupply`/`lpTranche`) via the **shared read-function ABI in `packages/shared/src/abi/` (§12.38)** and cached; no per-event RPC. **This `config()` read supersedes the env-interim curve-constants source** used before the shared read-ABI landed (M2-4 note); the read ABI is a compilation-time artifact (needs only `forge build`, no deploy — contracts.md §7.4). Block timestamp comes from the log's block. The creator's initial buy (if any) arrives as the first `Trade` in the same tx (§12.15 — not in this event; capture path + fallback in §7.4). `v3_pool_address` is populated here from `pool` (the pool exists pre-graduation by design), but V3 `Swap` indexing still begins only at `Graduated` (§12.16).

**Per-token `trade_fee_bps` (§12.40d).** `setTradeFeeBps` governs future curves only, so the live factory config would misreport the fee of any curve created under a prior fee. At `TokenCreated` the handler reads the curve's public `TRADE_FEE_BPS` immutable (via the §12.38 shared read-ABI — creation is low-frequency, not a hot path) and stores it as `tokens.trade_fee_bps`, a per-token immutable snapshot. This column is the source for the API `trust.feePolicy.tradeFeeBps` (api.md §3.4) — never the factory config. **Wiring follow-up (2026-07-10, decisions §7):** the shared `db-rows.ts` `TokenRow` type carries `trade_fee_bps: number`, and the API card/detail projection reads it from this column — **not** from `apps/api/src/config.ts` (config is factory-current and would misreport older curves). Owner: **hoodpad-shared** (type) + hoodpad-indexer/API (wire).

Fields consumed: all. Derived records: one `tokens` row; `metadata_verifications` row seeded `unfetched`; WS publish to `global:launches` and `token:{address}:events`.

```sql
CREATE TABLE tokens (
  address              text PRIMARY KEY,           -- LaunchToken address
  curve_address        text NOT NULL UNIQUE,
  creator              text NOT NULL,              -- §7: day 1, even though creator fees are Phase 2
  creator_fee_bps      integer NOT NULL DEFAULT 0, -- §7: 0 in v1; column exists so Phase 2 needs no migration
  trade_fee_bps        integer NOT NULL,           -- §12.40d: per-token immutable snapshot, read from curve TRADE_FEE_BPS at TokenCreated (NOT factory config); Trust-panel source
  name                 text NOT NULL,
  ticker               text NOT NULL,              -- ≤10 chars enforced upstream; indexer stores verbatim
  metadata_hash        text NOT NULL,              -- bytes32 hex, verbatim from chain (§8.3)
  metadata_uri         text,                       -- R2 canonical JSON URL
  image_url            text,                       -- extracted from verified metadata JSON (null until fetch)
  description          text,                       -- extracted from verified metadata JSON
  links                jsonb,                      -- extracted from verified metadata JSON
  total_supply         numeric(78,0) NOT NULL,     -- 1e27 (1B * 1e18); stored, never assumed in queries
  -- live curve state (updated on every Trade; read by Trust panel §5.2)
  virtual_eth          numeric(78,0) NOT NULL,
  virtual_token        numeric(78,0) NOT NULL,
  real_eth_reserves    numeric(78,0) NOT NULL DEFAULT 0,
  real_token_reserves  numeric(78,0) NOT NULL,
  graduation_eth       numeric(78,0) NOT NULL,     -- threshold, read from factory config at index time
  -- venue
  graduated            boolean NOT NULL DEFAULT false,
  v3_pool_address      text,                       -- set at TokenCreated (pool in event, §12.15); Swap indexing starts at Graduated (§12.16)
  graduated_at         bigint,
  -- denormalized market stats (derived, rebuildable; §5.1 card + sorts)
  last_price_eth       numeric,                    -- price in ETH per token (float acceptable: display-only)
  volume_eth_24h       numeric(78,0) NOT NULL DEFAULT 0,
  trade_count          bigint NOT NULL DEFAULT 0,
  holder_count         bigint NOT NULL DEFAULT 0,
  -- provenance / confirmation
  created_at           bigint NOT NULL,            -- block timestamp
  block_number         bigint NOT NULL,            -- L2 block from log
  tx_hash              text NOT NULL,
  log_index            integer NOT NULL,
  -- confirmation tier: NOT stored (OI-11/§12.48c) — derived at read time from
  -- block_number vs the confirmation_watermarks sidecar (§3.8, §5)
  UNIQUE (tx_hash, log_index)
);

-- §5.1 search: pg_trgm over name, ticker, contract address, creator address
CREATE INDEX tokens_name_trgm_idx    ON tokens USING gin (name gin_trgm_ops);
CREATE INDEX tokens_ticker_trgm_idx  ON tokens USING gin (ticker gin_trgm_ops);
CREATE INDEX tokens_address_trgm_idx ON tokens USING gin (address gin_trgm_ops);
CREATE INDEX tokens_creator_trgm_idx ON tokens USING gin (creator gin_trgm_ops);
-- §5.1 sorts
CREATE INDEX tokens_created_at_idx   ON tokens (created_at DESC);
CREATE INDEX tokens_volume_24h_idx   ON tokens (volume_eth_24h DESC);
CREATE INDEX tokens_progress_idx     ON tokens (graduated, real_eth_reserves DESC);  -- King of the Hill / progress sort
CREATE INDEX tokens_block_number_idx ON tokens (block_number);                        -- provenance / range reads
```

Notes:
- `graduation_eth` is read from factory constants (event or contract read at handler time), never hardcoded (§6.4 constants are deploy-time).
- Mcap/price are **never stored in USD**: USD is computed at query/render time as `price_eth × eth_usd_snapshot` (§2, hard rule). See §3.9.
- `image_url`/`description`/`links` are populated **only** from metadata JSON that has been fetched (any verification verdict); the Trust panel decides how to badge mismatches. Listing visibility is the API's moderation concern, not the indexer's.

### 3.2 `Trade` (emitted by each BondingCurve)

Canonical shape (spec §12.15, contracts.md §2.3) — emitted **on the curve** (curves registered as Ponder factory children via `TokenCreated`; `token` derived from the emitting curve address, not an event field):
```solidity
event Trade(
  address indexed trader,
  bool    indexed isBuy,
  uint256 ethAmount,           // GROSS ETH leg (fee included); net = ethAmount − fee (§12.15)
  uint256 tokenAmount,
  uint256 fee,                 // ETH-leg fee → treasury (§6.4), computed in-contract (§4.1)
  uint256 virtualEthReserves,  // post-trade reserves → exact price with zero RPC reads
  uint256 virtualTokenReserves,
  uint256 realEthReserves
);
```
Block timestamp from the log's block. Token status for the API is derived, not stored: `curve` while trading, `graduating` when `real_eth_reserves ≥ graduation_eth AND NOT graduated` (the §12.12 lock window), `graduated` after `Graduated`.

Derived records: `trades` row; `tokens` live-state update (reserves, last_price, counters); `balances` **cost-basis columns only** for the trader (see balance-write ownership below); candle upsert into all intervals (§4); WS publish to `token:{addr}:trades` + `global:trades`.

**`real_token_reserves` maintenance (X-4).** The `Trade` event carries `virtualEthReserves`/`virtualTokenReserves`/`realEthReserves` (post-trade) but **not** `realTokenReserves`. The indexer maintains `tokens.real_token_reserves` incrementally: **seed `= CURVE_SUPPLY` on `TokenCreated`** (a factory immutable, cached at startup like the other curve constants), then on each `Trade` apply `real_token_reserves -= token_amount` on a buy and `+= token_amount` on a sell. The `(tx_hash, log_index)` idempotency key on `trades` makes the delta re-apply-safe.

**Balance-write ownership (X-4, ratifies §12.16).** The `balances.balance` column and `tokens.holder_count` are written **only** by the `Transfer` handler (§3.6 — the sole source of balance truth). The `Trade` and V3 `Swap` handlers **never** touch `balance`/`holder_count`; they write only the cost-basis columns (`total_bought_tokens`, `total_sold_tokens`, `total_eth_in`, `total_eth_out` — exact for curve legs, best-effort for V3 per OI-5). This removes the former double-count between the trade/swap handlers and the Transfer handler.

```sql
CREATE TABLE trades (
  id                   text PRIMARY KEY,           -- `${tx_hash}-${log_index}`
  token_address        text NOT NULL REFERENCES tokens(address),
  trader               text NOT NULL,
  venue                text NOT NULL DEFAULT 'curve' CHECK (venue IN ('curve','v3')),  -- unified with V3 swaps, §3.4
  is_buy               boolean NOT NULL,
  eth_amount           numeric(78,0) NOT NULL,     -- ETH leg (wei)
  token_amount         numeric(78,0) NOT NULL,
  fee_eth              numeric(78,0) NOT NULL,     -- 0 for v3 rows (fee lives in the pool; Collect tracks it)
  price_eth            numeric NOT NULL,           -- ETH per token, from post-trade reserves (curve) or sqrtPriceX96 (v3)
  block_number         bigint NOT NULL,
  block_timestamp      bigint NOT NULL,
  tx_hash              text NOT NULL,
  log_index            integer NOT NULL,
  -- confirmation tier: NOT stored (OI-11/§12.48c) — derived at read time from
  -- block_number vs the confirmation_watermarks sidecar (§3.8, §5)
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX trades_token_time_idx   ON trades (token_address, block_timestamp DESC);
CREATE INDEX trades_trader_idx       ON trades (trader, block_timestamp DESC);   -- Phase-2 portfolio ready (§5.4)
CREATE INDEX trades_block_number_idx ON trades (block_number);                    -- `since` backfill / range reads
```

**Design decision — unified trades table:** curve `Trade` and V3 `Swap` both insert into `trades` with a `venue` discriminator. This is what makes venue continuity (§5.2) structurally trivial: the candle pipeline and trade feed read one table ordered by `(block_number, log_index)` and never special-case graduation. *Interpretation, recommended default* — the spec says "one series" but not one table; a two-table union view would also satisfy it at higher complexity for zero benefit.

Price derivation:
- Curve: `price_eth = virtualEth_post / virtualToken_post` (constant-product spot after the trade). Post-trade reserves are in the event (ratified §12.15) — no contract read in the hot path.
- V3: `price_eth` (WETH per token) `= f(sqrtPriceX96)` from the `Swap` event, adjusted for token0/token1 ordering vs WETH (both 18 decimals). The raw ratio `(sqrtPriceX96/2^96)^2` is **token1 per token0**. Since we want WETH per token: when the token is **token0** (WETH is token1, i.e. `token < WETH`) the raw ratio is already WETH-per-token — **use it directly**; when the token is **token1** (WETH is token0, i.e. `token > WETH`) the raw ratio is token-per-WETH — **invert it** (`1 / raw`). Orientation = `graduations.token_is_token0` (`token < WETH`), resolved per-pool at graduation and cached; the fork test (contracts.md §6 gate 3) arbitrates the sign. *(Prior text said "inverted if token is token0" — that was backwards.)*

### 3.3 `Graduated` (V3Migrator)

Canonical shape (contracts.md §2.5):
```solidity
event Graduated(
  address indexed token,
  address indexed pool,        // V3 1% pool
  uint256 indexed tokenId,     // LP NFT held by LPFeeVault → graduations.lp_token_id
  uint128 liquidity,
  uint256 wethInPosition,      // → graduations.eth_to_lp
  uint256 tokensInPosition,    // → graduations.tokens_to_lp
  uint256 graduationFee,
  address caller,              // permissionless graduate() caller (§6.2)
  uint256 callerReward,
  uint256 tokensBurned,        // token dust → 0xdEaD (§12.13)
  uint256 wethDustToTreasury   // WETH dust → treasury (§12.13)
);
```
`token_is_token0` is derived (`token < WETH` address comparison), cached on the row.

Derived records: `graduations` row; `tokens.graduated = true`, `v3_pool_address`, `graduated_at`; **dynamic registration of the pool for V3 Swap/Collect indexing** (Ponder factory pattern over discovered pool addresses — see §7.4); WS publish `token:{addr}:events` type `graduated` + `global:launches`.

```sql
CREATE TABLE graduations (
  token_address        text PRIMARY KEY REFERENCES tokens(address),  -- single-fire (§10 gate 2 invariant)
  pool_address         text NOT NULL UNIQUE,
  lp_token_id          numeric(78,0) NOT NULL,
  token_is_token0      boolean NOT NULL,           -- cached pool orientation for price math
  eth_to_lp            numeric(78,0) NOT NULL,
  tokens_to_lp         numeric(78,0) NOT NULL,
  graduation_fee_eth   numeric(78,0) NOT NULL,
  caller               text NOT NULL,
  block_number         bigint NOT NULL,
  block_timestamp      bigint NOT NULL,
  tx_hash              text NOT NULL,
  log_index            integer NOT NULL,
  -- confirmation tier: NOT stored (OI-11/§12.48c) — derived at read time from
  -- block_number vs the confirmation_watermarks sidecar (§3.8, §5)
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX graduations_block_number_idx ON graduations (block_number);
```

### 3.4 V3 `Swap` (graduated pools only)

Canonical Uniswap V3 shape (stable, not an assumption):
```solidity
event Swap(address indexed sender, address indexed recipient,
           int256 amount0, int256 amount1,
           uint160 sqrtPriceX96, uint128 liquidity, int24 tick);
```

Consumed: `recipient` (→ `trader`; note this is the swap router's recipient, not necessarily the EOA — acceptable, flagged in feed UI as venue=v3), `amount0/amount1` (signs give direction; mapped to `is_buy` = pool paid out token to recipient), `sqrtPriceX96` (→ `price_eth`). Derived records: `trades` row with `venue='v3'`, `fee_eth=0`; `tokens.last_price_eth` + `volume_eth_24h`; candle upsert; **cost-basis columns only** for `recipient` (best-effort — see OI-5); **`balance`/`holder_count` are NOT written here** — the `Transfer` handler owns them (X-4 balance-write ownership, §3.2/§3.6); WS publish same channels as curve trades.

Only pools registered in `graduations` are indexed (Ponder factory config keyed on `Graduated`). Pools exist pre-graduation (§6.3 pre-seed defense) — **pre-graduation pool activity is not part of the price series and is not indexed** (ratified §12.16: the curve is the sole venue until `Graduated`; pool griefing is covered by gate-7 alerting on migrator events, not by indexing anomaly swaps).

### 3.5 V3 `Collect` (graduated pools, LPFeeVault position)

Canonical shape:
```solidity
event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1);
```
Indexed on the NonfungiblePositionManager (address from config, §13), filtered to `tokenId ∈ graduations.lp_token_id`. Feeds the treasury fee-accrual dashboard (§6.4, §8).

```sql
CREATE TABLE fee_collections (
  id                   text PRIMARY KEY,           -- tx_hash-log_index
  token_address        text NOT NULL REFERENCES tokens(address),
  pool_address         text NOT NULL,
  lp_token_id          numeric(78,0) NOT NULL,
  recipient            text NOT NULL,              -- must equal treasury; alert if not (monitoring §8 of this doc)
  amount_token         numeric(78,0) NOT NULL,     -- oriented via graduations.token_is_token0
  amount_weth          numeric(78,0) NOT NULL,
  block_number         bigint NOT NULL,
  block_timestamp      bigint NOT NULL,
  tx_hash              text NOT NULL,
  log_index            integer NOT NULL,
  -- confirmation tier: NOT stored (OI-11/§12.48c) — derived at read time from
  -- block_number vs the confirmation_watermarks sidecar (§3.8, §5)
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX fee_collections_token_idx ON fee_collections (token_address, block_timestamp DESC);
CREATE INDEX fee_collections_block_number_idx ON fee_collections (block_number);
```

Uncollected (accrued-but-unclaimed) fees are a point-in-time contract read, not indexed state; the dashboard endpoint reads `tokensOwed` via RPC on demand (API concern).

### 3.6 Holder balances (portfolio-ready day 1, §5.4/§7)

**Ratified (spec §12.16): the LaunchToken ERC-20 `Transfer` event is the sixth indexed event family and the sole source of balance truth** (curve trades are just a special case of Transfer) — the only exact way to satisfy §5.2 holder distribution and §5.4 portfolio readiness, since V3 swaps move tokens via the pool and users transfer freely. Registered dynamically per token via the factory pattern, same as pools. Cost-basis fields (`total_eth_in/out`) remain exact for curve legs and best-effort for V3 legs (§12.16).

**Per-event `transfers` table (X-5 — idempotency anchor).** Balance updates are increments, so they need a dedup key or a re-delivered log double-counts. Every `Transfer` is persisted as its own row keyed `(tx_hash, log_index)`; the balance deltas (`balances.balance ± value`, `holder_count` transitions) are applied **in the same handler, guarded by the `transfers` insert** — re-delivery of the same `(tx_hash, log_index)` is a conflict/no-op, so the balance mutation runs exactly once. This is what makes the §7.1 idempotency claim true for the Transfer family; the `rebuild` script (§4.4) replays `transfers` in `(block_number, log_index)` order to reconstruct `balances` exactly.

```sql
CREATE TABLE transfers (
  id                   text PRIMARY KEY,           -- `${tx_hash}-${log_index}` (dedup anchor)
  token_address        text NOT NULL REFERENCES tokens(address),
  from_address         text NOT NULL,
  to_address           text NOT NULL,
  value                numeric(78,0) NOT NULL,
  block_number         bigint NOT NULL,
  block_timestamp      bigint NOT NULL,
  tx_hash              text NOT NULL,
  log_index            integer NOT NULL,
  -- confirmation tier: NOT stored (OI-11/§12.48c) — derived at read time from
  -- block_number vs the confirmation_watermarks sidecar (§3.8, §5)
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX transfers_token_time_idx ON transfers (token_address, block_timestamp DESC);
CREATE INDEX transfers_block_number_idx ON transfers (block_number);
```

```sql
CREATE TABLE balances (
  token_address        text NOT NULL REFERENCES tokens(address),
  holder               text NOT NULL,
  balance              numeric(78,0) NOT NULL,
  -- portfolio-ready fields (Phase 2 reads these; written from day 1)
  total_bought_tokens  numeric(78,0) NOT NULL DEFAULT 0,
  total_sold_tokens    numeric(78,0) NOT NULL DEFAULT 0,
  total_eth_in         numeric(78,0) NOT NULL DEFAULT 0,   -- ETH spent buying (curve trades; v3 best-effort, OI-5)
  total_eth_out        numeric(78,0) NOT NULL DEFAULT 0,   -- ETH received selling
  first_seen_at        bigint NOT NULL,
  last_active_at       bigint NOT NULL,
  PRIMARY KEY (token_address, holder)
);
CREATE INDEX balances_top_holders_idx ON balances (token_address, balance DESC);  -- top-20 (§5.2)
CREATE INDEX balances_holder_idx      ON balances (holder);                        -- portfolio lookup (Phase 2)
```

Holder distribution flags (creator/curve/vault, §5.2) are computed at query time by joining against `tokens.creator`, `tokens.curve_address`, and the vault/pool addresses — not stored.

`tokens.holder_count` maintained incrementally (balance transitions 0→positive / positive→0).

### 3.7 Candles (derived, rebuildable — §4)

```sql
CREATE TABLE candles (
  token_address        text NOT NULL REFERENCES tokens(address),
  interval             text NOT NULL CHECK (interval IN ('1s','15s','1m','5m','15m','1h')),
  bucket_start         bigint NOT NULL,            -- unix seconds, floor(ts / interval_seconds) * interval_seconds
  open                 numeric NOT NULL,           -- ETH per token
  high                 numeric NOT NULL,
  low                  numeric NOT NULL,
  close                numeric NOT NULL,
  volume_eth           numeric(78,0) NOT NULL,
  volume_token         numeric(78,0) NOT NULL,
  trade_count          integer NOT NULL,
  last_block_number    bigint NOT NULL,            -- high-water mark for idempotent re-apply
  last_log_index       integer NOT NULL,
  PRIMARY KEY (token_address, interval, bucket_start)
);
```

### 3.8 Confirmation tracking **[offchain]** (§2.1, §5)

```sql
CREATE TABLE confirmation_watermarks (
  id                   integer PRIMARY KEY CHECK (id = 1),   -- singleton
  latest_block         bigint NOT NULL,            -- head seen (soft-confirmed boundary)
  safe_block           bigint NOT NULL,            -- highest L2 block posted to L1
  finalized_block      bigint NOT NULL,            -- highest L2 block finalized on L1
  updated_at           timestamptz NOT NULL
);
```

Authoritative rule: an event's state is `finalized` if `block_number <= finalized_block`, else `posted_to_l1` if `<= safe_block`, else `soft_confirmed`. This singleton IS the §12.48c sidecar: per-row `confirmation_state` is **not stored anywhere** — it is **derived at read time** from `block_number` vs these watermarks (OI-11 verdict, §7.3: external per-row writes into Ponder tables are silently reverted by the indexing-store cache and forbidden by Ponder's docs). The API emits the derived value as a `confirmation_state` SELECT column (`apps/api/src/lib/confirmation.ts` `confirmationStateSql`) so the shared db-row shapes are unchanged; DTO projections use the same shared `stateForBlock` rule. One rule, one storage location — the two derivation surfaces can never disagree.

### 3.9 ETH/USD snapshots **[offchain]** (§2 hard rule)

```sql
CREATE TABLE eth_usd_snapshots (
  fetched_at           timestamptz PRIMARY KEY,
  price_usd            numeric NOT NULL,
  source               text NOT NULL               -- e.g. 'chainlink:4663', 'defillama'
);
```
A small poller (inside the indexer container) writes a snapshot every 30–60s. Every USD figure anywhere in the product is `eth_value × latest snapshot`, rendered with the snapshot timestamp available. Source priority: Chainlink ETH/USD feed on 4663 if one exists (check at implementation time), else an HTTPS source (DefiLlama/Coinbase) — configured, never inline (OI-6).

**Status: IMPLEMENTED (2026-07-11, basis spec §12.51)** — `apps/indexer/src/jobs/ethUsd.ts`, started from the sidecar (§7). Chainlink branch per §12.51: proxy default `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` (env override `CHAINLINK_ETH_USD_FEED`; `off` disables), source label `chainlink:4663`, **mandatory fail-closed startup assertions** (`description() == "ETH / USD"`, `decimals() == 8`) — an assertion failure disables the poller entirely (the HTTP fallback never masks a misconfigured feed; `eth_usd_snapshot_age_seconds` pages instead). 4663-mainnet-only gate = runtime RPC `eth_chainId` (testnet 46630 / fresh local chains skip the branch automatically; a 4663 fork works because the feed exists in fork state; a fresh chain launched as 4663 sets `off`). Runtime staleness check on `latestRoundData().updatedAt` (`ETH_USD_CHAINLINK_STALENESS_SECONDS`, default 3600s) → rejected answers fall back to the documented HTTP chain (`ETH_USD_SOURCE_URL`, DefiLlama/Coinbase, labeled `defillama`/`coinbase`); all-source failure records NOTHING (§2 — never fabricated; age gauge is the staleness surface). Cadence `ETH_USD_POLL_INTERVAL_MS` (default 30s). Minimal AggregatorV3Interface ABI (`aggregatorV3Abi`) and the feed address const (`CHAINLINK_ETH_USD_PROXY_4663`) are imported from `@robbed/shared` (adopted 2026-07-11; single-source per the anti-drift rule).

### 3.10 Metadata verification **[offchain]** (§8.3 — see §6)

```sql
CREATE TABLE metadata_verifications (
  token_address        text PRIMARY KEY REFERENCES tokens(address),
  onchain_hash         text NOT NULL,              -- copy of tokens.metadata_hash
  computed_hash        text,                       -- keccak256 of canonicalized fetched bytes
  status               text NOT NULL DEFAULT 'unfetched'
                       CHECK (status IN ('match','mismatch','unfetched')),
  fetched_body_sha256  text,                       -- raw-bytes fingerprint for audit
  attempts             integer NOT NULL DEFAULT 0,
  last_attempt_at      timestamptz,
  last_error           text,
  verified_at          timestamptz
);
```

### 3.11 Moderation flags **[offchain]** (§8.4 — written by the API, read by both)

Owned by the API service (see `docs/how-it-works/api.md` §4); listed here because token list queries join it. The indexer never writes it. Listing gating = `WHERE moderation.visibility != 'hidden'` applied in API list/search endpoints — chain state and raw indexed data are never touched by moderation (§8.4).

```sql
CREATE TABLE moderation_status (
  token_address        text PRIMARY KEY,           -- no FK: may be written before/after indexing races
  visibility           text NOT NULL DEFAULT 'visible'
                       CHECK (visibility IN ('visible','pending_review','hidden')),
  nsfw_score           real,
  csam_flag            boolean NOT NULL DEFAULT false,
  impersonation_flag   boolean NOT NULL DEFAULT false,   -- top-asset / Stock Token ticker match (§8.4)
  impersonation_ticker text,
  reason               text,
  reviewed_by          text,                       -- admin identity
  updated_at           timestamptz NOT NULL
);
```

## 4. Candle pipeline — venue-continuous (§5.2, §8)

### 4.1 Intervals

**Ratified set (spec §12.17):** `1s, 15s, 1m, 5m, 15m, 1h`. Covers every zoom level `lightweight-charts` needs between the spec's endpoints; skips 30s/30m as low-value; 1s is the spec-mandated floor. Trivially adjustable later since candles are derived data.

### 4.2 Write path

Candles are updated **inline in the same Ponder handler** that inserts the trade row (curve `Trade` and V3 `Swap` both), one upsert per interval per trade:

```
bucket = floor(block_timestamp / secs(interval)) * secs(interval)
INSERT ... ON CONFLICT (token, interval, bucket) DO UPDATE
  high  = GREATEST(high, p), low = LEAST(low, p), close = p,
  volume += v, trade_count += 1,
  last_block_number/last_log_index = event position
  -- open only set on INSERT
  -- guarded: skip UPDATE when (block_number, log_index) <= (last_block_number, last_log_index)  → idempotent re-apply
```

`close` correctness relies on in-order processing; Ponder delivers events in `(block, logIndex)` order, and the guard makes re-delivery a no-op. Six upserts per trade is the accepted write amplification for read-side simplicity (no on-read aggregation, no cron rollup lag on the 1s series).

### 4.3 Venue continuity guarantee

Because curve trades and V3 swaps insert into the same `trades` table with a uniform `price_eth`, and candles aggregate `trades` without reference to `venue`, the series is continuous by construction. The graduation boundary produces no gap and no reset: the last curve trade sets `close` of its bucket, the first V3 swap continues from the pool initialized at the deterministic graduation price (§6.3 guarantees the migrator arbs the pool to the curve's terminal price before minting, so there is no economic discontinuity either). **Test obligation:** a simulated sequence curve-trades → `Graduated` → V3 swaps must yield one series where every bucket's `open` is derivable and no interval shows a synthetic zero/null bucket at the boundary (empty buckets are simply absent; the chart forward-fills — frontend concern).

### 4.4 Rebuild-from-raw guarantee

`candles`, plus the denormalized fields on `tokens` (`last_price_eth`, `volume_eth_24h`, `trade_count`, `holder_count`) and `balances`, are derived data. A `rebuild` script (idempotent, offline-runnable) truncates derived tables and replays `trades` + `Transfer`-derived deltas in `(block_number, log_index)` order. This is also the reorg deep-recovery path. The script ships with the indexer and is exercised in CI against the test fixture set.

`volume_eth_24h` decay: recomputed by a periodic job (every 60s) from `trades` — acceptable staleness; never computed in the WS hot path.

### 4.5 24h change anchor (`change24hPct`, §12.40e)

`TokenCard.change24hPct` (api.md §3.4) needs a 24h-open price anchor. Definition (indexer/API-owned, tunable like the §12.22 ranking formulas; frontend renders only):

```
change24hPct = (lastPrice − anchorPrice) / anchorPrice
  anchorPrice = close of the most-recent 1h candle at or before (now − 24h)
  if token age < 24h:  anchorPrice = first-trade price (creation-anchored)
  if no trades:        change24hPct = 0
```

`lastPrice` = `tokens.last_price_eth`. The 1h series already exists (§4.1); the anchor is a bucket lookup, no new write path. Recomputed alongside `volume_eth_24h` (or resolved at read time from the 1h candles) — never in the WS hot path. Same source used for the `/tokens` list and detail so the value is consistent across surfaces.

> **Anti-drift follow-up (2026-07-10, decisions §7):** this anchor resolver has **≥2 consumers** (indexer materialization + API `card` projection), so per the anti-drift rule it is hosted **once in `packages/shared`** and both services import it — not duplicated in `apps/indexer/src/change24h.ts` and `apps/api/src/projections/card.ts` (which today returns `change24hPct: null`). Owner: **hoodpad-shared** hosts the resolver; API consumes.

## 5. Confirmation-state pipeline (§2.1)

### 5.1 Detection

Arbitrum Orbit L2 RPCs expose the `safe` and `finalized` block tags on the child chain: `safe` = included in a batch posted to L1; `finalized` = that batch's L1 block is finalized. A **confirmation tracker** loop (in the indexer container, independent of Ponder's sync):

1. Every ~5s (posting cadence is minutes; finality ~13min+challenge context — 5s polling is more than sufficient), fetch `eth_getBlockByNumber("safe")` and `("finalized")` from the RPC.
2. Advance the `confirmation_watermarks` sidecar singleton MONOTONICALLY (`safe`/`finalized` only ever move forward; a transient lower reading is ignored) if either advanced.
3. **No per-row writes** (OI-11 / spec §12.48c, implemented 2026-07-11): per-row `confirmation_state` is derived at READ time as a pure function of `block_number` vs the watermark singleton. The originally-designed ranged `UPDATE`s on Ponder tables were disproven by the OI-11 verification (§7.3, decisions §11 — ponder 0.16.8's indexing-store cache silently reverts external column updates on handler-mutated rows, flapping states backwards) and are gone; monotonicity now holds structurally, because the derivation rule (`stateForBlock`, `@robbed/shared`) is monotone in the watermark and the watermark never regresses. Read surfaces: the API's SQL derivation (`confirmationStateSql`) inside every SELECT returning shared db-row shapes, and the TS DTO projection (`projectConfirmation`) — both from the one shared rule.
4. Publish one message to Redis channel `global:confirmations`: `{ type:'confirmations', safeBlock, finalizedBlock, ts }`.

Verification of the tag support against the actual Robinhood RPC is an implementation-start task; **fallback if tags are unsupported:** read the Rollup/SequencerInbox contracts on L1 (batch-posted watermark from `SequencerBatchDelivered`, finalized from node confirmations) via an L1 RPC — more moving parts, only if needed (OI-8).

### 5.2 Propagation

- Every WS event message carries `confirmationState` (always `soft_confirmed` at publish time — publish happens in the handler, at head).
- Clients upgrade states **locally** from `global:confirmations` watermark messages: any held event with `blockNumber <= safeBlock` becomes `posted_to_l1`, etc. This satisfies "WS update messages" (§2.1/§8) with O(1) messages per watermark advance instead of O(rows) — no per-row fanout, no DB reads in the hot path. *Ratified (spec §12.20).*
- REST reads return the read-derived `confirmation_state` (SQL derivation against the watermark sidecar — never staler than the watermark; there is no lagging materialized column).

### 5.3 Reorg interaction

Soft-confirmed events can theoretically vanish (single sequencer; deep reorgs unexpected but handled). Ponder rolls back its tables on reorg; since watermarks only ever refer to L1-posted blocks, a rolled-back event was by definition still `soft_confirmed` — no watermark inconsistency is possible. WS clients receive a `reorg` message on `global:confirmations` with the rollback block so feeds can drop orphaned soft-confirmed entries (rare; UI treats it as removal).

## 6. Metadata integrity pipeline (§8.3)

### 6.1 Flow

On `TokenCreated`, the handler seeds `metadata_verifications` as `unfetched` and enqueues a verification job (in-process queue with persistence via the `attempts`/`last_attempt_at` columns — a poller retries `unfetched` and errored rows; no external queue dependency).

Verification job:
1. `GET {metadata_uri}` (or `{R2_METADATA_BASE_URL}/{metadataHash}.json` if the event carries no URI — OI-1) with timeout (10s), size cap (64KB), content-type sanity.
2. Parse JSON. **Canonicalize using the shared function in `packages/shared` (`canonicalizeMetadata`)** — RFC 8785-style: UTF-8, lexicographically sorted keys at every level, no insignificant whitespace, no non-canonical number forms. This function is the **single implementation** used by the frontend at launch time (to compute the hash sent on-chain) and the indexer at verify time; byte-identical by construction, tested with shared fixtures.
3. `keccak256(canonicalBytes)`; compare to on-chain `metadata_hash` byte-for-byte.
4. Persist `match` / `mismatch` (+ both hashes, sha256 of raw body). **Never `match` without an actual byte-level hash comparison** — a parse-success or schema-valid result is not a match.
5. On `match` (and on `mismatch` — content still shown, badged): extract `name`-adjacent display fields (`image`, `description`, `links`, `imageHash`) into `tokens`. Image integrity (`imageHash` inside the JSON) is *carried*, not verified by the indexer in v1 — the Trust panel can verify client-side; server-side image-hash verification is a listed enhancement (OI-10).
6. On fetch failure: remain `unfetched`, exponential backoff (1m, 5m, 30m, 6h, then daily; capped attempts counter never stops the daily retry).
7. Publish `token:{addr}:events` type `metadata_verified` with the verdict.

### 6.2 Re-verification

`unfetched` rows retry per backoff. `mismatch` rows re-verify daily (R2 object may be corrected to match the immutable hash — the chain commitment never changes, so `match` can only be achieved by fixing the object). `match` rows re-verify weekly (cheap; detects R2 mutation after the fact — R2 URLs are mutable, the verdict must not be assumed stable).

**Admin re-verify seam (X-9).** `metadata_verifications` is indexer-owned; the API is read-only on it (it must not `UPDATE` an indexer table). The admin `POST /v1/admin/metadata/:token/reverify` (api.md §3.6) therefore does **not** write the table — it publishes a control message on the Redis channel `control:reverify` (`{ token }`). The indexer's verifier subscribes to `control:reverify`, marks the row `unfetched` (or bumps its next-attempt), and the poller picks it up. The indexer remains the **sole writer** of `metadata_verifications`; the API only requests.

## 7. Ponder specifics

### 7.1 Idempotency & reorg safety

- All event tables keyed by `(tx_hash, log_index)`; handlers are pure upserts; re-delivery is a no-op (candles guarded by high-water mark, §4.2).
- Ponder's built-in reorg handling rolls back onchain tables. Offchain tables (`confirmation_watermarks`, `eth_usd_snapshots`, `metadata_verifications`, `moderation_status`) are deliberately outside that mechanism: watermarks are reorg-immune by construction (§5.3); metadata verifications keyed by token address survive harmlessly (a rolled-back token that re-appears re-seeds the same row).

### 7.2 Handler → Redis publish

Publish happens at the end of each handler, after the DB write, fire-and-forget with error logging (a lost pub is self-healing: clients reconcile via REST backfill). **No DB reads in the publish path** — the message is built entirely from event data plus values already in hand. No polling layers anywhere between chain and browser: Alchemy WS → Ponder realtime sync → handler → Redis → Bun WS.

### 7.3 Table ownership

Ponder-managed (schema in `ponder.schema.ts`): `tokens`, `trades`, `transfers`, `graduations`, `fee_collections`, `balances`, `candles`. Side-process-managed (plain migrations in `apps/indexer/migrations/`): the four **[offchain]** tables. **There are NO external writes into Ponder-managed tables — none.** VERDICT (2026-07-11, OI-11 verified — see §10 row + decisions §11): on the pinned ponder 0.16.8 a direct external `UPDATE` is NOT safe for `tokens` (indexing-store cache full-row flushes silently revert external column updates on rows the handlers keep mutating), and Ponder's docs forbid external writes outright ("Direct SQL queries should not insert, update, or delete rows from Ponder tables"). **REWORKED (2026-07-11): the §12.48c sidecar is implemented as pure READ-DERIVATION** — the `confirmation_watermarks` singleton is the sidecar, the per-row `confirmation_state` columns were removed from `ponder.schema.ts`, the tracker (`src/confirmation.ts`/`confirmationStore.ts`) writes only the watermark singleton, and readers derive the tier per row (§3.8/§5). A per-row `event_confirmations` join table was weighed and rejected: the tier is fully determined by `(block_number, watermarks)`, so per-row rows would re-introduce O(rows) writes for zero information.

### 7.4 Dynamic sources

- V3 pools: Ponder `factory()` source over `Graduated(pool)` — only graduated pools are indexed.
- LaunchToken `Transfer`: `factory()` source over `TokenCreated(token)` (ratified §12.16).
- `Collect`: single source on the NPM address, handler filters by known `lp_token_id`s (kept in an in-memory set loaded at startup + updated on `Graduated` — no per-event DB read).

**Same-tx factory-child capture — M2-0b spike + pre-sanctioned fallback (§12.41, E-3).** A curve's atomic initial buy emits `Trade` in the **same tx** as the `TokenCreated` that registers that curve as a Ponder `factory()` child. The **M2-0b spike** (runs at Phase-I/M2 start once the local stack is up — anvil+Ponder+Postgres, using the I-2 same-tx create+buy fixture) verifies Ponder captures such same-tx child events; it is BLOCKING before M2-5 handler work relies on native same-tx capture. **Pre-sanctioned fallback if Ponder cannot:** the `TokenCreated` handler derives the creator's initial buy by parsing the first `Trade` log from the `createToken` transaction **receipt** (via the §12.15 event ABI), instead of relying on child-source firing for the same-tx `Trade`. This fallback is pre-approved (spec §12.41), so a failing spike does **not** re-escalate — implement the receipt path and record the Ponder-version finding here. Record the spike outcome (native-capture vs receipt-fallback) in this section at M2.

**SPIKE OUTCOME (M2-0b, 2026-07-11): NATIVE CAPTURE — Ponder DOES index same-tx child events. The receipt fallback (§12.41) is NOT needed.** Verified two ways against the pinned version — **ponder 0.16.8** (lockfile resolution of the `^0.16.6` range in `apps/indexer/package.json`; mechanism verified in the installed package's shipped source, `apps/indexer/node_modules/ponder/src/`):

1. **Source-level mechanism (authoritative — the ponder.sh factory docs are silent on same-block behavior, checked 2026-07-11).** Child-address registration is **block-granular and inclusive of the registration block**, and address resolution happens **before** log filtering in both sync paths:
   - *Matcher:* `isAddressMatched` (`src/runtime/filter.ts:74-92`) matches a child's log iff `childAddresses.get(address) <= log.blockNumber` — `<=`, so events in the registration block itself match.
   - *Realtime:* `fetchBlockEventData` (`src/sync-realtime/index.ts`) fetches **all** logs of each new block via `eth_getLogs({ blockHash })` with **no address filter** (line ~314), scans them for factory matches to build `blockChildAddresses` (lines 470-509), then `filterBlockEventData` merges those children into the known set **before** filtering event logs against filters (lines 707-752). A child registered at block N therefore has its block-N logs (same tx included) already in hand and matched.
   - *Historical:* `syncBlockRangeData` (`src/sync-historical/index.ts:434-599`) first awaits `syncAddressFactory` for the chunk's factory intervals — populating the shared child-address record (lines 361-431, registration block recorded from the factory log, min-wins on re-discovery) — and only **then** builds the child `eth_getLogs` queries from that record over the **same interval** (lines 482-599), which spans the registration block; per-block filtering re-applies `isAddressMatched` with `<=` (line ~726).
2. **Runnable spike (no Docker: anvil + `ponder dev` on its embedded PGlite — no Postgres daemon needed).** Minimal `SpikeFactory.createChildAndTrade()` emits `ChildCreated` (factory registration event) then calls the fresh child, which emits `Trade` — same tx, logIndex 0/1. Result: all four events captured, in `(block, logIndex)` order, with **zero** handler errors, on **both** paths:
   - *Historical* (tx sent before Ponder started): `ChildCreated` block 2 logIndex 0 + same-tx child `Trade` block 2 logIndex 1 (tx `0x1fda3550…3665f32`) — both delivered.
   - *Realtime* (tx sent while live): `ChildCreated` block 3 logIndex 0 + same-tx child `Trade` block 3 logIndex 1 (tx `0x9282a0ab…13b33c`) — both delivered.

   Spike artifacts were scratchpad-only (throwaway contracts + minimal Ponder app); nothing checked in.

   **Ordering guarantee the handlers may rely on (and one contract-side assumption to keep true):** capture is block-granular, and Ponder delivers same-block events to handlers in `logIndex` order — so the `TokenCreated` handler runs before the same-tx `Trade` handler **iff `TokenCreated`'s logIndex is lower**, which the §12.15 emission order guarantees (factory emits `TokenCreated` before the initial buy executes on the curve). If M1 artifacts ever inverted that emission order, the `Trade` handler would fire before the token row exists — that would be an event-shape/ordering divergence to escalate per §3, not to work around. M2-5 handlers should keep the cheap guard of upserting/asserting token existence in the `Trade` handler.

## 8. Redis pub/sub → Bun WS fanout (§8)

The WS server is a small Bun process (lives in `apps/api` deployment or standalone — see api.md §7; the *contract* is defined here). Channel names and message schemas live in `packages/shared` (`channels.ts`, `ws-messages.ts`) — single source for indexer (publisher), WS server (relay), frontend (consumer).

### 8.1 Channel taxonomy

| Redis channel | Content | Consumers |
|---|---|---|
| `global:launches` | new `TokenCreated`, `graduated` announcements | Discover ticker (§5.1) |
| `global:trades` | every trade (curve + v3), throttle-ready | Discover activity |
| `global:confirmations` | watermark advances + reorg notices | all pages (badge upgrades) |
| `token:{address}:trades` | trades for one token | Token Detail feed (§5.2) |
| `token:{address}:candles:{interval}` | candle upsert per trade per interval | chart live updates |
| `token:{address}:events` | `graduated`, `metadata_verified`, `fee_collected`, state changes | Trust panel, venue switch |

WS clients subscribe/unsubscribe by sending `{op:'sub'|'unsub', channel}`; the WS server maintains channel→socket maps and one Redis `PSUBSCRIBE token:*` + explicit `SUBSCRIBE global:*`.

### 8.2 Message schemas (normative shapes; TypeScript defs in `packages/shared`)

All messages: `{ v: 1, type, channel, seq, ts, data }`. `seq` is a per-channel monotonic counter (Redis `INCR channel:seq` at publish — one Redis op, no DB) enabling client gap detection.

- `type:'trade'` data: `{ token, trader, venue, isBuy, ethAmount, tokenAmount, feeEth, priceEth, blockNumber, txHash, logIndex, blockTimestamp, confirmationState }`
- `type:'candle'` data: `{ token, interval, bucketStart, open, high, low, close, volumeEth, tradeCount }`
- `type:'launch'` data: token card projection (address, name, ticker, creator, imageUrl?, createdAt, blockNumber, confirmationState)
- `type:'graduated'` data: `{ token, pool, blockNumber, ts }`
- `type:'confirmations'` data: `{ safeBlock, finalizedBlock }`; `type:'reorg'` data: `{ fromBlock }`
- `type:'metadata_verified'` data: `{ token, status }`
- `type:'fee_collected'` data: `{ token, pool, lpTokenId, amountToken, amountWeth, blockNumber, txHash, logIndex, blockTimestamp, confirmationState }` — published on `token:{address}:events` from the V3 `Collect` handler (§3.5), feeds the treasury fee-accrual dashboard. **(X-6 — was promised in the §8.1 channel taxonomy but missing from this union; now defined. hoodpad-shared must add the matching schema to `packages/shared/ws-messages.ts`.)**

Amounts serialize as decimal strings (uint256 > JS safe integer).

### 8.3 Latency budget (<500ms event-to-browser, §8)

Alchemy WS push (~50–150ms after sequencer inclusion) → Ponder realtime handler (<50ms; handlers do bounded upserts only) → Redis publish (<5ms) → Bun WS fanout (<10ms local, ~50–100ms WAN). Budget holds with ~200ms headroom. Explicitly forbidden in the hot path: polling loops, per-message DB reads, per-message RPC calls, JSON re-canonicalization.

### 8.4 Reconnect / backfill

WS provides *freshness*, REST provides *truth*. On reconnect (or detected `seq` gap), the client re-subscribes and calls the REST backfill endpoints (`GET /v1/tokens/:addr/trades?since=`, `/candles?from=` — api.md) to heal, then resumes streaming. The WS server keeps **no replay buffer** in v1 (ratified §12.23: replay buffers add state to the fanout tier for a problem REST already solves). Heartbeat ping/pong every 15s; dead sockets reaped.

## 8.5 Bot/farm detection heuristics (spec §8.5, v1.2)

**M2 feature.** On a chain where >50% of flow is programmatic (spec §2.2), the indexer labels bot/farm activity so the Trust panel (§5.2) and an internal flow-quality dashboard can show **how much of a token's flow and holder set is organic**. Implemented as **SQL views + scheduled jobs over the existing `trades` and `transfers` tables** (§3.2/§3.6) — **no new event families, no hot-path cost** (these run as periodic jobs, like the `volume_eth_24h` decay job, §4.4). **Strictly advisory: labeling only — it never gates any chain interaction, listing, or trade** (consistent with §8.4 / spec §8.4; moderation gates listing, this labels flow). Advisory, tunable-with-data, and always presented as estimates/ranges (§5.2 forbids false precision).

### 8.5.1 Heuristics (v1 defaults, tunable)

| # | Heuristic | Rule (default params) | Flag | Data |
|---|---|---|---|---|
| 1 | **Funder clustering** | wallet's first inbound tx is a micro-transfer (< 0.001 ETH) from an address that funded ≥ `N`=20 other wallets in a 24h window → cluster by funder | `farm` (per wallet + `cluster_id`) | `transfers` (first-inbound per address; funder fan-out count) |
| 2 | **Wallet age vs. action** | address's first-ever buy < 60s after the token's `TokenCreated` **and** funded < 1h prior | `sniper` | `trades` (first buy vs `tokens.created_at`) + `transfers` (funding time) |
| 3 | **Contract-mediated execution** | trade whose executor ≠ token recipient (Router-external executors). **Whitelist our own Router/contracts** — they legitimately mediate, so they are NEVER flagged | `programmatic` | `trades` (`trader` vs recipient) + address whitelist |
| 4 | **Wash-loop** | address pairs/clusters with round-trip buy→sell of similar size within short windows netting ≈ fees only | `wash` (on volume) | `trades` grouped by address/cluster |
| 5 | **Same-second multi-pool exits** | recipient receives WETH from ≥3 pools in one block | `arb/exit` | `trades` (venue=v3) + `transfers` grouped by (recipient, block) |

### 8.5.2 Outputs & ownership

- **Tables (offchain, indexer-owned — like the other side-process tables §3.11):** `address_flags(address, flags[], cluster_id, updated_at)` and `token_flow_stats(token_address, organic_holder_pct_low, organic_holder_pct_high, organic_volume_pct, flagged_cluster_vol_pct_24h, updated_at)`. Ranges (`_low`/`_high`) because the heuristics are estimates.
- **Organic-holder %** = share of a token's holders (from `balances`, §3.6) NOT carrying a bot flag; **organic-volume %** = share of curve volume from unflagged addresses; **wash-flagged volume is excluded from organic volume** (heuristic 4).
- **Consumers:** API exposes these on the token-detail `trust` payload (api.md) and an internal `/v1/admin`/dashboard endpoint; the frontend renders them (web.md Trust panel). The **gate-7 cluster-alert metric** (`funding_cluster_vol_share` vs the M0 thresholds, spec §10) reads `token_flow_stats`.
- **Never** written into the Ponder reorg-tracked store's trade/balance columns; these are derived side tables, rebuildable from `trades`+`transfers` (§4.4 rebuild extends to them).

### 8.5.3 hood.fun traction snapshot (spec §3/§13/§14)

A weekly scheduled job records a **source+timestamped** snapshot of hood.fun traction (tokens created/day, graduation count, visible volume) via own indexer (if hood.fun contracts are indexable) or a Dune query — **never a hardcoded metric (§2)**. Stored in `competitor_snapshots(source, captured_at, tokens_per_day, graduations, visible_volume_eth)`; feeds **Gate G-A.2** (spec §14). Manual/Dune until the job lands.

## 8.6 Portfolio `address_pnl` roll-up (spec §5.4)

**M2 feature (Phase-2 page surfaced day 1 by the ROBBED_ redesign).** A per-**address** portfolio roll-up backing `GET /v1/portfolio/:address` (api.md §3.4a; db-rows.ts `AddressPnlRow`). Same shape as the §8.5 side jobs: **offchain, indexer-owned table + SQL views + a scheduled recompute-from-raw job** over the Ponder `trades`+`transfers`+`tokens` tables — advisory / read-only, never gates chain state or listing (§8.4). Fully rebuildable from raw events (§4.4): the job TRUNCATEs and re-inserts the whole set each tick, so the recompute **is** the rebuild path (no incremental writer to drift from).

- **Table (offchain, `public`, migration `0006_address_pnl.sql`):** `address_pnl(address, first_seen_at, last_active_at, trade_count, tokens_created, total_eth_in, total_eth_out, realized_pnl_low, realized_pnl_high, pnl_confidence, updated_at)`. Aggregate across ALL of an address's tokens; the per-(token, holder) detail stays in `balances` (§3.6) — this is its address-level roll-up, NOT a duplicate.
- **Views (Ponder schema, `0007_address_pnl_views.sql`):** `pnl_trade_legs` (per-(address, token) buy/sell ETH+token totals, split by venue, `has_v3`), `pnl_address_activity` (trade count + first/last trade), `pnl_address_seen` (first/last Transfer touch; zero address excluded), `pnl_tokens_created` (creator counts, §7).
- **Compute (pure, `src/pnl/compute.ts`, unit-tested):** average-cost **realized** PnL over the closed (matched) leg per token, summed per address. **Realized is a RANGE** because V3-leg cost basis is best-effort (recipient is often a router — §12.16/OI-5): the band brackets **curve-only realized (V3 attribution discarded) vs full realized (V3 trusted)** → `low = min`, `high = max`. Curve-only address ⇒ `low == high`, `exact`; any V3 leg ⇒ `estimated`; no cost basis anywhere ⇒ `pnl_confidence = null` (range 0) so the API surfaces `pnlAllTime = null` (§5.2 forbids false precision).
- **NOT materialized (computed live at the API):** wallet native-ETH balance (RPC `eth_getBalance`, chain truth) and **unrealized / all-time PnL** (live curve-quote price × balance − remaining basis) — price is live, so these are read-time, never stored.
- **Cadence:** wall-clock `setInterval` (default 60s, `PNL_JOB_INTERVAL_MS`), same pattern as the §8.5 flow job; wired from the sidecar boot (`src/pnl/job.ts` + `src/pnl/store.ts`).

## 9. Testing & operational concerns

### 9.1 Vitest units (run with `bun test`)

- **Canonicalization/hash:** shared fixtures (also used by frontend tests): nested keys out of order, unicode, numbers, arrays → stable bytes; keccak256 vectors; **match / mismatch / unfetchable** paths of the verifier including "parse OK but hash differs ⇒ mismatch" and "timeout ⇒ unfetched + backoff", and "never match without byte comparison" (mutation-style test: verifier with comparison stubbed out must fail suite).
- **Candle math:** bucket flooring per interval; OHLC upsert semantics; out-of-order/duplicate re-apply is a no-op (high-water guard); **continuity across simulated graduation** — fixture stream of curve trades, `Graduated`, V3 swaps ⇒ single series, boundary buckets correct, no reset; rebuild script output byte-equal to incremental output.
- **Confirmation transitions:** watermark advance ⇒ correct ranged state changes; monotonicity (never downgrade); event at exactly the watermark block; reorg of soft-confirmed rows leaves watermarks consistent.
- **Price math:** curve reserve→price; sqrtPriceX96→price for both token orderings; 18/18 decimals.
- **Balance accounting:** Transfer-driven deltas; mint-to-curve; holder_count transitions; top-20 query shape.
- **Bot/farm heuristics (§8.5, v1.2):** funder-cluster fixture (20+ micro-funded wallets from one funder → all `farm`, one `cluster_id`); sniper timing boundary (buy at t+59s flagged, t+61s not); **own-Router trade is NOT flagged `programmatic`** (whitelist); wash-loop round-trip excluded from organic volume; same-second ≥3-pool exit → `arb/exit`; `organic_holder_pct` computed as a range; all labels advisory (no code path gates a trade/listing on a flag).

### 9.2 Integration

Ponder test harness (or anvil fork per §10 gate 3 fixtures once M1 lands) replaying a canned event log through real handlers into ephemeral Postgres; asserts every table, Redis messages captured via a test subscriber.

### 9.3 Backfill & recovery

- Cold start: Ponder historical sync from `START_BLOCK` via HTTP RPC, then live via WS. During backfill, publishes are **suppressed** (flag on historical vs realtime context) — no replay storm to Redis.
- Derived rebuild: §4.4 script; runbook entry: safe to run while live indexing is paused.
- Ponder crash/restart: resumes from checkpoint; upsert idempotency covers the overlap window.

### 9.4 Monitoring (gate 7, §10)

Emitted as Prometheus-style metrics + alert rules (delivery mechanism per infra choice at M4):
- `indexer_head_lag_seconds` (chain head vs last indexed) — alert > 10s.
- `ws_publish_to_head_ms` histogram — alert p95 > 300ms (guards the 500ms budget).
- `confirmation_safe_lag_blocks`, `finalized_lag_blocks` — alert on stall (batch poster down ⇒ user-visible badge stall).
- `metadata_unfetched_total`, `metadata_mismatch_total` — mismatch > 0 pages review (Trust panel shows it either way).
- **Invariant metrics (gate 7 explicitly):** per-token `real_eth_reserves` vs on-chain balance spot-check sampler; graduation single-fire violation (second `Graduated` for a token ⇒ page immediately); `fee_collections.recipient != treasury` ⇒ page immediately; trade with `fee_eth > 2%` of leg ⇒ page (fee ceiling §6.4).
- `redis_publish_errors_total`, `ws_connected_clients`, `eth_usd_snapshot_age_seconds` (alert > 5m — USD displays go "dated", never stale-silent, §2).

## 10. Open items & decisions needed

| ID | Item | Recommendation | Status |
|---|---|---|---|
| OI-1 | Exact ABI shapes for `TokenCreated`/`Trade`/`Graduated` | `Trade` emits post-trade reserves + fee; `TokenCreated` carries `metadataUri` | **RESOLVED — spec §12.15 (2026-07-09).** Canonical shapes in contracts.md §2, mirrored in §3 above |
| OI-2 | `Trade.ethAmount` semantics: gross (incl. fee) vs net | — | **RESOLVED — spec §12.15:** `ethAmount` is **gross**, `fee` is a separate field; net = gross − fee |
| OI-3 | Indexing LaunchToken `Transfer` (6th event family) for exact balances | — | **RESOLVED — spec §12.16:** adopted; sole source of balance truth |
| OI-4 | Pre-graduation V3 pool activity: index or ignore? | — | **RESOLVED — spec §12.16:** not indexed; curve is sole venue until `Graduated`; gate-7 alerting covers pool griefing |
| OI-5 | V3 `Swap.recipient` is often a router, so per-EOA `total_eth_in/out` for v3 legs is approximate | — | **RESOLVED — spec §12.16:** accepted; balances exact via Transfer, v3 cost basis best-effort until Phase 2 |
| OI-6 | ETH/USD source on 4663 (Chainlink feed existence unverified) | Chainlink if deployed on 4663, else DefiLlama with timestamp; config-driven | **VERIFIED 2026-07-11 (decisions §11): Chainlink ETH/USD feed EXISTS on 4663** — proxy `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` (aggregator `0x6091E64eb7138EEF066a80FD3A0d7427B91f2721`, 8 decimals, `description()` = "ETH / USD", confirmed via `eth_call` on the public 4663 RPC). Poller (M2) reads the feed, source label `chainlink:4663` (§3.9), staleness-checked; DefiLlama/Coinbase HTTP stays the configured fallback + the LOCAL/TESTNET source. Address recorded in spec **§12.51**, §13 OI-6 closed. **Poller IMPLEMENTED 2026-07-11** with the §12.51 fail-closed assertions — see §3.9 status |
| OI-7 | Candle interval set `1s/15s/1m/5m/15m/1h` | — | **RESOLVED — spec §12.17:** as proposed |
| OI-8 | `safe`/`finalized` block-tag support on Robinhood RPC | Verify day 1 of M2; fallback = L1 rollup-contract watermarks | **VERIFIED 2026-07-11 (decisions §11): both tags SUPPORTED** on `https://rpc.mainnet.chain.robinhood.com` — `eth_getBlockByNumber["safe"/"finalized",false]` return full Arbitrum block objects (incl. `l1BlockNumber`); observed safe 7,082,802 > finalized 7,078,967, `eth_chainId` = 4663. §5.1 tag path is live; M2-3b L1-watermark reader NOT funded — dormant pre-sanctioned fallback only |
| OI-9 | Confirmation propagation via watermark broadcast (O(1)) vs per-event WS updates | — | **RESOLVED — spec §12.20:** watermark broadcast |
| OI-10 | Server-side verification of `imageHash` inside metadata JSON | — | **RESOLVED — spec §12.23:** deferred post-v1; carried in JSON, client-verifiable |
| OI-11 | External `UPDATE` of `confirmation_state` on Ponder-managed tables vs sidecar table | Direct update if the pinned Ponder version tolerates it; else sidecar `event_confirmations` join | **VERIFIED 2026-07-11 (decisions §11): direct UPDATE NOT tolerated by ponder 0.16.8 for hot rows** — the indexing-store cache retains rows in memory across realtime blocks (cached keys are never re-read from the DB) and flushes ALL columns from the cached copy, so an external `confirmation_state` upgrade on `tokens` (mutated on every Trade) is silently reverted by that token's next flush → §5.1 monotonicity violated. **§12.48c sidecar is REQUIRED**. **Rework LANDED 2026-07-11 (robbed-indexer):** implemented as pure read-derivation — per-row columns removed from `ponder.schema.ts`, tracker writes only the `confirmation_watermarks` sidecar singleton, tiers derived at read time (§3.8/§5/§7.3) |
| OI-12 | WS replay buffer vs REST-heal on reconnect | — | **RESOLVED — spec §12.23:** REST-heal only in v1 |
| OI-13 | V3 Factory / NPM addresses on 4663 | From official registry at implementation time; startup fails if unset (never guessed) | **OPEN — spec §13** |

## 11. Definition of done (M2, indexer)

- [ ] Handlers implemented for all six event families (§12.15–16), all idempotent on `(tx_hash, log_index)`
- [ ] Schema materialized exactly as §3 (Ponder tables + offchain migrations), `pg_trgm` GIN indexes present, startup assertions in place
- [ ] `creator` + `creatorFeeBps` on every token row from first indexed event (§7)
- [ ] Candle series proven continuous across a simulated graduation in tests; all six intervals; rebuild script produces identical output from raw events
- [ ] Confirmation tracker live: watermark sidecar + read-time tier derivation (OI-11/§12.48c — no per-row writes), `global:confirmations` broadcast; transitions unit-tested incl. monotonicity and reorg
- [ ] Metadata verification: match / mismatch / unfetched all tested; canonicalization shared with frontend via `packages/shared` with shared fixtures; re-verify schedule implemented
- [ ] Redis publish from every handler with zero DB reads in the publish path; message schemas exported from `packages/shared`
- [ ] Backfill suppresses publishes; crash-resume verified
- [ ] Gate-7 metric hooks emitting (head lag, publish latency, confirmation lag, invariant alerts)
- [ ] **(v1.2)** Bot/farm heuristics (§8.5) as SQL views/jobs over `trades`+`transfers`; `address_flags` + `token_flow_stats` populated; own-Router whitelisted; wash excluded from organic volume; advisory-only (no chain/listing gate); weekly hood.fun `competitor_snapshots` job; all tested per §9.1
- [ ] No hardcoded market metrics anywhere; USD only via `eth_usd_snapshots` (§2); hood.fun/competitor snapshots source+timestamped, never hardcoded
- [ ] `bun test` green; any artifact-vs-§12.15 event-shape divergence found at implementation time escalated to hoodpad-architect, not patched around
