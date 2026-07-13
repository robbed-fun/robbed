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

- **Chain id:** `46630`. **Network params (RPC / WS / explorer / faucet):** see `testnet.md` §1 for the canonical chain-46630 network params (retrieval-dated, incl. the 46630-vs-46646 caveat) — not restated here.
- **Domain:** **`testnet.robbed.fun`** (subdomain of the `robbed.fun` Cloudflare zone), served by the `robbed-testnet` Worker custom domain (§3, §4).
- **Contracts:** the Phase-T deploy broadcast → `contracts/deployments/46630.json` → addresses codegen (§4; the **canonical** deploy artifact — D-2, spec §12.49 annotation). V3/WETH addresses come from the **testnet deploy artifact** (do not assume the 4663 mainnet constants exist on testnet — assert at startup, fail closed if unset).
- **Backend host:** the testnet compose stack (`docker-compose.testnet.yml`, `docker.md`) fronted by its Cloudflare Tunnel; frontend: Cloudflare Worker `robbed-testnet` (§3).
- **Legal/fees:** none in Phase A (§14) — testnet-only, no fees collected, no legal wrapper required until G-A.

### MAINNET — Robinhood mainnet (Phase B, Gate-G-A-gated)

- **Chain id:** `4663`.
- **RPC:** public `https://rpc.mainnet.chain.robinhood.com` (rate-limited); **recommended** Alchemy `https://robinhood-mainnet.g.alchemy.com/v2/{KEY}`.
- **WS:** public `wss://feed.mainnet.chain.robinhood.com`; Alchemy `wss://robinhood-mainnet.g.alchemy.com/v2/{KEY}`.
- **Explorer / verifier:** `robinhoodchain.blockscout.com`.
- **Domain:** **`robbed.fun`**, served by the `robbed` Worker custom domain (§3, §4).
- **Contracts:** Phase-B deploy → `contracts/deployments/4663.json` → codegen (the **canonical** deploy artifact — D-2, spec §12.49 annotation). V3/WETH = the **§12.28 / CLAUDE.md 4663 constants** (Factory `0x1f7d…2EfA`, NPM `0x7399…E0D3`, SwapRouter02 `0xcaf6…5cb2`, QuoterV2 `0x33e8…a9e7`, WETH `0x0Bd7…AD73`), still asserted at deploy (`feeAmountTickSpacing(10000)==200`, `NPM.factory()`/`NPM.WETH9()`).
- **Gating:** entered only after **Gate G-A** passes (§14). Treasury = canonical Gnosis Safe on 4663 (O-6, §13, NEEDS-USER signer set). Legal wrapper blocking at G-A. **Interim (2026-07-12):** the mainnet compose stack and `robbed.fun` currently boot the **testnet values** (chain `46630`, real 46630 contracts) pending the Phase-B swap to `4663` (`docker-compose.mainnet.yml` / `apps/web/wrangler.jsonc` headers).
- **Backend host:** the mainnet compose stack (`docker-compose.mainnet.yml`, `docker.md`) fronted by its Cloudflare Tunnel; frontend: Cloudflare Worker `robbed` (§3).

---

## 2. Per-environment resolutions (env-defining endpoints / domains / chain-ids)

**`env-inventory.md` is authoritative per *variable*** — every var's secret-class, source, owner, and dev/testnet/prod value lives there (it is the machine-consumed table the `.env.example` files sync against, G-9). This section does **not** restate that per-variable matrix; it records only the **env-defining resolutions** — the ROBBED-owned endpoints, domains, chain-ids, and artifact paths that distinguish the three environments. For any variable's per-env value or metadata, see `env-inventory.md`. `SECRET`-class values are never committed — they live in the compose stack's host `.env` (gitignored, auto-loaded by compose) or the Workers secret store.

| Resolution | LOCAL | TESTNET | MAINNET |
|---|---|---|---|
| Chain id | anvil `31337` (or `4663` fork) | `46630` | `4663` (interim `46630`, §1) |
| Chain RPC / WS / explorer | `localhost:8545` (`docker.md`) | see `testnet.md` §1 (canonical 46630 params) | see §1 MAINNET + CLAUDE.md 4663 chain facts |
| Web domain (Worker custom domain, §3/§4) | `localhost` | `testnet.robbed.fun` | `robbed.fun` |
| Web → API base (`NEXT_PUBLIC_API_BASE_URL`) | `http://localhost:3001` | `https://api-testnet.robbed.fun` | `https://api.robbed.fun` |
| Web → WS (`NEXT_PUBLIC_WS_URL`) | `ws://localhost:3002/v1/ws` | `wss://api-testnet.robbed.fun/ws` | `wss://api.robbed.fun/ws` |
| API CORS origin (`CORS_ALLOWED_ORIGINS`) | local web origin | `https://testnet.robbed.fun` | `https://robbed.fun` |
| Contracts deploy artifact (D-2, §12.49) | local broadcast (`contracts/deployments/31337.json`) | `contracts/deployments/46630.json` | `contracts/deployments/4663.json` |
| R2 public base (`NEXT_PUBLIC_R2_PUBLIC_BASE_URL`) | MinIO public URL | R2 public base (`robbed-assets`) | R2 public base (`robbed-assets`) |

