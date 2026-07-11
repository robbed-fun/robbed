# Runbook — Environment Variable Inventory (all services)

**Status:** v1.0, 2026-07-10. Authored by hoodpad-architect (implementation-plan **P-1**). Inputs: indexer.md §2, api.md §2/§4/§5, web.md §2.3/§9.6, `.env.example`, deploy-komodo-cloudflare.md A.3/B.2.

This is the **authoritative per-variable table** for every service. It is the source `.env.example` and the Komodo/Workers secret stores are populated from.

> **`.env.example` sync is PENDING.** A Workers-adaptation agent is actively editing `apps/web/**`, `docs/services/web.md` §2.3, and `.env.example`. This inventory does **not** edit `.env.example`; where a variable below is not yet present or is worded differently in `.env.example`, the sync to this table lands with that in-flight Workers change (do not diverge — this table is the target). The G-9 CI check that asserts `.env.example` ⇄ this inventory is enabled after the Workers change merges.

> **Docs-first rule.** Before changing any endpoint/credential convention, consult current official docs (context7 MCP → fallback WebFetch): Ponder env (https://ponder.sh), Cloudflare Workers build vars (https://developers.cloudflare.com/workers/configuration/environment-variables/), Wrangler config (https://developers.cloudflare.com/workers/wrangler/configuration/), Komodo secrets (https://komo.do/docs). Docs beat assumptions; the spec beats docs (flag the conflict).

## Conventions

- **Secret?** — `SECRET` = never committed, lives in the Komodo secret store or Workers secret; `PUBLIC` = safe to commit / inline; `CONFIG` = non-secret but environment-specific (endpoints, addresses, feature values).
- **Source** — where the value comes from (deploy artifact, provider console, §13 decision, constant).
- **Owner** — the agent/role that furnishes/rotates the value.
- **Never hardcode market metrics (§2).** Any price/threshold value is a config var with a documented source+timestamp, never a literal in code.
- **Chain id 4663 is NOT an env var** anywhere — it is a compile-time constant in `@robbed/shared` (`constants.ts`), asserted against the RPC at startup (indexer.md §2). WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` is likewise a constant, asserted not configured.

---

## 1. Indexer (`apps/indexer` — Node/Ponder container, Komodo Stack)

Source: indexer.md §2. Runs in the Komodo Stack (deploy-komodo-cloudflare.md Part A); secrets are Komodo-managed.

| Var | Purpose | Secret? | Source | Owner | dev | testnet | prod |
|---|---|---|---|---|---|---|---|
| `INDEXER_RPC_WS` | Alchemy WS RPC for chain 4663 (realtime sync) | SECRET | Alchemy console / Robinhood provider | hoodpad-indexer | local anvil WS `ws://localhost:8545` | Robinhood testnet WS (§13, Phase T) | provider WS URL (with key) |
| `INDEXER_RPC_HTTP` | HTTP fallback + historical backfill | SECRET | same provider | hoodpad-indexer | `http://localhost:8545` | testnet HTTP RPC | provider HTTP URL (with key) |
| `CURVE_FACTORY_ADDRESS` | Factory address (event source) | CONFIG | M1 deploy artifact → `packages/shared/src/addresses.ts` | hoodpad-contracts (deploy) | local deploy | testnet deploy | mainnet deploy |
| `ROUTER_ADDRESS` | Router address (event source) | CONFIG | M1 deploy artifact | hoodpad-contracts | local | testnet | mainnet |
| `V3_FACTORY_ADDRESS` | Uniswap V3 factory (assert at startup) | CONFIG | **§12.28** `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` (constant on 4663; still config so startup fails-closed if unset) | hoodpad-indexer | local V3 core deploy | 4663 value | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` |
| `V3_NPM_ADDRESS` | NonfungiblePositionManager (assert) | CONFIG | **§12.28** `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` | hoodpad-indexer | local | 4663 | `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` |
| `WETH_ADDRESS` | Canonical WETH (asserted == constant, not truly configurable) | CONFIG | CLAUDE.md constant `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | hoodpad-indexer | local MockWETH9 | 4663 WETH | `0x0Bd7…AD73` |
| `REDIS_URL` | Pub/sub + WS fanout + rate-limit + moderation queue | SECRET | Komodo Redis service | hoodpad-indexer | `redis://localhost:6379` | Stack internal | Stack internal (`redis://redis:6379`) |
| `DATABASE_URL` | Postgres (`pg_trgm` required; migration asserts) | SECRET | Komodo Postgres service | hoodpad-indexer | `postgres://…@localhost:5432/robbed` | Stack internal | Stack internal, indexer-owner role |
| `R2_METADATA_BASE_URL` | CDN base for canonical metadata JSON (metadata-fetch worker) | CONFIG | Cloudflare R2 public base (`robbed-assets`) | hoodpad-indexer | minio public URL | R2 public base | R2 public base |
| `ETH_USD_SOURCE_URL` | HTTP **fallback** price source for the `eth_usd_snapshots` poller (indexer.md §3.9) — primary source on LOCAL/TESTNET; resilience fallback behind Chainlink on mainnet (§12.51) | CONFIG | **§12.51 (OI-6 closed)** — DefiLlama (`coins.llama.fi/prices/current/coingecko:ethereum`) or Coinbase (`api.coinbase.com/v2/prices/ETH-USD/spot`) | hoodpad-indexer | DefiLlama/Coinbase HTTP | same | same (fallback behind the Chainlink feed) |
| `CHAINLINK_ETH_USD_FEED` | Chainlink ETH/USD proxy for the indexer.md §3.9 poller's mainnet branch; `off` disables the branch entirely (required on a fresh local chain launched as id 4663) | CONFIG | **§12.51** — recorded default `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` (env override allowed, mirrors the §12.28 V3 pattern); branch also auto-skipped when RPC chain id ≠ 4663; fail-closed startup assertions `description()=="ETH / USD"`, `decimals()==8` | hoodpad-indexer | `off` (fresh chain) / unset (4663 fork — feed exists in fork state) | unset (46630 auto-skips) | unset (§12.51 default) |
| `ETH_USD_POLL_INTERVAL_MS` | indexer.md §3.9 poller cadence (spec band 30–60s) | CONFIG | fixed default `30000` | hoodpad-indexer | `30000` | `30000` | `30000` |
| `ETH_USD_CHAINLINK_STALENESS_SECONDS` | Reject Chainlink answers whose `updatedAt` is older than this (→ HTTP fallback); never a price literal (§2) | CONFIG | default `3600` (standard ETH/USD heartbeat; threshold ≥ heartbeat per Chainlink docs) | hoodpad-indexer | `3600` | `3600` | `3600` |
| `START_BLOCK` | Factory deploy block (backfill floor) | CONFIG | M1/testnet/mainnet deploy tx block | hoodpad-contracts | 0 | testnet deploy block | mainnet deploy block |
| `METRICS_PORT` | Prometheus-style gate-7 metrics port (indexer.md §9.4, M2-12) | CONFIG | fixed default `9464` | hoodpad-indexer | `9464` | `9464` | `9464` (scraped in-Stack) |

### 1a. OI-8 L1-watermark fallback vars (CONDITIONAL — M2-3b, only if `safe`/`finalized` tags unsupported)

Provisioned **only** if §12.48b (OI-8) finds the Robinhood RPC does not expose `safe`/`finalized` block tags. Env-gated on the live RPC check.

| Var | Purpose | Secret? | Source | Owner |
|---|---|---|---|---|
| `L1_RPC_URL` | L1 RPC to read rollup/inbox watermarks (`SequencerBatchDelivered`, finality) | SECRET | L1 provider | hoodpad-indexer |
| `L1_ROLLUP_ADDRESS` | Orbit Rollup contract on L1 | CONFIG | Robinhood/Orbit deployment (§13, from official docs) | hoodpad-indexer |
| `L1_SEQUENCER_INBOX_ADDRESS` | SequencerInbox on L1 (batch-posted watermark) | CONFIG | same | hoodpad-indexer |

---

## 2. API + WS (`apps/api` — Bun container, Komodo Stack)

Source: api.md §4.3/§5/§6, deploy-komodo-cloudflare.md A.1/A.3. Two processes from one image: `src/index.ts` (Hono HTTP) and `src/ws.ts` (Bun WS fanout).

| Var | Purpose | Secret? | Source | Owner | dev | testnet | prod |
|---|---|---|---|---|---|---|---|
| `DATABASE_URL` | Postgres: read-only role on indexer tables + read-write on `moderation_status`/`moderation_audit_log`/`impersonation_watchlist` | SECRET | Komodo Postgres (distinct roles) | hoodpad-indexer | local | Stack internal | Stack internal, API role |
| `REDIS_URL` | Subscribe `global:*`/`control:*`; moderation queue; rate-limit | SECRET | Komodo Redis | hoodpad-indexer | `redis://localhost:6379` | Stack internal | Stack internal |
| `PORT` | Hono HTTP listen port | CONFIG | fixed default | hoodpad-indexer | `3001` | `3001` | `3001` (behind TLS/CDN) |
| `WS_PORT` | Bun WS fanout listen port | CONFIG | fixed default | hoodpad-indexer | `3002` | `3002` | `3002` (behind TLS/CDN) |
| `CORS_ALLOWED_ORIGINS` | Allowed browser origins (the Workers web origin) | CONFIG | web deploy domain | hoodpad-indexer | `http://localhost:3000` | testnet web origin | `https://<robbed-web domain>` |
| `SESSION_SECRET` | Signs SIWE admin session cookie + CSRF (api.md §6.1) | SECRET | generated (32B random) | hoodpad-indexer + ops | dev random | dev random | rotated secret |
| `ADMIN_ALLOWLIST` | Comma-separated admin SIWE addresses (api.md §6.1) | CONFIG | **§13 OI-A8** — follows Safe signer set O-6 (**NEEDS-USER**) | architect + ops | dev signer addr | dev signer addr | O-6 signer set (NEEDS-USER) |
| `MODERATION_ALLOW_STUBS` | Permits boot with stub moderation vendors (api.md §4.3) | CONFIG | boolean | hoodpad-indexer + security | `true` | `true` | `false` (must be false in prod unless capped-beta escape, logged) |
| `MODERATION_CSAM_VENDOR_*` | CSAM hash-match vendor credentials (PhotoDNA/IWF-class) | SECRET | **§13 OI-A7** vendor (**NEEDS-USER**) | architect + ops | unset (stub) | unset (stub) | vendor keys (OI-A7) |
| `MODERATION_CLASSIFIER_VENDOR_*` | NSFW/violence classifier credentials | SECRET | **§13 OI-A7** vendor (**NEEDS-USER**) | architect + ops | unset (stub) | unset (stub) | vendor keys (OI-A7) |
| `R2_ACCOUNT_ID` | Cloudflare account for R2 write (API-mediated upload §12.19) | CONFIG | Cloudflare `0b1b0b8753489a11d35ee922961f6b72` (§12.45) | hoodpad-indexer | minio | R2 | `0b1b0b…f6b72` |
| `R2_ACCESS_KEY_ID` | R2 write access key | SECRET | Cloudflare R2 API token | ops | minio key | R2 token | R2 token |
| `R2_SECRET_ACCESS_KEY` | R2 write secret | SECRET | Cloudflare R2 API token | ops | minio secret | R2 secret | R2 secret |
| `R2_BUCKET` | Target bucket for images + metadata | CONFIG | `robbed-assets` (§12.45) | hoodpad-indexer | `robbed-assets` (minio) | `robbed-assets` | `robbed-assets` |
| `R2_PUBLIC_BASE_URL` | Public CDN base returned to clients / stored `imageUrl` origin | CONFIG | R2 public/CDN domain | hoodpad-indexer | minio public URL | R2 CDN | R2 CDN base |
| `LARGE_VALUE_ETH_THRESHOLD` | API mirror of the §2.1 large-value confirmation-disclosure threshold (decimal ETH string) | CONFIG | **§12.47 (web-10) — DECIDED:** `1.0` ETH default; mirrors web `NEXT_PUBLIC_LARGE_VALUE_ETH_THRESHOLD` (key added to `apps/api/src/config.ts` 2026-07-11, M3-10) | architect (value) / hoodpad-indexer (wire) | `1.0` | `1.0` | `1.0` (config, never a literal) |

Note: the API's R2 credentials are the **write** leg (uploads, §12.19) and are distinct from the Workers R2 *binding* (read leg, §3 below).

---

## 3. Web (`apps/web` — Next.js 16 on Cloudflare Workers)

Source: web.md §2.3/§9.6, `.env.example`, deploy-komodo-cloudflare.md B.2. **`NEXT_PUBLIC_*` are inlined by Next at BUILD time**, so on Cloudflare Workers they are **Workers-Builds build variables**, not runtime secrets (a missing var does not crash the build; the app is only functional once they point at the live Komodo Stack). **Do not put secrets in `NEXT_PUBLIC_*`** — everything here is public-by-design (shipped to the browser).

> `apps/web/**`, `web.md`, and `.env.example` are being edited by the in-flight Workers agent — this table is the target; treat the current `.env.example` §"apps/web BUILD VARS" block as the live mirror to keep in sync.

| Var | Purpose | Secret? | Source | Owner | dev | testnet | prod |
|---|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_RPC_HTTP` | Chain 4663 HTTP RPC (viem transport) — **required** | PUBLIC | provider (public read RPC) | hoodpad-frontend | `http://localhost:8545` | testnet HTTP RPC | 4663 public HTTP RPC |
| `NEXT_PUBLIC_RPC_WS` | Chain 4663 WS RPC (optional live subs) | PUBLIC | provider | hoodpad-frontend | `ws://localhost:8545` | testnet WS | 4663 WS RPC |
| `NEXT_PUBLIC_API_BASE_URL` | Indexer/API REST base, no trailing slash — **required** | PUBLIC | Komodo Stack public endpoint (A.6) | hoodpad-frontend | `http://localhost:3001` | testnet API URL | `https://api.<domain>` |
| `NEXT_PUBLIC_WS_URL` | Bun WS fanout URL — **required** | PUBLIC | Komodo Stack public WS endpoint | hoodpad-frontend | `ws://localhost:3002/v1/ws` | testnet WS URL | `wss://ws.<domain>/v1/ws` |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect projectId (web-6 §13) — optional; WC + Robinhood Wallet connectors hidden if unset | PUBLIC | **§13 web-6** cloud.walletconnect.com (**NEEDS-USER**) | hoodpad-frontend | unset (injected wallets only) | project id | project id (NEEDS-USER) |
| `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` | R2 public CDN base for token images (`next/image` remote host) | PUBLIC | R2 public/CDN domain (`robbed-assets`) | hoodpad-frontend | minio public URL | R2 CDN | R2 CDN base |
| `NEXT_PUBLIC_LARGE_VALUE_ETH_THRESHOLD` | ETH notional above which posted/finalized confirmation disclosure is surfaced (§2.1) | PUBLIC | **§12.47 (web-10) — DECIDED:** `1.0` ETH default (see §12.47; retunable in capped beta) | architect (value) / hoodpad-frontend (wire) | `1.0` | `1.0` | `1.0` (config, never a literal) |

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
| `L1_RPC_URL` + rollup addresses | OI-8 (§12.48b) — **conditional, env-gated (needs live 4663 RPC)** | only if `safe`/`finalized` tags unsupported | N/A unless the RPC check fails |
| testnet RPC/explorer/faucet endpoints | §13 Robinhood testnet params (Phase T) | testnet deploy | pull from official Robinhood docs; deploy fails if unset |
