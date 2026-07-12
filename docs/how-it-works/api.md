# Service Design — API (`apps/api`, Hono on Bun)

**Status:** Design v1.0 — drives M2 implementation. Implementation must be a transcription of this document; deviations require an update here first.
**Spec coverage:** §5.1 (search, discover data), §5.2 (token detail data), §5.3 (launch flow: uploads + metadata hash), §8 (Hono on Bun: R2 presigned uploads, moderation queue, search API; WS fanout), §8.3 (canonical metadata JSON to R2), §8.4 (moderation), §2 (no hardcoded market metrics), §2.1 (confirmation states in responses).
**Runtime:** Hono on Bun. Storage: Cloudflare R2 + CDN. DB: read-mostly Postgres (indexer-owned tables) + API-owned moderation tables. Redis: rate limiting + WS fanout.

Companion doc: `docs/how-it-works/indexer.md` — table shapes, channel taxonomy, and WS message schemas referenced below are defined there and in `packages/shared`.

---

## 1. Purpose

The API is the HTTP surface between the frontend and everything off-chain:

1. **R2 presigned upload flow + canonical metadata publication** for the launch flow (§5.3, §8.3) — the only write-heavy path.
2. **Read API** over indexer tables: token lists/sorts/filters, token detail, trades, candles, holders, King of the Hill, treasury fee dashboard (§5.1, §5.2, §6.4).
3. **Search**: one endpoint, `pg_trgm` over name / ticker / contract address / creator address (§5.1).
4. **Moderation** (§8.4): upload-time enforcement (MIME sniff, ≤4MB, re-encode), auto-moderation pipeline with pluggable vendors (§13 open item), impersonation flags, admin queue. Moderation gates **listing visibility only** — no API path may ever mutate or depend on mutating chain state.
5. **WS fanout host**: the Bun WebSocket server (Redis subscriber → socket fanout) ships inside `apps/api` as a separate entrypoint/process (`apps/api/src/ws.ts`), sharing types with the HTTP app but not the request lifecycle. Contract defined in indexer.md §8.

Non-goals: no chain writes ever (all transactions are wallet-signed client-side, §5.3 one-tx create); no server-side trading logic; no USD constants (§2 — USD derived from `eth_usd_snapshots` at response time, always with `asOf` timestamp).

## 2. Cross-cutting response conventions

- All responses `application/json`; envelope `{ data, error: null } | { data: null, error: { code, message } }`.
- All uint256 values serialized as decimal strings.
- Every event-derived object includes `confirmationState` (§2.1).
- Every USD-derived field ships as `{ usd: string, ethUsd: string, asOf: string }` — computed at request time from the latest `eth_usd_snapshots` row, never a constant (§2). If the snapshot is older than 5 minutes, `stale: true` is added.
- All list endpoints: cursor pagination (`?cursor=&limit=`, limit ≤ 100, default 50), stable ordering with `(sort_key, id)` tiebreak. `limit` **clamps** to `[1, 100]` (never 400s) via the shared `clampListLimit`.
- Server-sorted tables (`/tokens/:address/trades`, `/tokens/:address/holders` — §12.59): additionally accept `?sort=<field>&dir=asc|desc`. The `sort` field comes from a **closed allowlist** (robbed-shared `TRADE_SORT_FIELDS` / `HOLDER_SORT_FIELDS`) mapped API-side to a fixed column — a value outside the allowlist (or a `dir` other than `asc|desc`) is `400 invalid_request`. This is the ORDER BY security boundary: no caller string ever reaches SQL. These endpoints return the uniform `{ items, nextCursor }` envelope (shared `paginatedTradesResponseSchema` / `paginatedHoldersResponseSchema`), keyset-paginated over the active `(sort_col, tiebreak)` — never client-side sort/rank (server-authoritative, §12.22/§12.59).
- Listing-gated endpoints (`/tokens` list, `/search`) exclude `moderation_status.visibility = 'hidden'`; `pending_review` behavior per §4.5. Direct fetch by address (`/tokens/:address`) returns hidden tokens with `moderation: { visibility }` populated so the frontend can render a "hidden by moderators" state instead of a 404 — hiding is a listing concern, the token exists on-chain regardless (§8.4). *(Ratified — spec §12.21.)*
- Response DTO types all live in `packages/shared` (§5 below); the frontend imports them, never redeclares.

## 3. Endpoint inventory

### 3.1 Launch flow — image upload (§5.3, §8.4)

**`POST /v1/uploads/image` → presign is deliberately NOT used for the raw client file.** Design decision: the image is uploaded **through** the API (multipart), not via a presigned PUT directly from the browser, because §8.4 requires MIME sniff + re-encode *before* anything reaches public storage. A presigned direct PUT would put unmoderated bytes on the CDN. The "R2 presigned upload" of §8 is satisfied on the API→R2 leg: the API streams the re-encoded object to R2 using its own credentials (server-side presign/direct SDK put). *(Ratified — spec §12.19; §5.3/§8 amended accordingly.)*

```
POST /v1/uploads/image        multipart/form-data, field "image"
  Limits: ≤ 4MB (§5.3) enforced pre-buffer via Content-Length + streamed cap
  Pipeline (§8.4, synchronous):
    1. MIME sniff on magic bytes (never trust Content-Type header); allow png|jpeg|webp|gif
    2. Decode + re-encode (sharp or equivalent): strips EXIF/metadata/polyglots,
       normalizes to webp (static) / limits animated gif dimensions; output ≤ 4MB post-encode
    3. sha256 + keccak256 of the RE-ENCODED bytes (the re-encoded object is the canonical image;
       its hash is what goes into metadata JSON as imageHash — §8.3)
    4. PUT to R2: images/{keccak256}.webp (content-addressed → idempotent, dedupes)
    5. Enqueue auto-moderation job for the image (§4) keyed by image hash
  200 → { imageUrl, imageHash, width, height, bytes }
  4xx → oversized | unsupported_type | decode_failed
```