The public `api-testnet.robbed.fun` / `api.robbed.fun` hostnames (REST + `/ws` WebSocket fanout) are the **shipped** endpoints each compose stack exposes through its Cloudflare Tunnel (`tools/localstack/cloudflared/{testnet,mainnet}.yml`, §4) — no longer proposals. The only cross-cutting constraint is that a given env's `CORS_ALLOWED_ORIGINS` and its `NEXT_PUBLIC_*` (API base, WS, RPC) agree.

**Chain constants are asserted, not configured.** `chainId` (`46630` testnet / `4663` mainnet / anvil local) and canonical `WETH` are `@robbed/shared` constants asserted against the connected RPC at startup (env-inventory.md §Conventions). A mismatch (e.g. web pointed at the wrong RPC for its build-time chain) must fail closed, never silently run cross-chain.

---

## 3. Cloudflare Workers — per-target deploy model

**Shipped model (docs-first, `developers.cloudflare.com/workers/wrangler/configuration`):** one Worker codebase, **two per-target Wrangler config files** built + deployed via OpenNext (`@opennextjs/cloudflare`) — **not** `env.*` named environments in one file, and not separate repos.

- **Two config files → two Workers** (LOCAL uses `bun run preview:cf` / `next dev` — no deploy, no config file of its own):
  - `apps/web/wrangler.jsonc` — `"name": "robbed"` → the **production** Worker `robbed`; its `robbed.fun` custom domain is attached account-side.
  - `apps/web/wrangler.testnet.jsonc` — `"name": "robbed-testnet"`, `"workers_dev": true`, and `routes: [{ "pattern": "testnet.robbed.fun", "custom_domain": true }]` → the testnet Worker `robbed-testnet`.
  - The production Worker is **`robbed`** (NOT `robbed-production`); the testnet Worker is **`robbed-testnet`**.
- **Deploy per target** (scripts in `apps/web/package.json`) — each sources its `.env.<target>` build sheet, then OpenNext builds + deploys against the selected config file:
  - `bun run deploy:cf:mainnet` → `opennextjs-cloudflare build && opennextjs-cloudflare deploy` (default `wrangler.jsonc`) → `robbed`.
  - `bun run deploy:cf:testnet` → `opennextjs-cloudflare build --config wrangler.testnet.jsonc && … deploy --config wrangler.testnet.jsonc` → `robbed-testnet`.
- **Each file carries its own full config** — `vars` (the per-target `NEXT_PUBLIC_*` runtime mirror), the `r2_buckets` bindings (`robbed-assets`, read leg only, §12.19), `assets`, `compatibility_flags` (`nodejs_compat`, `global_fetch_strictly_public`), and `compatibility_date`. There is **no cross-file inheritance**: the testnet file mirrors `wrangler.jsonc` and intentionally differs only in `name`, `workers_dev`, `routes`, the testnet `vars`, and an isolated incremental-cache prefix (`NEXT_INC_CACHE_R2_PREFIX`). Keeping the two files mirror-identical except those deltas is the anti-drift discipline for this surface.
- **Custom domains** (Cloudflare Workers custom domains): `testnet.robbed.fun` → `robbed-testnet` (declared in `wrangler.testnet.jsonc` `routes`); `robbed.fun` → `robbed` (attached account-side). Both live in the **single `robbed.fun` Cloudflare zone** (testnet is a subdomain); Cloudflare provisions the edge cert + proxied DNS record. The DNS cutover is **done** (§4).

