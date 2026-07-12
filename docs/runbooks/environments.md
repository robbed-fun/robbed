# Runbook — Three-Environment Model (LOCAL / TESTNET / MAINNET)

**Status:** v1.0, 2026-07-10. Authored by robbed-architect. Implements the 3-environment decision ratified in **spec §12.49** (user-directed). This runbook is the **per-env config matrix** — the source of truth for which endpoints, chain ids, addresses, domains, and env-vars each environment uses. It is docs/spec only; no code is authored here. Wiring is routed to owners (§5).

Cross-references:
- **`docs/runbooks/env-inventory.md`** — the authoritative per-*variable* table (dev/testnet/prod columns). This runbook maps those columns onto the named environments; env-inventory.md owns each variable's secret-class/source/owner.
- **Hosting (spec §12.45)** — backend on the compose stacks (`docker.md`, `deploy.md` §3) fronted by Cloudflare Tunnels; frontend on Cloudflare Workers via OpenNext. (The former Komodo runbook is retired, 2026-07-12.) This runbook adds the *per-env* layer on top.
- **spec §12.49** (decision), **§14** (Phase A / Gate G-A / Phase B), **§2** (never hardcode chain facts), **§12.45** (hosting split), **§12.29** (pnpm workspaces).

> **Docs-first rule (mandatory every iteration).** Before changing any endpoint/chain fact/config convention here, consult current official docs — never work from memory. Primary: context7 MCP (`resolve-library-id` → `get-library-docs`); fallback: WebFetch of the canonical pages below. Docs beat assumptions; the spec beats docs (flag the conflict, do not silently diverge).
>
> Canonical docs for this runbook:
> - Robinhood Chain network details — https://docs.robinhood.com/chain/connecting (chain ids, RPC/WS, explorers, Alchemy format — the source of every chain fact below)
> - Cloudflare Wrangler environments — https://developers.cloudflare.com/workers/wrangler/environments/ · Wrangler config: https://developers.cloudflare.com/workers/wrangler/configuration/ · custom domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
> - Cloudflare DNS (zone/nameservers) — https://developers.cloudflare.com/dns/zone-setups/full-setup/ · https://developers.cloudflare.com/dns/nameservers/
> - OpenNext Cloudflare adapter — https://opennext.js.org/cloudflare
> - Ponder env — https://ponder.sh · Foundry/anvil — https://book.getfoundry.sh/reference/anvil/
>
> Chain facts below were verified docs-first on 2026-07-10 against `docs.robinhood.com/chain/connecting`. Robinhood notes public endpoints are rate-limited and **not recommended for production** — Alchemy is the recommended provider for TESTNET/MAINNET load.

## 0. Hard boundaries (do not violate)

- **§2 — never hardcode chain facts in source.** Chain id, RPC, WS, explorer, addresses, thresholds are **env/config**, never code literals. The one exception is deliberate: chain id and canonical WETH are compile-time **constants in `@robbed/shared`** that are **asserted against the live RPC at startup** (env-inventory.md §Conventions) — asserted, not configured, so a wrong RPC fails closed.
- **Mainnet is Gate-G-A-gated (§14).** MAINNET config exists in this matrix, but nothing deploys to `4663` / `robbed.fun` until Gate G-A passes (market + competition + personal + **legal wrapper**, §13, blocking at G-A). Phase A ships TESTNET only; no fees collected pre-G-A.
- **Sells-always-open / no-pause / in-contract-fee / LP-copy** invariants are chain-agnostic — identical on all three envs; this runbook changes only *where* processes point, never contract logic.
- **Bun stays the runtime/test runner; pnpm workspaces for deps** (§8/§9, §12.29) on every env.

---

## 1. The three environments

### LOCAL — dev / test / e2e (Phase I)