### 3.2 Launch flow — metadata canonicalization + hash (§8.3)

**Design decision — server-canonicalizes, both sides verify.** The canonical metadata JSON must exist at a stable R2 URL *before* `Router.createToken` is sent (the tx carries the hash). Flow:

```
POST /v1/metadata
  Body: { name, ticker, description?, links?, imageUrl, imageHash }   -- schema-validated (zod, from packages/shared)
    name ≤ 32 BYTES, ticker ≤ 10 BYTES (UTF-8 byte length, NOT char count — must equal the on-chain
      createToken validation `bytes(name).length ∈ [1,32]` / `bytes(symbol).length ∈ [1,10]`, §12.30, contracts.md §2.2;
      a name that passes here must never revert at createToken), description ≤ 500 (§5.3), links: {website?,x?,telegram?} URL-validated,
      version = 1 (frozen inside the canonicalized hash preimage, §12.31),
    imageUrl must be our CDN origin, imageHash must match an object we produced (existence check on R2 key)
      → on mismatch/not-found: HTTP 400, error.code = 'invalid_request' (§12.40b — NOT 409/conflict;
        v1 has no genuine resource-conflict path because image + metadata are content-addressed/idempotent,
        so identical bytes always yield an identical hash. `conflict`/409 is dropped from the shared
        error-code union — the frontend never needs a 409 branch.)
  Pipeline:
    1. Build metadata object (fixed field set + version tag)
    2. canonicalBytes = canonicalizeMetadata(obj)   -- THE shared function from packages/shared (§5)
    3. hash = keccak256(canonicalBytes)
    4. PUT to R2: metadata/{hash}.json  (content-addressed: URL derived from hash → immutable-by-convention,
       and the indexer's weekly re-verify catches any mutation — indexer.md §6.2)
    5. Run text moderation + impersonation check (§4.3/§4.4) — result recorded, NEVER blocks the response
       (moderation gates listing, not creation — §8.4; user can always send the tx)
  200 → { metadataHash, metadataUri, canonicalJson }
```

Why not client-side-only: the client *also* runs `canonicalizeMetadata` (same shared function) and MUST verify the returned `metadataHash` against its own computation before signing the tx — a byte-level cross-check that makes a buggy or malicious server unable to commit the user to metadata they didn't write. Why not client-side-*upload*: the client can't write to R2 without presigned credentials, and presigning arbitrary JSON re-opens the unmoderated-bytes hole; server write + client verify gives integrity and gating with one round trip. *(Design statement per task; the dual-computation requirement is normative for M3 frontend.)*

### 3.3 Search (§5.1)

```
GET /v1/search?q=<string>&limit=20
  q: 1..80 chars, trimmed
  Behavior:
    - If q matches ^0x[0-9a-fA-F]{6,40}$ → address mode: prefix/exact match on tokens.address
      AND tokens.creator (lowercased) — still via trgm indexes (LIKE 'q%'), exact address pinned first
    - Else → similarity search over name and ticker:
        WHERE (name % $q OR ticker % $q OR address LIKE $qp OR creator LIKE $qp)
        ORDER BY GREATEST(similarity(name,$q), similarity(ticker,$q) * 1.2) DESC, volume_eth_24h DESC
      (ticker boost + volume tiebreak + similarity floor 0.25 — ratified defaults, spec §12.22; tunable config)
    - Excludes hidden listings (§8.4)
  200 → { results: TokenCard[] }   -- same card projection as /tokens (§5.1 card fields)
```

Single endpoint covering all four fields (name, ticker, contract, creator) as the DoD requires; GIN trgm indexes defined in indexer.md §3.1.

### 3.4 Token reads (§5.1, §5.2)