> **Alternative considered and rejected:** `env.*` named environments in a single `wrangler.jsonc` (Cloudflare's `<name>-<env>` convention, deploy `--env`). Rejected for the OpenNext pipeline: `opennextjs-cloudflare build|deploy` selects a Wrangler config with `--config`, so two config files is the clean per-target seam, and each build sheet (`.env.testnet` / `.env.mainnet`) inlines its own `NEXT_PUBLIC_*` at build time regardless. The two files are kept mirror-identical except the intended per-target deltas.

---

## 4. DNS + serving topology (DONE — 2026-07-12)

**DNS cutover is complete** (spec §12.49 annotation, 2026-07-12). `robbed.fun` and `testnet.robbed.fun` are on Cloudflare DNS in the account `0b1b0b8753489a11d35ee922961f6b72` (§12.45), and both are **served** (interim) as follows:

- **Frontend (web)** — the branded domains resolve to the Cloudflare Workers custom domains: `robbed.fun` → the `robbed` Worker (attached account-side), `testnet.robbed.fun` → the `robbed-testnet` Worker (`wrangler.testnet.jsonc` `routes`, §3). Each compose stack's Cloudflare Tunnel keeps a **standby** `web` ingress rule for its hostname (`tools/localstack/cloudflared/{mainnet,testnet}.yml`) that takes over if DNS is ever moved off the Worker.
- **Backend (API + WS)** — the public API/WS hostnames are published **from inside each compose stack** by its `cloudflared` service (a compose-managed Cloudflare Tunnel connector), not by a separate host: `api.robbed.fun` → mainnet stack `api` (REST) with `wss://api.robbed.fun/ws` → the Bun WS fanout; `api-testnet.robbed.fun` (+ `/ws`) → the testnet stack. Ingress is in-repo (no secrets — the tunnel UUID is routing metadata): `tools/localstack/cloudflared/{mainnet,testnet}.yml`.
- The first-level `api-testnet.robbed.fun` (not `api.testnet.robbed.fun`) is deliberate — a second-level subdomain is outside Universal SSL's `*.robbed.fun` coverage and fails TLS at the edge (see `docker.md` "Public exposure").

The old `*.workers.dev`-interim framing is retired; `wrangler.testnet.jsonc` still sets `workers_dev: true` only as a **secondary** access path next to the custom domain.

---

## 5. Implementation follow-ups (routed to owners — NOT done in this runbook)

This runbook is docs/spec only. The concrete wiring below is routed; each owner consults docs-first before implementing.

| # | Task | Owner | Notes |
|---|---|---|---|
| E-1 | Per-env `.env` build sheets: `.env.testnet`, `.env.mainnet` (web build vars; secrets → the compose stack's host `.env` / Workers secret store, never committed); keep `.env.example` ⇄ `env-inventory.md` in sync (G-9 CI check). | robbed-shared (workspace/env owner) + robbed-frontend (web vars) | Do NOT commit secrets. The committed-safe local defaults are the only fully-committable ones. |
| E-2 | **DONE (§3):** shipped as two Wrangler config files — `wrangler.jsonc` (`robbed`) + `wrangler.testnet.jsonc` (`robbed-testnet`), each carrying its own full `vars`/bindings — with `deploy:cf:mainnet` / `deploy:cf:testnet` scripts (`apps/web/package.json`). | robbed-frontend + robbed-shared (workspace scripts) | Per-target file model, not `env.*` named environments (§12.45). |
| E-3 | Per-env addresses codegen: deploy broadcasts → `contracts/deployments/<chainId>.json` (D-2, §12.49 annotation); codegen emits `@robbed/shared` `addresses.ts` per env (LOCAL from the local broadcast). | robbed-contracts (deploy artifacts) + robbed-shared (codegen in `packages/shared`) | Extends the §12.38/M1-14 codegen. `packages/*` owned by robbed-shared. |
| E-4 | Per-env indexer/API config: `INDEXER_RPC_*`, `START_BLOCK`, `ETH_USD_SOURCE_URL`, `CORS_ALLOWED_ORIGINS`, R2 bases resolved per env; compose stack `testnet`/`mainnet` variants (`docker-compose.{testnet,mainnet}.yml`, per-env secret sets). | robbed-indexer (owns indexer/api infra + root compose, P-9) | Stack `.env` secret set per env; §12.48a/b env-gated checks run at Phase-T/M2 start against the live RPC. |
| E-5 | **DONE (§4):** `robbed.fun` + `testnet.robbed.fun` on Cloudflare DNS (account `0b1b0b…f6b72`), Worker custom domains attached, API/WS served by the per-stack `cloudflared` tunnels. | ops / user (§13 domain open item, now closed) | DNS cutover complete 2026-07-12. |
| E-6 | Testnet faucet URL (§13 still-open leg) pulled from official Robinhood docs at Phase-T deploy start; deploy fails if unset. | robbed-contracts | Never invented. |

---

## 6. Definition of done (for this runbook)

- Every env's chain id / RPC / WS / explorer / domain is sourced from official Robinhood docs (§1 + `testnet.md` §1 for the canonical 46630 params), never invented, and lives in config not source (§2).
- The env-defining resolutions (§2) agree with `env-inventory.md` (authoritative per-variable) without contradiction, and restate no per-variable secret-class/source/owner metadata.
- The Workers per-target deploy model (§3) and the DNS + serving topology (§4) are unambiguous and match the shipped config (`wrangler.jsonc` / `wrangler.testnet.jsonc`, the compose-managed Cloudflare Tunnels).
- All implementation is **routed, not performed** (§5) — this file authors no code.