- **Chain:** local **anvil**, optionally a **mainnet-fork** (`anvil --fork-url <4663 RPC>`) for fork tests (Foundry fork suite, Playwright e2e-on-fork, §9). Chain id: anvil default for pure-local; the fork keeps 4663 for realistic reads.
- **Credentials: ZERO.** No provider keys, no R2 keys, no admin secrets. This is the only env any agent runs without secrets. Moderation runs on stub vendors (`MODERATION_ALLOW_STUBS=true`).
- **Contracts:** **fresh-deployed locally** by the M1 broadcast onto anvil. **V3 + WETH are mock or forked**, NOT the 4663 constants — on pure anvil a local V3 core deploy + `MockWETH9`; on a fork, the real 4663 addresses come through the fork. The §12.28 Uniswap/§CLAUDE WETH constants apply to **4663 mainnet only**.
- **Endpoints:** RPC `http://localhost:8545`, WS `ws://localhost:8545`; API `http://localhost:3001`, WS fanout `ws://localhost:3002/v1/ws`; Postgres/Redis local (`docker.md` / root compose); R2 → MinIO/localstack (`tools/localstack`). Web via `next dev` or OpenNext `workerd` preview (`opennextjs-cloudflare preview`).
- **Domain:** none (`localhost`).
- **Backend host:** the local docker-compose stack (`docs/runbooks/docker.md`), not Komodo.

### TESTNET — Robinhood testnet (Phase T = §14 Phase A)

- **Chain id:** `46630`.
- **RPC:** public `https://rpc.testnet.chain.robinhood.com` (rate-limited); **recommended** Alchemy `https://robinhood-testnet.g.alchemy.com/v2/{KEY}`.
- **WS:** public `wss://feed.testnet.chain.robinhood.com`; Alchemy `wss://robinhood-testnet.g.alchemy.com/v2/{KEY}`.
- **Explorer / verifier:** `explorer.testnet.chain.robinhood.com` (Blockscout — contracts verified here at Phase-T deploy; the O-5 `0.8.35` + `cancun` verifier check, §12.44, runs against this explorer).
- **Domain:** **`testnet.robbed.fun`** (subdomain of the `robbed.fun` Cloudflare zone).
- **Contracts:** the Phase-T deploy broadcast → `tools/deployments/testnet.json` → addresses codegen (§4). V3/WETH addresses come from the **testnet deploy artifact** (do not assume the 4663 mainnet constants exist on testnet — assert at startup, fail closed if unset).
- **Faucet:** URL still **OPEN** (§13) — pull from official Robinhood docs at Phase-T deploy start; deploy fails if unset. Owner: robbed-contracts.
- **Backend host:** Komodo Stack (a testnet Stack or the `testnet` deploy of the Stack); frontend: Cloudflare Worker `robbed-testnet` (§3).
- **Legal/fees:** none in Phase A (§14) — testnet-only, no fees collected, no legal wrapper required until G-A.

### MAINNET — Robinhood mainnet (Phase B, Gate-G-A-gated)

- **Chain id:** `4663`.
- **RPC:** public `https://rpc.mainnet.chain.robinhood.com` (rate-limited); **recommended** Alchemy `https://robinhood-mainnet.g.alchemy.com/v2/{KEY}`.
- **WS:** public `wss://feed.mainnet.chain.robinhood.com`; Alchemy `wss://robinhood-mainnet.g.alchemy.com/v2/{KEY}`.
- **Explorer / verifier:** `robinhoodchain.blockscout.com`.
- **Domain:** **`robbed.fun`**.
- **Contracts:** Phase-B deploy → `tools/deployments/mainnet.json` → codegen. V3/WETH = the **§12.28 / CLAUDE.md 4663 constants** (Factory `0x1f7d…2EfA`, NPM `0x7399…E0D3`, SwapRouter02 `0xcaf6…5cb2`, QuoterV2 `0x33e8…a9e7`, WETH `0x0Bd7…AD73`), still asserted at deploy (`feeAmountTickSpacing(10000)==200`, `NPM.factory()`/`NPM.WETH9()`).
- **Gating:** entered only after **Gate G-A** passes (§14). Treasury = canonical Gnosis Safe on 4663 (O-6, §13, NEEDS-USER signer set). Legal wrapper blocking at G-A.
- **Backend host:** Komodo Stack (`production`); frontend: Cloudflare Worker `robbed` / `robbed-production` (§3).

---

## 2. Config matrix (per variable × env)

This maps `env-inventory.md`'s dev/testnet/prod columns onto the three envs. `env-inventory.md` remains authoritative for each variable's secret-class, source, and owner; the values below are the env-specific resolutions. **`SECRET` never committed** (Komodo secret store / Workers secret); **`CONFIG`/`PUBLIC`** environment-specific.