```
GET /v1/tokens
  ?sort = trending | newest | mcap | volume24h | progress      (§5.1 sorts)
  &filter = pregrad | graduated | all                          (§5.1 filters)
  &cursor=&limit=
  trending = vol24h × e^(−age/24h)  (ratified default, spec §12.22; tunable config)
  progress = real_eth_reserves / graduation_eth (pre-grad only)
  200 → { tokens: TokenCard[], nextCursor }
  TokenCard: address, name, ticker, imageUrl, creator, createdAt, priceEth, mcap{usd,ethUsd,asOf},
             progressPct, change24hPct, volume24h, graduated,
             status: 'curve'|'graduating'|'graduated'            -- derived (indexer.md §3.2); drives the venue pill/widget engine
             confirmationState, moderation{visibility, impersonationFlag}

GET /v1/tokens/king-of-the-hill                                 (§5.1 hero)
  Closest to graduation among pre-grad tokens, volume-weighted:
  ORDER BY (real_eth_reserves/graduation_eth) * ln(1+volume_eth_24h) DESC  (ratified default, spec §12.22)
  200 → { token: TokenCard }

GET /v1/tokens/:address                                         (§5.2 detail + Trust panel)
  200 → TokenDetail: TokenCard fields +
    description, links, curveAddress, v3PoolAddress?, graduatedAt?,
    lpTokenId?,                                                 -- LP NFT tokenId (graduations.lp_token_id); present iff graduated —
                                                                --   drives LPFeeVault.collect(tokenId) (additive 2026-07-12, COLLECT-1 gap)
    supply: { total, curveHeld, lpTranche }                     -- from balances rows for curve/pool
    reserves: { virtualEth, virtualToken, realEth, realToken }  -- live curve state (Trust panel §5.2)
    graduation: { thresholdEth, progressPct }
    trust: {                                                    -- Trust panel §5.2, all derived, none hardcoded
      metadataVerification: { status: match|mismatch|unfetched, onchainHash, computedHash?, verifiedAt? },
      lpCopy: "LP principal permanently locked; trading fees claimable by treasury",   -- exact string, CLAUDE.md hard rule
      feePolicy: { tradeFeeBps, creatorFeeBps },                -- tradeFeeBps = per-token snapshot from tokens.trade_fee_bps
                                                                --   (indexer read the curve's TRADE_FEE_BPS immutable at TokenCreated),
                                                                --   NOT the live factory config (§12.40d — config governs future curves only);
                                                                --   creatorFeeBps present (0), §7
      organic: {                                                -- (v1.2) spec §5.2/§8.5; from indexer token_flow_stats; advisory
        holderPctLow, holderPctHigh,                            -- organic-holder estimate as a RANGE (never a point value)
        volumePct,                                              -- organic-volume % (wash excluded)
        flaggedClusterVolPct24h,                               -- flow quality: flagged-cluster share of 24h curve volume
        methodology: "heuristic — see §8.5", updatedAt          -- tooltip source; null while stats not yet computed
      }
    }
    creator: { address, tokensCreated }
    moderation: { visibility, impersonationFlag, impersonationTicker? }

GET /v1/tokens/:address/trades
  ?since=<ts|blockNumber>                                        -- WS reconnect backfill floor (indexer.md §8.4)
  &sort = age | side | trader | amount | price                  (§12.59 allowlist; DEFAULT age)
  &dir  = asc | desc                                            (DEFAULT desc — newest-first)
  &cursor=&limit=                                               -- keyset cursor + page size (config PAGE_LIMIT_DEFAULT=50)
  Trade feed (§5.2) + WS reconnect backfill (indexer.md §8.4). SERVER-side sorted + keyset-paginated
  (§12.59; server-authoritative, never client sort). Each row includes venue + confirmationState.
  sort ∉ allowlist OR dir ∉ {asc,desc} ⇒ 400 invalid_request (closed allowlist = the ORDER BY security boundary).
  sort→column (API-local map, enum→fixed identifier): age→block_timestamp (block_number correlated),
    side→is_buy, trader→trader, amount→eth_amount::numeric, price→price_eth; tiebreak id=`${txHash}-${logIndex}`.
  Keyset composes with sort: `(sort_col, id) < (k,i)` for desc / `>` for asc, cursor {k,i} HMAC-signed.
  200 → { items: TradeRow[], nextCursor }                       -- uniform {items,nextCursor} envelope (paginatedTradesResponseSchema)

GET /v1/trades/:txHash
  Optimistic-UI reconciliation lookup (web.md §4.1: RPC said success but no WS event yet).
  200 → { trades: TradeRow[] }   -- all Trade rows in that tx (create-with-initial-buy has one)
  404 → not indexed (client keeps "awaiting index" state and re-polls)

GET /v1/tokens/:address/candles?interval=1s|15s|1m|5m|15m|1h&from=<ts>&to=<ts>
  Bucket-aligned range; max 5000 buckets per request; feeds lightweight-charts (§5.2).
  200 → { candles: Candle[] }   -- venue-continuous by construction (indexer.md §4.3)

GET /v1/tokens/:address/holders
  ?sort = rank | address | label | amount | percent             (§12.59 allowlist; DEFAULT rank ≡ balance)
  &dir  = asc | desc                                            (DEFAULT desc — biggest balance first)
  &cursor=&limit=                                               -- keyset cursor + page size (config PAGE_LIMIT_DEFAULT=50)
  Top-holders table (§5.2/§12.58), SERVER-side sorted + keyset-paginated (§12.59). First page (default
  limit) IS the top-N view. Flags computed at query time by joining creator/curve/pool/vault addresses.
  sort ∉ allowlist OR dir ∉ {asc,desc} ⇒ 400 invalid_request (closed allowlist = the ORDER BY security boundary).
  sort→column (API-local map): rank/amount/percent→balance::numeric (per-token supply fixed ⇒ ONE physical
    key), address→holder, label→CASE over creator/curve/lp_pool/vault + §8.5 flags (deterministic order);
    tiebreak holder. Keyset: `(sort_col, holder) < (k,i)` for desc / `>` for asc.
  Each row carries `rank` = true balance-desc rank (ROW_NUMBER over the WHOLE token), stable even when the
  page is sorted by address/label (position ≠ rank there).
  200 → { items: [{ address, balance, pct, rank,                -- uniform {items,nextCursor} (paginatedHoldersResponseSchema)
                    flags: ('creator'|'curve'|'lp_pool'|'vault')[],
                    botFlags?: ('farm'|'sniper'|'programmatic'|'wash'|'arb_exit')[],   -- (v1.2) advisory, indexer §8.5 address_flags
                    clusterId?: string }],                                             -- shared gas-funder → grouped on the list (§5.2)
          nextCursor }
  BREAKING (§12.59): the pre-redesign { holders, holderCount } envelope is REPLACED by { items, nextCursor }.
    `holderCount` is no longer returned by this endpoint (paginatedHoldersResponseSchema is { items, nextCursor }).

GET /v1/tokens/:address/fees                                    (§6.4 treasury fee dashboard)
  200 → { collected: { token, weth, byCollection[] },           -- from fee_collections
          uncollected: { token, weth, asOf } }                  -- live NPM tokensOwed read via RPC, cached 60s

GET /v1/stats
  Global: tokens launched, graduations, 24h volume, treasury fees collected. All computed; USD per §2 convention.
```

### 3.4a Portfolio (§5.4 — Phase-2 page surfaced day 1 by the ROBBED_ redesign)

Advisory / read-only: no path mutates or depends on mutating chain state (§8.4). Any address resolves — an unknown address is an **empty** portfolio, never a 404 (the wallet ETH balance is a live chain read independent of the indexer). Shapes are the frozen `@robbed/shared` DTOs (`portfolioSummarySchema`, `portfolioHoldingSchema`, `tokenRefSchema`, `ethPnlRangeSchema`, `portfolio{Holdings,Activity,Created}ResponseSchema`) — never redeclared. **All ETH-first (§2):** value/PnL are wei decimal strings, USD mirrors derive at request time; **PnL is a nullable RANGE, no false precision (§5.2).**

