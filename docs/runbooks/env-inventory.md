# Runbook — Environment Variable Inventory (all services)

**Status:** v1.1, 2026-07-11. Authored by hoodpad-architect (plan item **P-1**). Inputs: indexer.md §2, api.md §2/§4/§5, web.md §2.3/§9.6, `.env.example`, deploy-komodo-cloudflare.md A.3/B.2. v1.1: table re-verified against a full `process.env`/`vm.env` grep of `apps/` + `tools/` + `contracts/script` (2026-07-11) — API section rewritten from `apps/api/src/config.ts` (role-split DB URLs, `API_PORT`, NSFW thresholds, `TRUSTED_PROXY_HEADER`), indexer sidecar/flow/metrics vars added, §12.51 Chainlink rows kept, dev/test tooling section (§5) added.

This is the **authoritative per-variable table** for every service. It is the source `.env.example` and the Komodo/Workers secret stores are populated from.

> **`.env.example` sync is ENFORCED (G-9 env leg).** `scripts/env-sync-check.ts` mechanically compares each app's `.env.example` keys against this inventory's rows in both directions — it runs inside `scripts/doc-check.ts` (which CI's docs job executes on every push) and as the `env-sync` stage of `scripts/validate.sh`. The `<!-- env-sync … -->` markers below drive it; a row carrying `sync:skip` is documented here but knowingly absent from the `.env.example` (each such row names its owner). All three per-app examples (`apps/indexer`, `apps/api`, `apps/web`) exist and are checked strictly (the v1.1 `allow-missing` interim for `apps/api/.env.example` ended 2026-07-11 when robbed-indexer authored it).

> **Docs-first rule.** Before changing any endpoint/credential convention, consult current official docs (context7 MCP → fallback WebFetch): Ponder env (https://ponder.sh), Cloudflare Workers build vars (https://developers.cloudflare.com/workers/configuration/environment-variables/), Wrangler config (https://developers.cloudflare.com/workers/wrangler/configuration/), Komodo secrets (https://komo.do/docs). Docs beat assumptions; the spec beats docs (flag the conflict).

## Conventions

- **Secret?** — `SECRET` = never committed, lives in the Komodo secret store or Workers secret; `PUBLIC` = safe to commit / inline; `CONFIG` = non-secret but environment-specific (endpoints, addresses, feature values).
- **Source** — where the value comes from (deploy artifact, provider console, §13 decision, constant).
- **Owner** — the agent/role that furnishes/rotates the value.
- **Never hardcode market metrics (§2).** Any price/threshold value is a config var with a documented source+timestamp, never a literal in code.
- **Chain id 4663 is NOT an env var** anywhere — it is a compile-time constant in `@robbed/shared` (`constants.ts`), asserted against the RPC at startup (indexer.md §2). WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` is likewise a constant, asserted not configured.

---

## 1. Indexer (`apps/indexer` — Node/Ponder container, Komodo Stack)

Source: indexer.md §2 + `apps/indexer/src/config.ts` / `src/sidecar.ts` / `src/jobs/*` (grep-verified 2026-07-11). Runs in the Komodo Stack (deploy-komodo-cloudflare.md Part A); secrets are Komodo-managed.

<!-- env-sync file=apps/indexer/.env.example -->

| Var | Purpose | Secret? | Source | Owner | dev | testnet | prod |
|---|---|---|---|---|---|---|---|
| `INDEXER_RPC_WS` | Alchemy WS RPC for chain 4663 (realtime sync) | SECRET | Alchemy console / Robinhood provider | hoodpad-indexer | local anvil WS `ws://localhost:8545` | Robinhood testnet WS (§13, Phase T) | provider WS URL (with key) |
| `INDEXER_RPC_HTTP` | HTTP fallback + historical backfill | SECRET | same provider | hoodpad-indexer | `http://localhost:8545` | testnet HTTP RPC | provider HTTP URL (with key) |
| `CURVE_FACTORY_ADDRESS` | Factory address (event source) | CONFIG | M1 deploy artifact → `packages/shared/src/addresses.ts` | hoodpad-contracts (deploy) | local deploy | testnet deploy | mainnet deploy |
| `ROUTER_ADDRESS` | Router address (event source; optional) | CONFIG | M1 deploy artifact | hoodpad-contracts | local | testnet | mainnet |
| `MIGRATOR_ADDRESS` | V3Migrator address (**required** — emits `Graduated`; factory anchor for pools) | CONFIG | M1 deploy artifact | hoodpad-contracts | local | testnet | mainnet |
| `V3_FACTORY_ADDRESS` | Uniswap V3 factory (assert at startup) | CONFIG | **§12.28** `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` (constant on 4663; still config so startup fails-closed if unset) | hoodpad-indexer | local V3 core deploy | 4663 value | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` |
| `V3_NPM_ADDRESS` | NonfungiblePositionManager (assert) | CONFIG | **§12.28** `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` | hoodpad-indexer | local | 4663 | `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` |
| `REDIS_URL` | Pub/sub + WS fanout + rate-limit + moderation queue | SECRET | Komodo Redis service | hoodpad-indexer | `redis://localhost:6379` | Stack internal | Stack internal (`redis://redis:6379`) |
| `DATABASE_URL` | Postgres (`pg_trgm` required; migration asserts) | SECRET | Komodo Postgres service | hoodpad-indexer | `postgres://…@localhost:5432/robbed` | Stack internal | Stack internal, indexer-owner role |
| `DATABASE_SCHEMA` | Ponder schema for the GIN-index migration (optional, default `public`) | CONFIG | fixed default | hoodpad-indexer | unset | unset | unset (or Ponder schema name) |
| `R2_METADATA_BASE_URL` | CDN base for canonical metadata JSON (metadata-fetch worker) | CONFIG | Cloudflare R2 public base (`robbed-assets`) | hoodpad-indexer | minio public URL | R2 public base | R2 public base |
| `METADATA_FETCH_REWRITE_FROM` | Dev-only fetch-time URL rewrite (pair with `…_TO`, both or neither): browser-visible object-URL prefix the metadata-fetch worker rewrites before fetching | CONFIG | dev compose topology (`apps/indexer/.env.example`) | hoodpad-indexer | minio public URL prefix | unset | unset (CDN reachable everywhere) |
| `METADATA_FETCH_REWRITE_TO` | …rewrite target: container-internal minio base (e.g. `http://minio:9000/…`); fetch-time only, never persisted | CONFIG | dev compose topology | hoodpad-indexer | `http://minio:9000/…` | unset | unset |
| `ETH_USD_SOURCE_URL` | HTTP **fallback** price source for the `eth_usd_snapshots` poller (indexer.md §3.9) — primary source on LOCAL/TESTNET; resilience fallback behind Chainlink on mainnet (§12.51) | CONFIG | **§12.51 (OI-6 closed)** — DefiLlama (`coins.llama.fi/prices/current/coingecko:ethereum`) or Coinbase (`api.coinbase.com/v2/prices/ETH-USD/spot`) | hoodpad-indexer | DefiLlama/Coinbase HTTP | same | same (fallback behind the Chainlink feed) |
| `CHAINLINK_ETH_USD_FEED` | Chainlink ETH/USD proxy for the indexer.md §3.9 poller's mainnet branch; `off` disables the branch entirely (required on a fresh local chain launched as id 4663) | CONFIG | **§12.51** — recorded default `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` (env override allowed, mirrors the §12.28 V3 pattern); branch also auto-skipped when RPC chain id ≠ 4663; fail-closed startup assertions `description()=="ETH / USD"`, `decimals()==8` | hoodpad-indexer | `off` (fresh chain) / unset (4663 fork — feed exists in fork state) | unset (46630 auto-skips) | unset (§12.51 default) |
| `ETH_USD_POLL_INTERVAL_MS` | indexer.md §3.9 poller cadence (spec band 30–60s) | CONFIG | fixed default `30000` | hoodpad-indexer | `30000` | `30000` | `30000` |
| `ETH_USD_CHAINLINK_STALENESS_SECONDS` | Reject Chainlink answers whose `updatedAt` is older than this (→ HTTP fallback); never a price literal (§2) | CONFIG | default `3600` (standard ETH/USD heartbeat; threshold ≥ heartbeat per Chainlink docs) | hoodpad-indexer | `3600` | `3600` | `3600` |
| `START_BLOCK` | Factory deploy block (backfill floor) | CONFIG | M1/testnet/mainnet deploy tx block | hoodpad-contracts | 0 | testnet deploy block | mainnet deploy block |
| `TREASURY_ADDRESS` | Gnosis Safe; sole valid V3 `Collect` recipient for the gate-7 recipient check (§6.4/§6.6). Unset ⇒ check degrades to an "unverified" warn | CONFIG | O-6 Safe address (**NEEDS-USER**) | architect + ops | unset | testnet Safe | O-6 Safe |
| `INDEXER_SIDECARS` | `off` disables the M2-6 tracker + M2-7 verifier loops (optional) | CONFIG | fixed default (on) | hoodpad-indexer | unset | unset | unset |
| `FLOW_JOB_INTERVAL_MS` | §8.5 bot/farm flow-job cadence (optional, default `60000`; advisory labeling only, never gates chain state) | CONFIG | fixed default | hoodpad-indexer | unset | unset | unset |
| `FLOW_*` | §8.5 flow-job thresholds (6 keys: `FLOW_FUNDER_MIN_WALLETS`, `FLOW_MICRO_TRANSFER_WEI`, `FLOW_SNIPER_WINDOW_SEC`, `FLOW_SNIPER_FUNDED_WITHIN_SEC`, `FLOW_MULTIPOOL_EXIT_MIN`, `FLOW_WASH_FEE_TOLERANCE`) — spec §8.5 v1 defaults, config not literals; tune with M2 data | CONFIG | spec §8.5 defaults | hoodpad-indexer + security | unset | unset | unset (tuned pre-beta) |
| `PNL_JOB_INTERVAL_MS` | Portfolio PnL job cadence (`src/pnl/job.ts`, optional, default `60000`) | CONFIG | fixed default | hoodpad-indexer | unset | unset | unset |
| `METRICS_ENABLED` | `off` ⇒ do not bind the `/metrics` server (optional) | CONFIG | fixed default (on) | hoodpad-indexer | unset | unset | unset (must be on for gate 7) |
| `METRICS_PORT` | Prometheus-style gate-7 metrics port (indexer.md §9.4, M2-12) | CONFIG | fixed default `9464` | hoodpad-indexer | `9464` | `9464` | `9464` (scraped in-Stack) |
| `CLUSTER_ALERT_PER_TOKEN_PCT` | Per-token cluster volume-share alert % (§12.36 default `25`, advisory) | CONFIG | M0 `constants.json.governance` | hoodpad-security | unset | unset | tuned pre-beta (gate 7) |
| `CLUSTER_ALERT_PLATFORM_PCT` | Platform-wide cluster volume-share alert % (§12.36 default `10`, advisory) | CONFIG | M0 `constants.json.governance` | hoodpad-security | unset | unset | tuned pre-beta (gate 7) |
| `COMPETITOR_SNAPSHOT_INTERVAL_MS` | §8.5.3 hood.fun competitor-snapshot cadence (optional, default weekly; unconfigured source ⇒ job writes nothing — never a fabricated metric, §2) | CONFIG | fixed default | hoodpad-indexer | unset | unset | unset |

WETH is **never** an env var for any service — it is the canonical constant `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` asserted in code (Conventions above; the v1.0 `WETH_ADDRESS` row was stale and is removed — `apps/indexer/src/config.ts` reads no such key).

### 1a. OI-8 L1-watermark fallback vars (DORMANT — M2-3b, not funded)

**OI-8 RESOLVED (§12.48b, verified 2026-07-11):** `safe`/`finalized` tags ARE supported on the official 4663 RPC — the tracker's tag path runs and these vars are **not provisioned**. The table stays as the pre-sanctioned fallback design should a future RPC drop tag support; M2-3b remains dormant, NOT funded.

| Var | Purpose | Secret? | Source | Owner |
|---|---|---|---|---|
| `L1_RPC_URL` | L1 RPC to read rollup/inbox watermarks (`SequencerBatchDelivered`, finality) | SECRET | L1 provider | hoodpad-indexer |
| `L1_ROLLUP_ADDRESS` | Orbit Rollup contract on L1 | CONFIG | Robinhood/Orbit deployment (§13, from official docs) | hoodpad-indexer |
| `L1_SEQUENCER_INBOX_ADDRESS` | SequencerInbox on L1 (batch-posted watermark) | CONFIG | same | hoodpad-indexer |

---

## 2. API + WS (`apps/api` — Bun container, Komodo Stack)

Source: api.md §4.3/§5/§6 + `apps/api/src/config.ts` / `src/ws.ts` (grep-verified 2026-07-11 — the config loader is the authoritative key list). Two processes from one image: `src/index.ts` (Hono HTTP) and `src/ws.ts` (Bun WS fanout).

<!-- env-sync file=apps/api/.env.example -->

| Var | Purpose | Secret? | Source | Owner | dev | testnet | prod |
|---|---|---|---|---|---|---|---|
| `API_PORT` | Hono HTTP listen port (default `3001`) — the v1.0 `PORT` row was wrong; code reads `API_PORT` | CONFIG | fixed default | hoodpad-indexer | `3001` | `3001` | `3001` (behind TLS/CDN) |
| `API_ENV` | `development`/`test`/`production` — prod enforces the DB role split + the moderation stub boot-guard | CONFIG | deploy environment | hoodpad-indexer | `development` | `production` | `production` |
| `WS_PORT` | Bun WS fanout listen port | CONFIG | fixed default | hoodpad-indexer | `3002` | `3002` | `3002` (behind TLS/CDN) |
| `DATABASE_URL` | Single-role dev fallback for both legs below (local only) | SECRET | local Postgres | hoodpad-indexer | local | unset | unset (role split mandatory) |
| `DATABASE_URL_RO` | Read-only role on indexer-owned tables (api.md §7 role split; **required in prod** — boot refuses otherwise) | SECRET | Komodo Postgres (RO role) | hoodpad-indexer | unset (falls back) | Stack internal | Stack internal, RO role |
| `DATABASE_URL_RW` | Read-write role on API-owned `moderation_status`/`moderation_audit_log`/`impersonation_watchlist` only | SECRET | Komodo Postgres (RW role) | hoodpad-indexer | unset (falls back) | Stack internal | Stack internal, RW role |
| `REDIS_URL` | Subscribe `global:*`/`control:*`; moderation queue; rate-limit | SECRET | Komodo Redis | hoodpad-indexer | `redis://localhost:6379` | Stack internal | Stack internal |
| `SESSION_SECRET` | HMAC key for stateless SIWE admin session + CSRF signing (api.md §6.2) | SECRET | generated (32B random) | hoodpad-indexer + ops | dev default | random | rotated secret |
| `ADMIN_ALLOWLIST` | Comma-separated admin SIWE addresses (api.md §6.2) | CONFIG | **§13 OI-A8** — follows Safe signer set O-6 (**NEEDS-USER**) | architect + ops | dev signer addr | dev signer addr | O-6 signer set (NEEDS-USER) |
| `TRUSTED_PROXY_HEADER` | Header carrying the real client IP behind the CDN (e.g. `CF-Connecting-IP`); empty ⇒ socket peer (dev). Never the leftmost XFF (rate-limit bypass) | CONFIG | CDN choice | hoodpad-indexer | unset | `CF-Connecting-IP` | `CF-Connecting-IP` |
| `MODERATION_ALLOW_STUBS` | Permits boot with stub moderation vendors (api.md §4.3 boot guard) | CONFIG | boolean | hoodpad-indexer + security | `true` | `true` | `false` (unless capped-beta escape, logged) |
| `MODERATION_NSFW_HIDE_THRESHOLD` | Classifier score ≥ this ⇒ auto-hide (default `0.95`) | CONFIG | api.md §4.3 default | hoodpad-indexer + security | unset | unset | tuned pre-beta |
| `MODERATION_NSFW_REVIEW_THRESHOLD` | Classifier score ≥ this ⇒ review queue (default `0.8`) | CONFIG | api.md §4.3 default | hoodpad-indexer + security | unset | unset | tuned pre-beta |
| `MODERATION_CSAM_VENDOR_*` <!-- sync:skip --> | CSAM hash-match vendor credentials (PhotoDNA/IWF-class) — **reserved; not yet read by code** (stub vendors until OI-A7) | SECRET | **§13 OI-A7** vendor (**NEEDS-USER**) | architect + ops | unset (stub) | unset (stub) | vendor keys (OI-A7) |
| `MODERATION_CLASSIFIER_VENDOR_*` <!-- sync:skip --> | NSFW/violence classifier credentials — **reserved; not yet read by code** | SECRET | **§13 OI-A7** vendor (**NEEDS-USER**) | architect + ops | unset (stub) | unset (stub) | vendor keys (OI-A7) |
| `R2_ENDPOINT` | S3 endpoint for R2/minio (`Bun.S3Client`); R2 form `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` with account `0b1b0b8753489a11d35ee922961f6b72` (§12.45) | CONFIG | Cloudflare R2 / minio | hoodpad-indexer | minio endpoint | R2 endpoint | R2 endpoint |
| `R2_REGION` | S3 region (default `auto`) | CONFIG | fixed default | hoodpad-indexer | `auto` | `auto` | `auto` |
| `R2_ACCESS_KEY_ID` | R2 write access key (API-mediated upload §12.19) | SECRET | Cloudflare R2 API token | ops | minio key | R2 token | R2 token |
| `R2_SECRET_ACCESS_KEY` | R2 write secret | SECRET | Cloudflare R2 API token | ops | minio secret | R2 secret | R2 secret |
| `R2_BUCKET` | Target bucket for images + metadata | CONFIG | `robbed-assets` (§12.45) | hoodpad-indexer | `robbed-assets` (minio) | `robbed-assets` | `robbed-assets` |
| `R2_PUBLIC_BASE_URL` | Public CDN base; metadata `imageUrl` MUST start with this (api.md §6.4 SSRF/XSS) | CONFIG | R2 public/CDN domain | hoodpad-indexer | minio public URL | R2 CDN | R2 CDN base |
| `ROBINHOOD_RPC_URL` | RPC for the cold `tokensOwed` read on `/fees` (api.md §3.4) — never in the hot path | CONFIG | provider | hoodpad-indexer | local anvil | testnet RPC | 4663 RPC |
| `TREASURY_ADDRESS` | Treasury Safe → holder `vault` flag (api.md §3.4) | CONFIG | O-6 Safe (**NEEDS-USER**) | architect + ops | unset | testnet Safe | O-6 Safe |
| `LP_FEE_VAULT_ADDRESS` | LPFeeVault → holder `vault` flag | CONFIG | M1 deploy artifact | hoodpad-contracts | local | testnet | mainnet |
| `LARGE_VALUE_ETH_THRESHOLD` | API mirror of the §2.1 large-value confirmation-disclosure threshold (decimal ETH string) | CONFIG | **§12.47 (web-10) — DECIDED:** `1.0` ETH default; mirrors web `NEXT_PUBLIC_LARGE_VALUE_ETH_THRESHOLD` (key added to `apps/api/src/config.ts` 2026-07-11, M3-10) | architect (value) / hoodpad-indexer (wire) | `1.0` | `1.0` | `1.0` (config, never a literal) |
| `RANK_TICKER_BOOST` | §12.22 search ranking: exact-ticker match boost multiplier (tunable config, never a code literal) | CONFIG | `apps/api/src/config/ranking.ts` default `1.2` (§12.22 formulas-as-config) | hoodpad-indexer | `1.2` | `1.2` | `1.2` |
| `RANK_SIMILARITY_FLOOR` | §12.22 search ranking: pg_trgm similarity floor below which candidates are dropped | CONFIG | ranking.ts default `0.25` | hoodpad-indexer | `0.25` | `0.25` | `0.25` |
| `SEARCH_STATEMENT_TIMEOUT_MS` | Per-statement Postgres timeout on the search path (api.md §6 search-DoS guard) | CONFIG | ranking.ts default `2000` | hoodpad-indexer | `2000` | `2000` | `2000` |
| `RANK_TRENDING_HALFLIFE_HOURS` | §12.22 trending sort: exponential-decay half-life | CONFIG | ranking.ts default `24` | hoodpad-indexer | `24` | `24` | `24` |
| `CORS_ALLOWED_ORIGINS` <!-- sync:skip --> | Allowed browser origins (the Workers web origin) — **planned; NOT yet read by code** (no CORS middleware in `apps/api/src` as of 2026-07-11). Wiring routed to **robbed-indexer**; until then CORS must be enforced at the reverse-proxy/CDN layer (deploy.md §3.1) | CONFIG | web deploy domain | hoodpad-indexer | `http://localhost:3000` | testnet web origin | `https://robbed.fun` |

Note: the API's R2 credentials are the **write** leg (uploads, §12.19) and are distinct from the Workers R2 *binding* (read leg, §3 below). The v1.0 `R2_ACCOUNT_ID` row is folded into `R2_ENDPOINT` (code reads the endpoint, not the account id; the account id remains a deploy-level fact, §5).

---

## 3. Web (`apps/web` — Next.js 16 on Cloudflare Workers)

Source: web.md §2.3/§9.6, `.env.example`, deploy-komodo-cloudflare.md B.2. **`NEXT_PUBLIC_*` are inlined by Next at BUILD time**, so on Cloudflare Workers they are **Workers-Builds build variables**, not runtime secrets (a missing var does not crash the build; the app is only functional once they point at the live Komodo Stack). **Do not put secrets in `NEXT_PUBLIC_*`** — everything here is public-by-design (shipped to the browser).

> The Workers adaptation has **landed** (v1.0's "in-flight" note is obsolete) — `apps/web/.env.example` is the per-app mirror this table is synced against; the root `.env.example` "apps/web BUILD VARS" block duplicates it for the workspace template.

<!-- env-sync file=apps/web/.env.example -->

| Var | Purpose | Secret? | Source | Owner | dev | testnet | prod |
|---|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_RPC_HTTP` | Chain 4663 HTTP RPC (viem transport) — **required** | PUBLIC | provider (public read RPC) | hoodpad-frontend | `http://localhost:8545` | testnet HTTP RPC | 4663 public HTTP RPC |
| `NEXT_PUBLIC_RPC_WS` | Chain 4663 WS RPC (optional live subs) | PUBLIC | provider | hoodpad-frontend | `ws://localhost:8545` | testnet WS | 4663 WS RPC |
| `NEXT_PUBLIC_API_BASE_URL` | Indexer/API REST base, no trailing slash — **required** | PUBLIC | Komodo Stack public endpoint (A.6) | hoodpad-frontend | `http://localhost:3001` | testnet API URL | `https://api.<domain>` |
| `NEXT_PUBLIC_WS_URL` | Bun WS fanout URL — **required** | PUBLIC | Komodo Stack public WS endpoint | hoodpad-frontend | `ws://localhost:3002/v1/ws` | testnet WS URL | `wss://ws.<domain>/v1/ws` |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect projectId (web-6 §13) — optional; WC + Robinhood Wallet connectors hidden if unset | PUBLIC | **§13 web-6** cloud.walletconnect.com (**NEEDS-USER**) | hoodpad-frontend | unset (injected wallets only) | project id | project id (NEEDS-USER) |
| `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` | R2 public CDN base for token images (`next/image` remote host) | PUBLIC | R2 public/CDN domain (`robbed-assets`) | hoodpad-frontend | minio public URL | R2 CDN | R2 CDN base |
| `NEXT_PUBLIC_LARGE_VALUE_ETH_THRESHOLD` | ETH notional above which posted/finalized confirmation disclosure is surfaced (§2.1) | PUBLIC | **§12.47 (web-10) — DECIDED:** `1.0` ETH default (see §12.47; retunable in capped beta) | architect (value) / hoodpad-frontend (wire) | `1.0` | `1.0` | `1.0` (config, never a literal) |
| `NEXT_PUBLIC_MOCK_DATA` | Demo mode: data layer serves the bundled mock JSON instead of the API (strictly gated; unset ⇒ live) | PUBLIC | dev toggle | hoodpad-frontend | optional `true` | unset | **unset — never in prod** |
| `NEXT_PUBLIC_E2E` | E2E harness: wagmi mock connector (anvil accounts) + `window.__ROBBED_E2E__` (plan I-5a) | PUBLIC | test toggle | hoodpad-frontend | e2e runs only | unset | **unset — never in prod** |
| `NEXT_PUBLIC_E2E_ACCOUNTS` | Comma-separated anvil addresses for the mock connector (creator,treasury,trader,trader2) | PUBLIC | anvil dev accounts | hoodpad-frontend | e2e runs only | unset | unset |
| `NEXT_PUBLIC_E2E_*` <!-- sync:skip --> | E2E-harness address overrides (`…_CURVE_FACTORY`/`…_ROUTER`/`…_MIGRATOR`/`…_LP_FEE_VAULT`/`…_TREASURY`) — set by the e2e runner from local deploy artifacts, deliberately not in `.env.example` | PUBLIC | local deploy artifacts | hoodpad-frontend | e2e runs only | unset | unset |

### 3a. Cloudflare Workers bindings (not `NEXT_PUBLIC_*`)

Set in `apps/web/wrangler.jsonc` (deploy-komodo-cloudflare.md B.2), not `.env`:

| Binding | Purpose | Source | Owner |
|---|---|---|---|
| `ASSETS_R2` (R2 bucket) | Frontend **read** access to `robbed-assets` (SSR/OG metadata+image reads). The write leg stays on the API (§12.19) — the Worker never accepts raw uploads | Cloudflare R2 `robbed-assets`, account `0b1b0b…f6b72` | hoodpad-frontend |
| `ASSETS` (static assets) | OpenNext static assets directory `.open-next/assets` | build output | hoodpad-frontend |

---

## 4. NEEDS-USER / §13 dependencies (env values blocked on human decisions)

| Var(s) | §13 item | Blocks | Placeholder until decided |
|---|---|---|---|
| `ADMIN_ALLOWLIST` | O-6 / OI-A8 (Safe signer set) | prod admin auth | dev signer addresses (testnet OK) |
| `MODERATION_CSAM_VENDOR_*`, `MODERATION_CLASSIFIER_VENDOR_*` | OI-A7 (moderation vendor + mandated-reporting flow) | prod moderation | stub vendors + `MODERATION_ALLOW_STUBS=true` (dev/testnet) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | web-6 | WC/Robinhood Wallet connectors | unset (injected wallets work) |
| ~~`ETH_USD_SOURCE_URL` (Chainlink vs fallback selection)~~ | OI-6 — **RESOLVED (§12.51, 2026-07-11):** Chainlink confirmed on 4663; `CHAINLINK_ETH_USD_FEED` default recorded, `ETH_USD_SOURCE_URL` is the HTTP fallback (§1 above) | ~~prod price source choice~~ resolved | DefiLlama/Coinbase HTTP stays the LOCAL/TESTNET source |
| ~~`L1_RPC_URL` + rollup addresses~~ | OI-8 (§12.48b) — **RESOLVED (verified 2026-07-11):** `safe`/`finalized` tags SUPPORTED on the official 4663 RPC; §1a is dormant, vars not provisioned | ~~confirmation source~~ resolved | N/A (dormant fallback design retained in §1a) |
| testnet faucet URL | §13 Robinhood testnet params — chain id/RPC/WS/explorer **RESOLVED (§12.49)**; faucet still open (Phase T) | testnet deploy | pull from official Robinhood docs at Phase-T start; deploy fails if unset |

---

## 5. Dev/test tooling vars (documentation only — no per-app `.env.example`, not CI-sync-checked)

Read by `tools/`, `contracts/script`, `scripts/`, and the Playwright runner (grep-verified 2026-07-11). Never set in prod services.

| Var | Purpose | Secret? | Read by | Owner |
|---|---|---|---|---|
| `ROBINHOOD_RPC_URL` | Live-chain RPC for fork tests (`FOUNDRY_PROFILE=fork`), `Deploy.s.sol`, and the localstack fork branch | SECRET (if keyed) | `contracts/script`, `contracts/test`, `tools/localstack` | hoodpad-contracts |
| `ROBINHOOD_WS_RPC_URL` | WS counterpart in the root template | SECRET (if keyed) | root `.env.example` template | hoodpad-contracts |
| `DEPLOYER_PRIVATE_KEY` | Deploy key for `Deploy.s.sol` (`vm.envOr` — anvil default key when unset) | **SECRET** | `contracts/script` | hoodpad-contracts + ops |
| `ROBBED_CONSTANTS` | Override path to `constants.json` for `Deploy.s.sol` | CONFIG | `contracts/script` | hoodpad-contracts |
| `R2_ACCOUNT_ID` | Cloudflare account id `0b1b0b8753489a11d35ee922961f6b72` (§12.45) — deploy-level fact used to derive `R2_ENDPOINT`; not read by app code | CONFIG | root `.env.example` template, deploy docs | ops |
| `ANVIL_PORT` | Local-stack anvil port (default `4545`; `validate.sh` e2e reachability probe) | CONFIG | `tools/localstack`, `scripts/validate.sh` | hoodpad-contracts |
| `API_PORT` | Local-stack API port override (same key the API itself reads, §2) | CONFIG | `tools/localstack` | hoodpad-indexer |
| `DEV_STACK_TIMEOUT_SECS` | Local-stack health-wait budget | CONFIG | `tools/localstack` | hoodpad-indexer |
| `SEED_RPC_URL` / `SEED_API_URL` | Targets for the chain/data seed script | CONFIG | `tools/localstack/seed-chain.ts` | hoodpad-indexer |
| `E2E_BASE_URL` / `E2E_WEB_URL` / `E2E_API_URL` / `E2E_WS_URL` / `E2E_RPC_URL` / `E2E_MISMATCH_TOKEN` | Playwright run targets + fixtures (plan I-5a) | CONFIG | `apps/web/e2e` runner | hoodpad-frontend |

The root `.env.example` is the **workspace template** (dev aggregator). Every key it contains must be documented somewhere in this inventory (direction-1 union check):

<!-- env-sync-root file=.env.example -->