### 2a. Indexer (`apps/indexer` — Ponder, Komodo Stack) — env-inventory.md §1

| Var | LOCAL | TESTNET | MAINNET |
|---|---|---|---|
| `INDEXER_RPC_WS` | `ws://localhost:8545` | `wss://feed.testnet.chain.robinhood.com` or Alchemy WS (SECRET) | `wss://feed.mainnet.chain.robinhood.com` or Alchemy WS (SECRET) |
| `INDEXER_RPC_HTTP` | `http://localhost:8545` | `https://rpc.testnet.chain.robinhood.com` or Alchemy (SECRET) | `https://rpc.mainnet.chain.robinhood.com` or Alchemy (SECRET) |
| `CURVE_FACTORY_ADDRESS`, `ROUTER_ADDRESS` | local deploy artifact | `tools/deployments/testnet.json` | `tools/deployments/mainnet.json` |
| `V3_FACTORY_ADDRESS`, `V3_NPM_ADDRESS` | local V3 core deploy (or fork) | testnet artifact | §12.28 4663 constants |
| `WETH_ADDRESS` | `MockWETH9` (or fork) | testnet artifact | `0x0Bd7…AD73` (assert == constant) |
| `START_BLOCK` | `0` | testnet factory-deploy block | mainnet factory-deploy block |
| `DATABASE_URL`, `REDIS_URL` | local compose | Stack-internal (Komodo) | Stack-internal (Komodo) |
| `ETH_USD_SOURCE_URL` | DefiLlama/Coinbase HTTP | config-driven (§12.48a: Chainlink-on-4663-if-present else DefiLlama/Coinbase; env-gated verify at M2 start) | same, env-gated verify |
| `R2_METADATA_BASE_URL` | MinIO public URL | R2 public base (`robbed-assets`) | R2 public base |
| `METRICS_PORT` | `9464` | `9464` | `9464` |
| `L1_RPC_URL` + rollup/inbox addrs (§1a) | n/a | only if OI-8 tags unsupported (§12.48b) | only if OI-8 tags unsupported |

### 2b. API + WS (`apps/api` — Bun, Komodo Stack) — env-inventory.md §2

| Var | LOCAL | TESTNET | MAINNET |
|---|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | local compose | Stack-internal | Stack-internal (distinct roles) |
| `PORT` / `WS_PORT` | `3001` / `3002` | `3001` / `3002` (behind TLS/CDN) | `3001` / `3002` (behind TLS/CDN) |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | `https://testnet.robbed.fun` | `https://robbed.fun` |
| `SESSION_SECRET` | dev random | rotated secret | rotated secret |
| `ADMIN_ALLOWLIST` | dev signer addr | dev/testnet signer addr | O-6 Safe signer set (§13, NEEDS-USER) |
| `MODERATION_ALLOW_STUBS` | `true` | `true` | `false` (unless logged capped-beta escape) |
| `MODERATION_*_VENDOR_*` | unset (stub) | unset (stub) | OI-A7 vendor keys (§13, NEEDS-USER) |
| `R2_ACCOUNT_ID` / `R2_BUCKET` | MinIO / `robbed-assets` | `0b1b0b…f6b72` / `robbed-assets` | `0b1b0b…f6b72` / `robbed-assets` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | MinIO creds | R2 API token (SECRET) | R2 API token (SECRET) |
| `R2_PUBLIC_BASE_URL` | MinIO public URL | R2 CDN base | R2 CDN base |

### 2c. Web (`apps/web` — Next.js 16 on Cloudflare Workers) — env-inventory.md §3

`NEXT_PUBLIC_*` are inlined at **build** time → they are **Wrangler/Workers-Builds per-env build vars**, not runtime secrets, and are public-by-design (never put a secret in `NEXT_PUBLIC_*`).