> **Spec deviation (flagged for robbed-architect §12 disposition):** §5.4 Portfolio was **Phase-2**; the ROBBED_ redesign (docs/design/robbed-redesign-plan.md page 4) surfaces it day 1. The DTO schemas were ratified into `packages/shared` and this endpoint set implements them, but the **Phase-2 → day-1 promotion itself** still wants a formal §12 disposition (mirrors the redesign plan's "4 pages incl. Portfolio overrides §5" item). Recorded here, not self-resolved. *Architect 2026-07-11: DISPOSITIONED — spec §12.50a records the promotion (Portfolio → v1, read-only, no new tx types, no `collect()` UI). The advisory-read semantics of this section (no WS channel; staleTime + refetch) are additionally RATIFIED with the `PORT-*` catalog addendum (apps/web/e2e/user-flows.md §3b; ratified 2026-07-11 — ledger retired, history: git).*

```
GET /v1/portfolio/:address                                     (§5.4 stat cells)
  200 → PortfolioSummary: address, firstSeenAt, tradeCount, tokensCreated,
        walletEthBalance,                                       -- live RPC eth_getBalance (chain truth, exact)
        totalValueEth, totalValue{usd,ethUsd,asOf},             -- Σ priceable holdings' liquidation value; USD derived (§2)
        pnlAllTime: EthPnlRange | null                          -- realized (address_pnl) + unrealized (live); null when no cost basis
  NO confirmationState (aggregate roll-up, like /stats and holders).
  Source: indexer `address_pnl` (roll-up) + `balances` (holdings) + RPC (wallet ETH).
  tradeCount is a LIVE count(*) off `trades` (trades_trader_idx) — NOT the roll-up's
  trade_count, which lags by up to one job interval and is 0 on a fresh DB before the
  first tick (PORT-1, fixed 2026-07-12). firstSeenAt / tokensCreated / realized PnL
  remain roll-up-sourced: advisory latency ≤ PNL_JOB_INTERVAL_MS (default 60s).

GET /v1/portfolio/:address/holdings?cursor=&limit=              (§5.4 HOLDINGS table)
  Projects balances ⋈ tokens (BalanceRow IS the holding — anti-drift). Cursor: balance DESC.
  200 → { holdings: PortfolioHolding[], nextCursor }
  PortfolioHolding: token: TokenRef{address,name,ticker,imageUrl,graduated,status},
        balance,                                                -- Transfer-truth (balances.balance)
        priceEth: number | null,                                -- display spot; null before first trade
        valueEth: string | null,                                -- READ-TIME curve-quote liquidation value; null when unpriceable
        value: {usd,ethUsd,asOf} | null,                        -- USD mirror; null when unpriceable
        unrealizedPnl: EthPnlRange | null                       -- null when no cost basis (§5.2)

GET /v1/portfolio/:address/activity?cursor=&limit=             (§5.4 ACTIVITY tab)
  Per-address slice of the unified trade feed — REUSES TradeRow (no parallel shape). Cursor: (block_timestamp, id) DESC.
  200 → { activity: TradeRow[], nextCursor }                    -- each row carries venue + confirmationState

GET /v1/portfolio/:address/created?cursor=&limit=             (§5.4 CREATED tab, §7)
  Tokens whose on-chain creator == :address — REUSES the TokenCard projection. Listing-gated (§8.4). Cursor: (created_at, address) DESC.
  200 → { tokens: TokenCard[], nextCursor }
```

**Materialization (indexer `address_pnl`, db-rows.ts `AddressPnlRow`).** The per-address roll-up (`first_seen_at`/`last_active_at`/`trade_count`/`tokens_created`/`total_eth_in`/`total_eth_out`/realized-PnL range `realized_pnl_low/high` + `pnl_confidence`) is a **scheduled recompute-from-raw job** over `trades`+`transfers`+`tokens` (indexer.md §8.6 / SQL views `pnl_*` + TRUNCATE+re-insert, rebuildable §4.4). Balances stay Transfer-truth (existing `BalanceRow`, X-4/X-5). **Wallet ETH** = RPC balance read at the API layer; **all-time/unrealized PnL** is computed at request time (live price × balance − remaining basis), NOT materialized.

### 3.5 Confirmation & meta

```
GET /v1/confirmations          → { safeBlock, finalizedBlock, latestBlock, updatedAt }   (§2.1; SSR initial state)
GET /v1/eth-usd                → { price, source, asOf }                                  (§2; frontend display source)
GET /v1/healthz                → liveness probe: 200 { ok: true }
GET /v1/readyz                 → readiness probe, DB+Redis+R2 (gate-7 probes):
  200 → { data: { ok: true, checks: { db, redis, r2 } }, error: null }
  503 → the STANDARD §2 error envelope: { data: null, error: { code: 'upstream_unavailable',
        message: 'not ready: <failing dep names>' } } — failing dependencies are named in
        `message`; the structured `checks` object exists on the 200 arm only.
```

**Normative (2026-07-12 — W3/M2-2 readyz-envelope reconcile).** The 503 arm follows the closed
shared error enum (`upstream_unavailable`, ratified into `errorCodeSchema` 2026-07-10 with the
explicit disposition "readyz-503 dependency-down") — ONE envelope shape for every non-2xx
response, no data-carrying-503 special case. This supersedes the "data-carrying 503" annotation
previously in `apps/api/openapi.yaml` (2026-07-10), which contradicted the shared enum's own
`upstream_unavailable` disposition. Orchestration (`dev:health`, container healthchecks) gates on
the HTTP status alone and is unaffected.

### 3.5a OG share cards (spec §5.2 share card)

```
GET /v1/og/{address}.png        → image/png 1200×630 — the token's ROBBED_ terminal share card
  (also accepts /v1/og/{address}). Rendered server-side with native satori → @resvg/resvg-js
  (NOT @vercel/og): the API runs on Bun/Komodo with no Worker size limit, so OG generation moved
  OFF the web's Cloudflare Worker and the frontend just points <meta og:image> at this URL. This is
  the SINGLE OG renderer — no cross-service duplication.
  Data: reuses the /tokens card projection (name/ticker/status/graduated/progress) + the mini candle
    window (12h @ 15m) + mcap ETH-first with USD `asOf` (§2 — no hardcoded metric). Token logo is
    fetched + inlined server-side (resvg can't fetch remote URLs at raster time); failures degrade to
    a monogram tile so the image always renders.
  Cache: R2 `robbed-assets` key `og/{address}/{version}.png`, where `version` = a hash of the DISPLAY
    fields (name, mcap, progress, status, sparkline, logo) prefixed by a renderer version. A stats
    change ⇒ new hash ⇒ new key ⇒ fresh render (content-addressed; can't serve stale). `version` is
    also the `ETag` → a matching `If-None-Match` short-circuits to 304 (no render, no R2 read).
    Cache hit reads bytes from R2; miss renders once, stores, serves. `X-Robbed-Og-Cache: hit|miss`.
    `Cache-Control: public, max-age=300, s-maxage=300, stale-while-revalidate=86400`.
  404 → unknown token; 400 → malformed address. Never mutates chain state (§8.4).
```

### 3.6 Moderation — admin endpoints (§8.4)

All under `/v1/admin/*`, auth per §6. Every action audit-logged.

```
GET   /v1/admin/nonce          → { nonce } — single-use SIWE nonce (Redis, 10-min TTL); public (mints the session)
POST  /v1/admin/login          { message, signature } → Set-Cookie session (12h) + { address, csrfToken }
POST  /v1/admin/logout         → clears the session cookie; idempotent, no session required
GET   /v1/admin/moderation/queue?status=pending_review|flagged&cursor=
        → queue items: token, image, metadata, vendor scores, impersonation match, current visibility
POST  /v1/admin/moderation/:tokenAddress/visibility   { visibility: visible|hidden, reason }
        → sets listing visibility ONLY (§8.4: "admin can hide listings only") — there is deliberately
          no endpoint that can pause, block, or otherwise touch chain state; sells/buys are untouchable from here
POST  /v1/admin/moderation/:tokenAddress/impersonation { flagged: bool, ticker?, reason }
POST  /v1/admin/metadata/:tokenAddress/reverify        → publishes `control:reverify {token}` on Redis; the INDEXER
                                                          flips its own `metadata_verifications` row (X-9 — the API never
                                                          writes indexer-owned tables; indexer.md §6.2 is the sole writer)
GET   /v1/admin/audit-log?cursor=
```

### 3.7 Internal dashboard endpoints (D-4 — spec §12.54; M2-13/M2-14; Gate G-A.1/G-A.2)

Thin, READ-ONLY internal surface under `/internal/*`, consumed by the internal ops dashboard /
Gate G-A evidence collection — never by the public frontend. **Gating: admin-SIWE session** (the
same `requireAdmin` cookie session as §3.6/§6.2). Chosen over internal-network-only gating per
D-4's "least new surface" reasoning: the SIWE session mechanism already exists, whereas network
topology is deployment-owned and unverifiable from this repo. Rate-limited in the admin class
(§6.3). GET-only → no CSRF (CSRF guards mutations only). **Advisory-only framing is binding
(§8.4/§8.5):** everything here is labeling/telemetry — it never gates chain state, listing, or
any user path.

```
GET /internal/flow/:address                                    (M2-13; Gate G-A.1 flow quality)
  404 → unknown token. 200 →
  { token,                                                     -- lowercased token address
    organic: OrganicFlow | null,                               -- EXACTLY the shared organicFlowSchema object the Trust
                                                               --   panel gets (§3.4) — same projection (projections/
                                                               --   trust.ts buildOrganic); null until the §8.5 job has
                                                               --   computed token_flow_stats. holderPctLow/High is a
                                                               --   RANGE (§5.2 — no false precision); volumePct and
                                                               --   flaggedClusterVolPct24h are the §8.5.2 estimates
                                                               --   (wash-excluded organic volume / cluster share of
                                                               --   24h curve volume).
    flagged: {                                                 -- §8.5 advisory summary over THIS token's current holders
      holders,                                                 -- count of holders carrying ≥1 BotFlag
      clusters,                                                -- distinct funder clusters among flagged holders
      byFlag: { farm, sniper, programmatic, wash, arb_exit }   -- per-flag holder counts (shared BotFlag vocabulary)
    } }

GET /internal/competitor-snapshots?cursor=&limit=              (M2-14; Gate G-A.2 traction input)
  200 → { snapshots: CompetitorSnapshotRow[], nextCursor }     -- newest first: ORDER BY captured_at DESC, source DESC;
                                                               --   keyset cursor (captured_at, source), §2 pagination
  Rows are the shared `CompetitorSnapshotRow` VERBATIM (source, captured_at, tokens_per_day,
  graduations, visible_volume_eth — snake_case row-as-wire, deliberate for the internal surface).
  §2 discipline: `source` + `captured_at` are NOT NULL by table constraint and always present —
  the endpoint only reads, it can never fabricate a metric. While the snapshot source is
  unconfigured (indexer `unconfiguredCompetitorSource`, spec §13 / §8.5.3 "manual until
  configured") the table stays empty and this returns an empty page.
```

**DTO disposition (routed to robbed-shared, not self-resolved).** The two composite response
shapes (`{ token, organic, flagged }` and `{ snapshots, nextCursor }`) are built entirely from
shared primitives (`organicFlowSchema`, `BotFlag`, `CompetitorSnapshotRow`) and typed API-locally
in `apps/api/src/routes/internal.ts`. They have exactly ONE consumer (the internal dashboard), so
per the §12.40c single-consumer precedent they may stay API-local — or robbed-shared may ratify
`internalFlowResponseSchema` / `competitorSnapshotsResponseSchema` into `api-types.ts`. Flagged in
the W3 report; either way nothing shared is redeclared here.

## 4. Moderation pipeline (§8.4)

### 4.1 Principles

Moderation gates **listing** (visibility in `/tokens`, `/search`; WS `global:launches` is unaffected in v1 — ratified, spec §12.21), never chain state, never creation, never trading. Failure of any vendor **fails open to `pending_review`** visibility policy (§4.5), never blocks the launch tx.

### 4.2 Upload-time (synchronous, §3.1)

MIME sniff on magic bytes → allowlist → re-encode (strips metadata, kills polyglot/steganographic containers as a side effect) → size cap. This runs before bytes touch R2. Text fields validated/length-capped at `POST /v1/metadata`.

### 4.3 Auto-moderation (async, vendor-pluggable — §13 open item)

Vendor undecided (§13), so the pipeline is built against interfaces **defined in `apps/api/src/moderation/vendors/`** (NOT `packages/shared` — §12.40c: these interfaces are consumed by exactly one service, the API moderation worker, so they fail the anti-drift ≥2-consumers test and stay API-local), with implementations in the same directory:

```ts
interface CsamHashMatcher   { check(imageBytes: Uint8Array): Promise<{ match: boolean; vendorRef?: string }> }   // e.g. PhotoDNA/IWF-class vendor
interface ContentClassifier { classify(imageBytes: Uint8Array): Promise<{ nsfw: number; violence: number }> }    // 0..1 scores
```

Jobs run from a Redis-backed queue (BullMQ-class or minimal Redis list worker — implementation choice, OI-A4) after image upload and again keyed to the token at `TokenCreated` (linking image→token). Results land in `moderation_status` (table owned by API; shape in indexer.md §3.11):

- `csam_flag = true` → `visibility = 'hidden'` immediately + irreversible-by-UI (unhide requires out-of-band process), vendor-mandated reporting hook (NCMEC-class) stubbed behind the vendor interface — legal flow is part of vendor selection (§13).
- `nsfw ≥ HIDE_THRESHOLD` → `hidden`; `nsfw ≥ REVIEW_THRESHOLD` → `pending_review`. Thresholds config, defaults 0.95 / 0.80.
- Vendor unavailable → `pending_review` + retry with backoff; alert on queue depth (gate 7).

A dev/null vendor (`AlwaysCleanMatcher`, `StubClassifier`) ships for local/test; production refuses to boot with stub vendors unless `MODERATION_ALLOW_STUBS=true` (capped-beta escape hatch, logged loudly).

### 4.4 Impersonation flags (§8.4)

Static curated list in config/DB (`impersonation_watchlist`: ticker, name variants) covering top-asset tickers (BTC, ETH, top-100 by mcap — list is data, refreshed manually, **never hardcoded metrics**, §2) and Robinhood **Stock Tokens** tickers (HOOD, AAPL, TSLA-class — source: Robinhood's published Stock Token list at implementation time). At `POST /v1/metadata` and at `TokenCreated`: case-insensitive exact + confusable-normalized (homoglyph fold) match on ticker and name → `impersonation_flag = true`. Flag ≠ hidden: it renders as a warning badge (frontend concern) and pushes the item into the review queue. Admin can clear or escalate to hidden.

**`TokenCreated` observation seam (X-10).** The API has a read-only DB role on indexer tables and no chain subscription, so it cannot itself watch `TokenCreated`. The seam is Redis: the indexer already publishes `launch` on `global:launches` for every `TokenCreated` (indexer.md §8.1). The API runs a small **moderation worker** (part of the WS process or a sibling worker) that subscribes to `global:launches`, and on each launch performs the token-time checks — impersonation match on the on-chain name/ticker and linking the pre-scanned image moderation result to the token — writing verdicts to `moderation_status` (an API-owned table, §3.11). No chain read, no indexer-table write; the worker consumes the indexer's existing publish.

### 4.5 `pending_review` visibility policy

`pending_review` items **remain listed** with default trust treatment in v1 (capped beta, low volume, human review SLA is hours) — hiding-by-default would let a vendor outage blank the site. *(Ratified — spec §12.21.)*

## 5. Shared types (`packages/shared`)

Single source consumed by web + indexer + api; nothing below may be redeclared elsewhere.

| Module | Contents | Consumers |
|---|---|---|
| `metadata.ts` | `TokenMetadata` zod schema (name/ticker/description/links/imageUrl/imageHash/version), `canonicalizeMetadata(obj): Uint8Array`, `metadataHash(obj): Hex` (keccak256 wrapper) + golden fixtures | api (canonicalize+hash), web (pre-sign verify), indexer (verification §8.3) |
| `confirmation.ts` | `ConfirmationState = 'soft_confirmed' \| 'posted_to_l1' \| 'finalized'`, ordering helper, `stateForBlock(blockNumber, watermarks)` | all three |
| `channels.ts` | channel-name builders (`tokenTrades(addr)`, `GLOBAL_LAUNCHES`, …) — taxonomy in indexer.md §8.1 | indexer (publish), api/ws (fanout), web (subscribe) |
| `ws-messages.ts` | envelope + per-type message schemas (indexer.md §8.2), zod-validated | indexer, ws, web |
| `api-types.ts` | `TokenCard`, `TokenDetail`, `TradeRow`, `Candle`, `HolderRow`, `SearchResult`, `UsdValue`, `ConfirmationsResponse`, `EthUsdResponse`, `ModerationQueueItem` (§12.40a), error codes, pagination envelope | api (response shaping), web (consumption) |
| `events.ts` | decoded on-chain event types (TokenCreated/Trade/Graduated/Swap/Collect field structs) mirroring ABIs from M1 artifacts | indexer, tests |
| `db-rows.ts` | row types matching indexer.md §3 tables | indexer, api |
| `constants.ts` | chain id 4663, WETH address, interval list, size caps, the exact LP copy string | all three |

Canonicalization is defined once, here, RFC-8785-style (UTF-8, sorted keys at every depth, no whitespace, canonical number/string forms); the indexer doc's byte-identical requirement (indexer.md §6.1) is satisfied by construction because there is exactly one implementation.

**Frozen-schema notes for robbed-shared (this ratification pass):**
- **`api-types.ts` additions (§12.40a):** `export type` aliases `ConfirmationsResponse` (`GET /v1/confirmations` → `{ safeBlock, finalizedBlock, latestBlock, updatedAt }`), `EthUsdResponse` (`GET /v1/eth-usd` → `{ price, source, asOf }`), `ModerationQueueItem` (admin queue row, §3.6) — for naming consistency with the other DTOs.
- **`api-types.ts` error-code union (§12.40b):** the union lists **only codes the API actually returns**; `conflict`/409 is **dropped** (no genuine resource-conflict path exists in v1 — content-addressed image + metadata are idempotent). The metadata imageHash-reference mismatch is `invalid_request` (HTTP 400, §3.2).
- `metadata.ts` `TokenMetadata`: `name` max = **32 bytes**, `ticker` max = **10 bytes** (UTF-8 byte length via a custom zod refinement, not `.max()` char count — must equal the on-chain byte limits, §12.30). `version` is a literal `1` (frozen inside the hash preimage, §12.31). The prior `name ≤ 64 chars` is superseded — robbed-shared updates the frozen schema and the OpenAPI (`apps/api/openapi.yaml`) to match.
- `api-types.ts` **`TokenCard.creator` is an address string; `TokenDetail.creator` is `{ address, tokensCreated }`** (an enriched object) — by design (card vs detail), documented here so consumers don't expect one shape (X-13). `ws-messages.ts` gains the `fee_collected` message (indexer.md §8.2, X-6).

## 6. Auth, rate limiting, abuse surface

### 6.1 Public endpoints

No auth (reads + upload/metadata). Anonymous uploads are inherent to the product (launch flow precedes any tx).

**CORS (2026-07-12, closes the env-inventory `CORS_ALLOWED_ORIGINS` audit gap).** Browsers fetch the
public surface cross-origin (web origin ≠ api origin per env), so the API applies Hono's `cors()`
(`apps/api/src/mw/cors.ts`) to **`/v1/*` excluding `/v1/admin/*`** — and never to `/internal/*`:

- **Origins** from `CORS_ALLOWED_ORIGINS` (comma-separated env; **production refuses to boot when
  unset** — mirrors the DB-role guard; dev default = local web origins). Function-form origin:
  exact match (case-insensitive) echoes the request origin; a disallowed origin gets **no** CORS
  headers. Never `*`.
- `allowMethods: GET, POST, OPTIONS`; `allowHeaders: Content-Type` (metadata POST is
  `application/json` → preflighted; multipart upload is safelisted but preflight still succeeds);
  `exposeHeaders: Retry-After` (the browser client's 429 backoff, §6.3, needs to read it);
  `maxAge` 24 h; `Vary: Origin`; **no credentials** — the public surface is cookie-less.
- Registered **before** the rate limiters, so `OPTIONS` preflights are answered by the middleware
  (204; no OPTIONS routes exist) and never consume rate budget, while a 429 on the actual request
  still carries CORS headers (readable failure instead of an opaque network error).
- **Scoping decision:** `/v1/admin/*` and `/internal/*` are the cookie+CSRF SIWE surface (§6.2) and
  stay **same-origin only** — opening them cross-origin would widen the CSRF/session attack
  surface for zero product need (the admin surface is operated same-origin). The middleware
  explicitly skips them; tests assert no `Access-Control-Allow-Origin` ever appears there.

### 6.2 Admin auth

**SIWE (EIP-4361) against an address allowlist** (the ops/Safe signer set is a §13 open item; allowlist is config) → short-lived signed session cookie (HttpOnly, SameSite=strict, 12h) + CSRF token on mutations. No passwords, no third-party IdP dependency, key custody matches the rest of the project's trust model. All admin mutations audit-logged.

**`moderation_audit_log` (§12.40f — API-local table, NOT shared).** Written and read **only** by the API admin path, so it fails the anti-drift ≥2-consumers test: its row type lives in `apps/api`, not `packages/shared` `db-rows.ts`, and it is not an indexer table. DDL (API-owned migration, alongside `moderation_status` / `impersonation_watchlist`):

```
moderation_audit_log(
  id          bigserial primary key,
  actor       text not null,          -- SIWE address
  action      text not null,          -- e.g. set_visibility | set_impersonation | reverify
  target      text not null,          -- token address
  reason      text,
  created_at  timestamptz not null default now()
)
```

### 6.3 Rate limiting (Redis, sliding window, per-IP + per-route)

| Route class | Limit (default, config) |
|---|---|
| `POST /uploads/image` | 10/hour/IP, 3/min/IP |
| `POST /metadata` | 20/hour/IP |
| `GET /search` | 60/min/IP |
| read endpoints | 300/min/IP |
| admin | 60/min/session |

429 with `Retry-After`. Additionally: upload endpoint requires a lightweight proof-of-intent in v1? **No** — keep it simple; content-addressing dedupes storage spam and the hourly cap bounds abuse (interpretation; revisit if beta shows abuse).

### 6.4 Abuse surface inventory

- **Storage spam** → caps + content-addressed dedupe + hourly limits; R2 lifecycle rule deletes `images/` objects never referenced by a `POST /metadata` within 24h (orphan sweep job).
- **Decode bombs** (pixel floods, zip-bomb JPEGs) → decoder resource limits (max 8k×8k pre-decode check, worker memory cap, 10s timeout).
- **SSRF** — API fetches nothing user-specified except R2 keys it minted; `links` are stored, validated as URLs, never fetched server-side.
- **Stored-link XSS** (threat-model UM-5) — `links` are validated with an **`https:`-only scheme allowlist** (reject `javascript:`, `data:`, `http:`, and any non-`https` scheme) at `POST /v1/metadata`; the frontend additionally renders them with `rel="noopener noreferrer"` under CSP (web.md §5). Syntactically-valid-but-hostile schemes never pass.
- **Search DoS** — trgm similarity floor, `q` length cap, statement timeout 2s on the search pool, rate limit.
- **Enumeration/scraping** — accepted; data is public chain data.
- **Moderation bypass via metadata mutation** — R2 objects content-addressed by hash; a changed object breaks the hash and the indexer's re-verify flips the Trust verdict (indexer.md §6.2); moderation keys off the bytes we scanned.
- **Admin endpoints** — allowlist + SIWE + audit log; no chain-affecting capability exists to escalate to (§8.4 by construction).

### 6.5 WS server hardening

Max 20 channel subscriptions/socket (Discover + one token page fits comfortably), max 5 conns/IP, subscribe-op rate limit, payloads are server→client only (client ops limited to sub/unsub/ping), drop on malformed frame. No auth in v1 (all-public data).

## 7. Deployment shape

Two processes from one codebase: `apps/api/src/index.ts` (Hono HTTP) and `apps/api/src/ws.ts` (Bun WS fanout, indexer.md §8). Both Bun; share `packages/shared` and config loader; scale independently (WS is fan-out-bound, HTTP is DB-bound). Postgres access: read-only role for indexer-owned tables (enforces "indexer owns writes"), read-write role limited to `moderation_status`, `moderation audit log`, `impersonation_watchlist`.

## 8. Testing

- Vitest (`bun test`): metadata canonicalization/hash round-trip against shared golden fixtures (must equal indexer + frontend results — same fixtures file); zod schema edges (ticker length, link URLs, description 500); search query builder for all four field classes (name, ticker, address, creator) + address-mode detection; moderation state machine (vendor scores → visibility transitions, csam short-circuit, fail-open to pending_review); rate-limit window math; SIWE session lifecycle; impersonation matcher incl. homoglyphs.
- Integration: ephemeral Postgres seeded with indexer-fixture rows → every read endpoint snapshot-tested against `packages/shared` types (compile-time + runtime zod); R2 mocked via local S3-compatible (minio) in CI; upload pipeline with real image fixtures (oversized, wrong-magic-bytes, EXIF-laden, animated gif, decode-bomb).
- Latency guard: WS fanout integration test asserting no DB client is ever constructed in the fanout path (import-graph assertion) — protects the <500ms budget structurally.

## 9. Open items & decisions needed

| ID | Item | Recommendation | Status |
|---|---|---|---|
| OI-A1 | "R2 presigned uploads" (§8) read as browser-direct presign vs API-mediated upload | — | **RESOLVED — spec §12.19 (2026-07-09):** API-mediated; presign only on the API→R2 leg; spec §5.3/§8 amended |
| OI-A2 | Search ranking (ticker boost ×1.2, volume tiebreak, similarity floor 0.25) | — | **RESOLVED — spec §12.22:** as stated; tunable config, tune in beta |
| OI-A3 | `trending` sort + King-of-the-Hill formula | — | **RESOLVED — spec §12.22:** KotH `progress × ln(1+vol24h)`; trending `vol24h × exp(−age/24h)`; tunable config, not consensus values |
| OI-A4 | Moderation job queue tech (BullMQ vs minimal Redis worker) | Minimal Redis list worker — one less dependency; revisit if retry semantics outgrow it | Implementation choice, robbed-indexer's call — not a spec matter |
| OI-A5 | `pending_review` default visibility + whether WS `global:launches` respects moderation | — | **RESOLVED — spec §12.21:** default-listed; WS ticker unmoderated in v1 (moderation-aware fanout would need hot-path DB reads) |
| OI-A6 | Hidden tokens on direct `/tokens/:address` fetch: 404 vs visible-with-flag | — | **RESOLVED — spec §12.21:** visible-with-flag |
| OI-A7 | Moderation vendor selection (CSAM hash-match + NSFW classifier) + mandated-reporting legal flow | Interfaces (§4.3) let M2 ship with stubs behind a boot guard | **OPEN — spec §13** |
| OI-A8 | Admin allowlist membership (ties to Safe signer set, §13) | Config-driven allowlist; populate when signer set decided | **OPEN — spec §13** |
| OI-A9 | Stock Token / top-asset ticker list source + refresh cadence for impersonation watchlist | — | **RESOLVED — spec §12.23:** curated, source-cited, dated data file, refreshed ≥ monthly |
| OI-A10 | ETH/USD endpoint source (shared with indexer OI-6) | Single source of truth = `eth_usd_snapshots` table (indexer poller writes, API reads) | Aligned; underlying source **OPEN — spec §13** (indexer OI-6) |

## 10. Definition of done (M2, API)

- [ ] All endpoints of §3 implemented with request/response schemas from `packages/shared` (zod-validated in, typed out); frontend imports, never redeclares
- [ ] Upload pipeline: magic-byte sniff, ≤4MB cap, re-encode, EXIF strip, content-addressed R2 write, image-hash returned — tested with hostile fixtures
- [ ] `POST /v1/metadata`: shared canonicalization, keccak256, R2 write at `metadata/{hash}.json`; client-verification contract documented for M3; golden-fixture hash parity test with indexer + frontend
- [ ] Search returns correct results for all four fields (name, ticker, contract address, creator address) via `pg_trgm`; address-mode + similarity-mode both tested
- [ ] All §5.1/§5.2 read endpoints live: lists with all five sorts + three filters, KotH, detail with full Trust-panel payload (exact LP copy string from `constants.ts`), trades (with `since` backfill), candles (all six intervals), holders with flags, fees dashboard, confirmations, eth-usd
- [ ] Moderation: vendor interfaces + stub implementations + boot guard; csam/nsfw/impersonation state machine tested; admin queue + visibility + audit log; provably no endpoint touches chain state (route-inventory test asserts no signer/wallet module imported)
- [ ] `confirmationState` present on every event-derived response object (§2.1)
- [ ] No USD/market constant anywhere; every USD field carries `asOf` (§2)
- [ ] SIWE admin auth + rate limits + WS hardening in place
- [ ] `bun test` green (units + integration); response snapshots type-checked against `packages/shared`