| Var | LOCAL | TESTNET | MAINNET |
|---|---|---|---|
| `NEXT_PUBLIC_RPC_HTTP` | `http://localhost:8545` | `https://rpc.testnet.chain.robinhood.com` (or Alchemy) | `https://rpc.mainnet.chain.robinhood.com` (or Alchemy) |
| `NEXT_PUBLIC_RPC_WS` | `ws://localhost:8545` | `wss://feed.testnet.chain.robinhood.com` | `wss://feed.mainnet.chain.robinhood.com` |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3001` | `https://api-testnet.robbed.fun` (testnet Stack endpoint) | `https://api.robbed.fun` (Stack endpoint) |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:3002/v1/ws` | `wss://ws.testnet.robbed.fun/v1/ws` | `wss://ws.robbed.fun/v1/ws` |
| `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` | MinIO public URL | R2 CDN base | R2 CDN base |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | unset (injected wallets only) | project id (web-6, §13) | project id (web-6, NEEDS-USER) |
| `NEXT_PUBLIC_LARGE_VALUE_ETH_THRESHOLD` | `1.0` | `1.0` | `1.0` (§12.47 config, retunable in beta) |

> The `api.*` / `ws.*` subdomain shapes above are **proposals** — the concrete public endpoints are whatever the Komodo Stack exposes (deploy-komodo-cloudflare.md A.6 step 6). Whether TESTNET/MAINNET APIs live under `robbed.fun` subdomains or separate hostnames is a robbed-indexer ops call at Phase-T/Phase-B deploy; the constraint is only that `CORS_ALLOWED_ORIGINS` and these three `NEXT_PUBLIC_*` agree per env.

### 2d. Chain constants (NOT env vars) — asserted, not configured

`chainId` (`46630` testnet / `4663` mainnet / anvil local) and canonical `WETH` are `@robbed/shared` constants asserted against the connected RPC at startup (env-inventory.md §Conventions). A mismatch (e.g. web pointed at the wrong RPC for its build-time chain) must fail closed, not silently run cross-chain.

---

## 3. Cloudflare Workers — per-env strategy

**Decision (docs-first, `developers.cloudflare.com/workers/wrangler/environments`):** one Worker codebase, **Wrangler named environments**, not separate repos/Workers-by-hand.

- **Named environments** in `apps/web/wrangler.jsonc`: `env.testnet` and `env.production` (LOCAL uses `wrangler dev` / OpenNext preview — no deploy, no env block needed). Cloudflare deploys each as `<top-level-name>-<env>` → **`robbed-testnet`** and **`robbed-production`** (top-level `name` stays `robbed`; the bare `robbed` Worker is used only if you deploy with no `--env`, which we avoid for clarity — always deploy with an explicit `--env`).
- **Non-inheritable per env (must be repeated in each `env.*` block):** `vars`, secrets, and **bindings**. So the `ASSETS_R2` R2 binding (`robbed-assets`), `ASSETS` static binding, and the per-env `NEXT_PUBLIC_*` build vars are declared **under each** `env.testnet` / `env.production` — they do **not** inherit from top-level. `routes`/custom domains are per-env (below).
- **Deploy per env** via the OpenNext pipeline with an explicit target:
  - `opennextjs-cloudflare build && wrangler deploy --env testnet` → `robbed-testnet`
  - `opennextjs-cloudflare build && wrangler deploy --env production` → `robbed-production`
  - (or set `CLOUDFLARE_ENV`; `--env` wins over it). Wrap these as `deploy:testnet` / `deploy:production` scripts (robbed-frontend, at Workers adaptation).
- **`compatibility_flags = ["nodejs_compat"]` + a recent `compatibility_date`** apply to every env (OpenNext SSR on workerd, deploy-komodo-cloudflare.md B.2) — these are inheritable, set once at top level.
- **Custom domains** (Cloudflare Workers custom domains, per-env): `testnet.robbed.fun` → `robbed-testnet`; `robbed.fun` → `robbed-production`. Both live in the **single `robbed.fun` Cloudflare zone** (testnet is a subdomain). **These attach only after the DNS prerequisite (§4) is met.** Until then, use the auto-assigned `*.workers.dev` names (`robbed-testnet.<subdomain>.workers.dev`, etc.) for interim testing.

> **Alternative considered and rejected:** two entirely separate Workers/projects. Rejected because named environments keep one codebase, one build, one `wrangler.jsonc` diff surface, and Cloudflare's own `<name>-<env>` convention — matching the anti-drift discipline (no duplicated config). Separate Workers would duplicate every binding by hand.

---

## 4. DNS prerequisite (BLOCKING for custom domains)

**`robbed.fun` is registered but NOT yet on Cloudflare DNS.** Cloudflare Worker **custom domains** require the domain's zone to be active in *this* Cloudflare account. Ordered steps (owner: ops/user — this is a §13 open item, the "domain" leg):

1. **Add `robbed.fun` as a zone** in the Cloudflare account `0b1b0b8753489a11d35ee922961f6b72` (§12.45) — Full setup (Cloudflare-hosted DNS).
2. **Point the registrar's nameservers** to the two Cloudflare-assigned nameservers; wait for the zone to go **Active**.
3. Once active, attach Worker custom domains: `testnet.robbed.fun` → `robbed-testnet`, `robbed.fun` → `robbed-production` (Cloudflare auto-provisions the edge cert and the proxied DNS record for a Workers custom domain). `testnet.robbed.fun` needs **no separate zone** — it is a subdomain record in the `robbed.fun` zone.
4. Point the API/WS public hostnames (whatever the Komodo Stack exposes, §2c note) at the Stack via DNS records in the same zone, behind TLS/CDN.

**Until step 2 completes:** every Worker is reachable on its `*.workers.dev` name; `NEXT_PUBLIC_API_BASE_URL`/`NEXT_PUBLIC_WS_URL` may temporarily use the Stack's raw public endpoint. No LOCAL or `*.workers.dev` testing is blocked by DNS — only the branded custom domains are.

---

## 5. Implementation follow-ups (routed to owners — NOT done in this runbook)

This runbook is docs/spec only. The concrete wiring below is routed; each owner consults docs-first before implementing.

| # | Task | Owner | Notes |
|---|---|---|---|
| E-1 | Per-env `.env` files: `.env.local` (LOCAL, committed-safe defaults, zero secrets), `.env.testnet`, `.env.production` (secrets → Komodo/Workers stores, never committed); keep `.env.example` ⇄ `env-inventory.md` in sync (G-9 CI check). | robbed-shared (workspace/env owner) + robbed-frontend (web vars) | Do NOT commit secrets. LOCAL file is the only fully-committable one. |
| E-2 | `apps/web/wrangler.jsonc` gains `env.testnet` + `env.production` blocks (non-inheritable `vars`/bindings repeated per env per §3); `deploy:testnet` / `deploy:production` scripts. | robbed-frontend (executed after `apps/web` redesign lands) + robbed-shared (workspace scripts) | Follows deploy-komodo-cloudflare.md Part B; adds the per-env layer. |
| E-3 | Per-env addresses codegen: deploy broadcasts → `tools/deployments/{testnet,mainnet}.json`; codegen emits `@robbed/shared` `addresses.ts` per env (LOCAL from the local broadcast). | robbed-contracts (deploy artifacts) + robbed-shared (codegen in `packages/shared`) | Extends the §12.38/M1-14 codegen. `packages/*` owned by robbed-shared. |
| E-4 | Per-env indexer/API config: `INDEXER_RPC_*`, `START_BLOCK`, `ETH_USD_SOURCE_URL`, `CORS_ALLOWED_ORIGINS`, R2 bases resolved per env; Komodo Stack `testnet`/`production` variants (or one Stack, per-env secret sets). | robbed-indexer (owns indexer/api infra + root compose, P-9) | Komodo secret store per env; §12.48a/b env-gated checks run at Phase-T/M2 start against the live RPC. |
| E-5 | DNS: add `robbed.fun` zone to the Cloudflare account, point nameservers, attach Worker custom domains (§4). | ops / user (§13 domain open item) | BLOCKING for branded domains; `*.workers.dev` until done. |
| E-6 | Testnet faucet URL (§13 still-open leg) pulled from official Robinhood docs at Phase-T deploy start; deploy fails if unset. | robbed-contracts | Never invented. |

---

## 6. Definition of done (for this runbook)

- Every env's chain id / RPC / WS / explorer / domain is sourced from official Robinhood docs (§1), never invented, and lives in config not source (§2).
- The config matrix (§2) resolves every `env-inventory.md` variable for all three envs without contradiction.
- The Workers per-env strategy (§3) and DNS prerequisite (§4) are unambiguous and docs-backed.
- All implementation is **routed, not performed** (§5) — this file authors no code.
