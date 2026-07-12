# Runbook — Local Docker dev stack (`docker-compose.yml`)

**Owner:** hoodpad-indexer · **Master item:** M2-0 (infra) + dev-mode app services · **Spec:** §8 (off-chain stack), api.md §8 (minio/R2 in CI)

The root `docker-compose.yml` brings up the full local stack: the three dependency-free infra services
(**Postgres** (+`pg_trgm`), **Redis**, **minio**), a **local chain** (anvil **fork of Robinhood Chain
4663** + one-shot contract deploy — plan item I-2), plus **every workspace app in
dev/hot-reload mode** (api, ws fanout, indexer, web). App services share one dev image
(`docker/dev.Dockerfile`: node 22 + bun + pnpm), bind-mount the repo at `/workspace`, and keep
`node_modules` in named volumes so linux-native binaries (sharp, resvg) never collide with the macOS
host install.

**Why a fork, not a bare anvil chain:** the indexer fail-closed asserts chainId 4663 + canonical
WETH/V3 (`apps/indexer/src/assertions.ts`) — only a fork satisfies both. `Deploy.s.sol` auto-selects
live mode on 4663; its O-6 treasury guard is satisfied by the **dev-fork constants fixture**
`tools/localstack/constants.fork.json` (canonical M0 constants + anvil dev account 1 as a LOCAL
treasury stand-in — never a real deploy input; the canonical `constants.json` keeps `treasurySafe`
unset). The deploy one-shot emits `tools/localstack/out/local.env` (addresses + `START_BLOCK`) which
the indexer (required) and api (best-effort) source at start. Anvil state is ephemeral — every
`docker compose up` is a fresh fork + fresh deploy.

---

## Host-port convention: everything on 4XXX

| Host port | Service | Container port | What |
|---|---|---|---|
| `4000` | `web` | 3000 | Next.js 16 dev server |
| `4001` | `api` | 3001 | Hono API (`/v1/healthz`, `/v1/readyz`) |
| `4002` | `ws` | 3002 | Bun WS fanout (plain GET answers 426 — expected) |
| `4269` | `indexer` | 42069 | Ponder dev UI / GraphQL |
| `4379` | `redis` | 6379 | Redis |
| `4432` | `postgres` | 5432 | Postgres 17 |
| `4545` | `anvil` | 8545 | anvil fork of Robinhood Chain (chainId 4663; http + ws on one port) |
| `4900` | `minio` | 9000 | S3 API (R2-compatible) |
| `4901` | `minio` | 9001 | minio web console |
| `4964` | `indexer` | 9464 | Gate-7 `/metrics` |

Container-internal ports keep each tool's default; only the host mapping follows 4XXX. Every mapping is
overridable via env (`WEB_PORT`, `API_PORT`, `WS_PORT`, `PONDER_PORT`, `ANVIL_PORT`, `REDIS_PORT`,
`POSTGRES_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT`, `METRICS_HOST_PORT`).

## Services

| Service | Image | Purpose | Healthcheck |
|---|---|---|---|
| `postgres` | `postgres:17` | Relational store; `pg_trgm` + API tables applied at first init | `pg_isready` |
| `redis` | `redis:7-alpine` | Pub/sub fanout + rate-limit windows | `redis-cli ping` |
| `minio` | `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` | R2-compatible object store | `mc ready local` |
| `createbuckets` | `minio/mc:RELEASE.2025-08-13T08-35-41Z` | One-shot: default bucket + public-download policy, then exits 0 | — |
| `anvil` | `ghcr.io/foundry-rs/foundry:v1.7.1` | Fork of Robinhood Chain (RPC from the official Blockscout config, verified `eth_chainId`=4663); `--block-time 2` | `cast chain-id == 4663` |
| `deploychain` | `ghcr.io/foundry-rs/foundry:v1.7.1` | One-shot: `Deploy.s.sol` against the fork (canary create+buy included), emits `tools/localstack/out/local.env`, exits 0 | — |
| `deps` | `robbed-dev` (built) | One-shot: `pnpm install --frozen-lockfile` for the workspace, then exits 0 | — |
| `api` | `robbed-dev` | `bun run --hot src/index.ts` (apps/api); sources `local.env` best-effort | `curl /v1/healthz` |
| `ws` | `robbed-dev` | `bun run --hot src/ws.ts` (apps/api, Redis-only fanout) | TCP connect |
| `indexer` | `robbed-dev` | offchain `migrate` then `ponder dev` (apps/indexer); requires `local.env` from deploychain | `curl /ready` (200 == backfill complete) |
| `web` | `robbed-dev` | `next dev` (apps/web); browser RPC → `http://localhost:4545` | `curl /` |

**Image-tag choices (docs-first, verified 2026-07-10):** Postgres 17 (fully-supported, Ponder-proven major;
18 is `latest`), Redis 7 (battle-tested pub/sub; 8.x is `latest`), minio tag verified against the quay.io tag
API (the earlier `2025-09-06` pin did not exist), `mc ready local` is the official dependency-free readiness
probe (the server image has no curl/wget).

## Bring the stack up

**One command (plan item I-3, gate G-1):**

```bash
bun run dev:stack    # up -d --build, then waits (readiness-gated) until every service is ready
bun run dev:health   # the G-1 checklist against the running stack; exits 0 only when ALL pass
```

`dev:stack` (`tools/localstack/stack.ts`) runs `docker compose up -d --build`, then polls
`docker compose ps` until every long-running service is **healthy** and every one-shot
(`deps`, `createbuckets`, `apimigrations`, `deploychain`) has **exited 0**, printing per-service
progress. Bounded deadline (`DEV_STACK_TIMEOUT_SECS`, default 900s — first boot builds the image +
full pnpm install); on failure or timeout it prints the offending service's last 40 log lines and
exits 1. The `indexer` service carries a `curl /ready` healthcheck (Ponder answers 200 only once
historical indexing completes), so "ready" means a caught-up indexer, not just a live process.

`dev:health` (`tools/localstack/health.ts`) runs the G-1 checklist, one printed result per check:
DB `select 1` · Redis PING · chain RPC `eth_chainId == 0x1237` (4663) · indexer head advancing
(two Ponder `/status` samples must differ, or head == chain tip) · API `/v1/healthz` + `/v1/readyz`
200 · WS handshake + subscribe/unsubscribe round-trip (shared `wsClientOpSchema`/`wsMessageSchema`
shapes; a schema-valid frame is published on Redis to a reserved probe channel and must be delivered
while subscribed and NOT after unsub) · web `/` 200. All ports honor the same `*_PORT` env vars the
compose file uses.

**In CI (`.github/workflows/ci.yml` `e2e` job — plan I-6, gate G-6 final leg):** the same two
commands bring the stack up on `ubuntu-latest` (Docker + Compose v2 preinstalled) before the
Playwright flow matrix. Two CI-specific knobs: the `robbed-dev` image is pre-built via
`docker/build-push-action` with a GHA layer cache and loaded into the daemon, and `dev:stack` is
run with **`DEV_STACK_NO_BUILD=1`** (`up -d` without `--build` — buildx's docker-container driver
keeps a separate layer cache from the daemon builder, so an unconditional `--build` would rebuild
cache-blind). The in-container `pnpm install` (deps one-shot, fresh named volumes every run) is
NOT cached across CI runs — an accepted several-minute cost. The anvil fork hits the public
Robinhood RPC from CI; set the `ROBINHOOD_RPC_URL` repo secret/variable to a private endpoint if
rate limits bite. E2E web env (`NEXT_PUBLIC_E2E`, `NEXT_PUBLIC_E2E_ACCOUNTS`,
`NEXT_PUBLIC_MOCK_DATA=false`) is passed through compose interpolation.

**Raw compose (equivalent, no readiness gate):**

```bash
docker compose up -d --build   # first run: builds robbed-dev + full pnpm install (several minutes)
docker compose ps              # expect: infra healthy, deps/createbuckets Exited (0), apps healthy
docker compose logs -f api     # tail one service
docker compose down            # stop; add -v to drop ALL volumes (data + installed node_modules)
```

One-shots (`createbuckets`, `deps`) showing `Exited (0)` is success, not an error.

**After changing any `package.json` or `pnpm-lock.yaml`:** `docker compose run --rm deps`, then restart the
affected app service. Source-code edits need nothing — every app runs its own watcher (bun `--hot`,
`ponder dev`, `next dev`) over the bind mount.

### Static validation without a running daemon

```bash
docker compose config   # parses + interpolates env; exit 0 == valid. Does NOT start containers.
```

## Configuration (env, dev defaults, overrides)

All credentials are dev defaults baked in via `${VAR:-default}`; override from a root `.env`
(auto-loaded by compose) or the shell.

| Variable | Default | Used by |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `robbed` / `robbed_dev_pw` / `robbed` | postgres, api, indexer |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `robbed` / `robbed_dev_secret` | minio, createbuckets, api |
| `R2_BUCKET` | `robbed-assets` | createbuckets, api, web |
| `ROBINHOOD_RPC_URL`, `NEXT_PUBLIC_RPC_HTTP/WS`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | empty | api / web passthrough |

In-network wiring (service DNS names) is set inside the compose file; browser-visible URLs
(`NEXT_PUBLIC_*`, `R2_PUBLIC_BASE_URL`) point at the host-mapped 4XXX ports. From the **host**, the stack is:

```
DATABASE_URL=postgresql://robbed:robbed_dev_pw@localhost:4432/robbed
REDIS_URL=redis://localhost:4379
# minio as R2: S3 API http://localhost:4900, console http://localhost:4901
# api http://localhost:4001 · ws ws://localhost:4002 · web http://localhost:4000 · ponder http://localhost:4269
```

### Indexer wiring (fails closed by design)

`ponder dev` refuses to start without `INDEXER_RPC_HTTP`, `CURVE_FACTORY_ADDRESS`, and
`MIGRATOR_ADDRESS`. In this stack they come from compose (`INDEXER_RPC_HTTP=http://anvil:8545`)
plus the deploychain-emitted `tools/localstack/out/local.env` (addresses, `START_BLOCK`) — no
manual `.env` needed. A root `.env` (loaded via `env_file`) can still override anything, e.g.
`ROBINHOOD_RPC_URL` to fork through a private RPC. The indexer entrypoint also runs the idempotent
offchain `migrate` (watermarks, eth_usd, metadata_verifications — indexer.md §3) before `ponder dev`.

## Postgres first-init SQL

Runs against `POSTGRES_DB` in sorted order, **only when the data volume is empty**:

1. `docker/postgres/init/01-pg_trgm.sql` — `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
2. `apps/api/migrations/001_api_tables.sql` (mounted as `02-api-tables.sql`) — API-owned
   `moderation_status` / `moderation_audit_log` tables (idempotent).

On an already-initialized volume: `docker compose down -v` to reinitialize, or apply manually:

```bash
docker compose exec postgres psql -U robbed -d robbed -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
docker compose exec -T postgres psql -U robbed -d robbed < apps/api/migrations/001_api_tables.sql
```

## minio bucket bootstrap

`createbuckets` runs `mc mb --ignore-existing local/$R2_BUCKET` then `mc anonymous set download` (public
CDN read pattern). Manual alternative:

```bash
docker compose exec minio mc alias set local http://localhost:9000 robbed robbed_dev_secret
docker compose exec minio mc mb --ignore-existing local/robbed-assets
docker compose exec minio mc anonymous set download local/robbed-assets
```

Or via the console at `http://localhost:4901` (login `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`).

## Data & reset

Named volumes persist across `up`/`down`: `robbed_pgdata` / `robbed_redisdata` / `robbed_miniodata` (data),
`robbed_pnpm_store` + `robbed_*_nm` (installed deps), `robbed_web_next` (Next build cache).
`docker compose down -v` wipes everything — clean-slate reset (next `up` re-runs Postgres init and a full
`pnpm install`).

### DB-only reset — `bun run dev:db:reset` (backfill-from-chain proof)

`tools/localstack/reset-db.ts` wipes ONLY the indexer/API database state and proves it re-derives
from the chain: stops `indexer`/`api`/`ws` (anvil/postgres/redis/minio/web stay up — anvil's
in-memory chain IS the backfill source), drops the `public` + `ponder_sync` schemas (dropping
Ponder's RPC cache forces a true refetch from anvil, not a cache replay), restores the bootstrap
`public` schema + `pg_trgm`, deletes the persisted Redis `*:seq` channel counters (the only Redis
keys that persist; the publish latch is process-local), re-runs the `apimigrations` one-shot, then
restarts the consumers with plain `docker start` on the compose-resolved container names — never
`compose up`/`compose start`, since BOTH re-run exited `depends_on` one-shots (observed live:
`compose start` re-ran `deploychain`, redeploying contracts and rewriting `local.env`; a tripwire
in the script fails loud if `local.env` changes mid-reset) — and waits fail-loud until Ponder
`/ready` + API `/v1/readyz` are green again.

- **Backfills from chain:** tokens, trades, graduations, V3 swaps/collects, candles, flows, pnl,
  confirmation watermarks, metadata verification verdicts (re-fetched from minio).
- **LOST (not chain-recoverable):** `moderation_status` + `moderation_audit_log` (moderation
  verdicts, admin audit trail) and the `eth_usd`/competitor snapshot history (external-source
  series — history restarts at the next poll).

Knobs: `DEV_RESET_TIMEOUT_SECS` (default 900). Local stack only — never point it at testnet.

## Testnet stack (`docker-compose.testnet.yml`)

> **End-to-end testnet guide (wallet, faucet, env, deploy, lifecycle): `docs/runbooks/testnet.md`.** This section covers only the compose mechanics.

**Status (2026-07-11): Phase-T-ready infrastructure, currently blocked on Phase-T outputs.** The file
is the same off-chain stack (postgres/redis/minio/api/ws/indexer/web + one-shots) pointed at the
**remote Robinhood Chain testnet** — no `anvil`, no `deploychain` (the chain is remote; contracts
deploy via the Phase-T `forge script` run T-3, never via compose). It is a deliberate
**self-contained mirror** of `docker-compose.yml`: Compose override merging cannot delete whole
services or `depends_on` edges from an untouched base (`!reset` is per-attribute only —
docs.docker.com/reference/compose-file/merge), so a standalone file is the only shape that keeps the
local file untouched. **Anti-drift discipline:** any change to a shared service goes to BOTH files;
review with `diff docker-compose.yml docker-compose.testnet.yml` (services are annotated `MIRROR` vs
`TESTNET`). Distinct project name `robbed-testnet` → distinct volumes/network; host ports live on a
distinct **41XX block** (dev keeps 40XX/44XX), so **both stacks run simultaneously** with no
`*_PORT` overrides:

| Service | Testnet host port | (dev stack) |
|---|---|---|
| web | **4100** | 4000 |
| api | **4101** | 4001 |
| ws | **4102** | 4002 |
| postgres | **4132** | 4432 |
| indexer metrics | **4164** | 4964 |
| ponder dev UI/GraphQL | **4169** | 4269 |
| redis | **4179** | 4379 |
| minio S3 | **4190** | 4900 |
| minio console | **4191** | 4901 |

Env-var **names** are identical to the dev stack (only the `:-` defaults differ) — an exported
`*_PORT` in your shell/`.env` applies to BOTH stacks and re-collides them.

### Prerequisites (§13 / Phase-T artifacts — the stack fails closed without them)

| Artifact | Produced by | Consumed as |
|---|---|---|
| Official testnet chain ID / RPC URL / WS URL | §13 item, pulled from official Robinhood docs at Phase-T start — **never invented** | `TESTNET_CHAIN_ID`, `TESTNET_RPC_URL`, `TESTNET_RPC_WS_URL` env (no defaults; `${VAR:?}` aborts `config`/`up` when unset or empty) |
| Official testnet Blockscout URL | same §13 item | **Not consumed by compose** — used by the T-3 `forge` verification step and the T-4 lifecycle runbook |

**Official values (docs.robinhood.com/chain/connecting/, retrieved 2026-07-11 — re-verify at Phase-T start):** chain ID **46630**; public RPC `https://rpc.testnet.chain.robinhood.com` (rate-limited; Alchemy `https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}` + `wss://…` recommended for sustained use); explorer `https://explorer.testnet.chain.robinhood.com`; sequencer feed `wss://feed.testnet.chain.robinhood.com`; faucet `https://faucet.testnet.chain.robinhood.com`. Native gas token ETH. Beware: some third-party RPC lists print chain ID 46646 — the official docs say 46630; the `chaincheck` one-shot settles it against the live RPC.
| Testnet constants in `@robbed/shared` | **T-1** (via robbed-shared, architect-ratified) | Unblocks the indexer + web chain gates (see limitation below) |
| Contract addresses + deploy block | **T-3** deploy (`contracts/deployments/46630.json` — canonical `contracts/deployments/<chainId>.json` per **D-2** (2026-07-12; record: spec §12.49 annotation); supersedes the earlier `tools/deployments/testnet.json` wording) | `tools/localstack/out/testnet.env` — same keys as the local `local.env` (`CURVE_FACTORY_ADDRESS`, `ROUTER_ADDRESS`, `MIGRATOR_ADDRESS`, `TREASURY_ADDRESS`, `LP_FEE_VAULT_ADDRESS`, `START_BLOCK`), emitted/derived from the T-3 artifact via `emit-testnet-env.ts`. `api` and `indexer` refuse to start without it, with an error pointing here — there is no best-effort mode (no local deploy one-shot can fill the gap) |

### Env contract

Export in the shell or a root `.env` (compose auto-loads it). The two required vars abort with the
interpolation error message when missing/empty (verified: `docker compose -f
docker-compose.testnet.yml config` exits 1 with a message naming the variable and this section —
never a silent default).

| Variable | Required | Meaning |
|---|---|---|
| `TESTNET_RPC_URL` | yes | Official testnet JSON-RPC → indexer `INDEXER_RPC_HTTP`, api `ROBINHOOD_RPC_URL`, web `NEXT_PUBLIC_RPC_HTTP`, `chaincheck` preflight |
| `TESTNET_RPC_WS_URL` | **no — WS optional, HTTP polling fallback** | WS JSON-RPC → indexer `INDEXER_RPC_WS`, web `NEXT_PUBLIC_RPC_WS`. Empty/unset is fine: `apps/indexer/src/config.ts` treats `INDEXER_RPC_WS` as optional (`\|\| undefined` → Ponder falls back to HTTP polling) and the web env layer tolerates empty. Set it to the **Alchemy wss** endpoint (`wss://robinhood-testnet.g.alchemy.com/v2/{KEY}`) when a key is provided — **never the sequencer feed** (`wss://feed.testnet…` is a block feed, not JSON-RPC) |
| `TESTNET_CHAIN_ID` | yes | Official testnet chain id — asserted by the `chaincheck` one-shot (`cast chain-id` against `TESTNET_RPC_URL` must match; api/indexer gate on it via `depends_on`) |

Everything else (`POSTGRES_*`, `MINIO_*`, `R2_BUCKET`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`,
`NEXT_PUBLIC_LARGE_VALUE_ETH_THRESHOLD`) keeps the same dev defaults as the local stack; `*_PORT`
defaults are re-based to the 41XX block (table above). `web` runs with
`NEXT_PUBLIC_MOCK_DATA=false` hardcoded — this stack exists to exercise real testnet data.

### Public exposure (Cloudflare Tunnel) — compose-managed connector + browser-visible URL overrides

`testnet.robbed.fun` → `web` (STANDBY — see below), `api-testnet.robbed.fun` → `api` (with `/ws` → `ws`) are published
via Cloudflare Tunnel `robbed_testnet` (UUID `15ec4e57-6998-4da2-8a5b-ca45c10eecba`) by the
**`cloudflared` compose service** inside `docker-compose.testnet.yml` — the connector starts and
stops with the stack (2026-07-12; it supersedes the host systemd user units
`cloudflared-robbed-testnet.service` / `cloudflared-robbed-mainnet.service`, now stopped +
disabled — re-enabling them is harmless overlap, multiple connectors per tunnel are supported,
but the compose services are canonical). How it is wired:

- **Ingress config is committed in-repo** (no secrets — a tunnel UUID is routing metadata):
  `tools/localstack/cloudflared/testnet.yml` (+ `mainnet.yml` for the mainnet stack), mounted
  read-only at `/etc/cloudflared/config.yml`. Targets are **compose-internal service DNS**
  (`web:3000` / `api:3001` / `ws:3002`) — the connector joins the stack network, so `localhost`
  there would be the connector container itself, never the stack.
- **Run credentials NEVER enter the repo**: compose bind-mounts
  `${CLOUDFLARED_DIR:-~/.cloudflared}/<tunnel-uuid>.json` read-only to
  `/etc/cloudflared/creds.json`. Set `CLOUDFLARED_DIR` if the credentials live elsewhere. The
  service runs as `user: "${CLOUDFLARED_UID:-1000}:${CLOUDFLARED_GID:-1000}"` because the image's
  distroless nonroot user (65532) cannot read the 0600/0400 host credential files.
- Image pinned: `cloudflare/cloudflared:2026.7.1` (current stable at 2026-07-12);
  `restart: unless-stopped`, `depends_on` web/api/ws healthy. Verify with
  `docker logs <stack>-cloudflared-1` — expect 4 × "Registered tunnel connection" and
  `Settings: map[config:/etc/cloudflared/config.yml …]`.
- **API hostname RENAMED 2026-07-12: `api.testnet.robbed.fun` → `api-testnet.robbed.fun`.**
  The old host is a *second-level* subdomain, outside Universal SSL's
  `robbed.fun`/`*.robbed.fun` coverage — the edge answered TLS with handshake-failure
  (alert 40); fixing it in place needed a paid Advanced Certificate / Total TLS cert. The
  first-level `api-testnet.robbed.fun` is covered by the existing Universal SSL wildcard, so
  HTTPS + WSS work with zero cert changes. The stale `api.testnet.robbed.fun` CNAME still
  exists in the zone (cloudflared can only add DNS routes) — zone-owner cleanup is cosmetic;
  it now falls to the connector's 404 catch-all.
- **`testnet.robbed.fun` → Worker flip (2026-07-12, mirroring `robbed.fun`):** the hostname is
  being moved off the tunnel onto the `robbed-testnet` Worker as a Workers **Custom Domain**
  (declared in `apps/web/wrangler.testnet.jsonc` `routes`). ⚠ PENDING zone-owner action: the
  attach is blocked by the tunnel-created `testnet.robbed.fun` CNAME — the Workers API refuses
  to override "externally managed" DNS records (error 100117), and no local credential can
  delete DNS (wrangler OAuth = zone:read). **Delete that CNAME in the dashboard (robbed.fun
  zone → DNS), then re-run `pnpm run deploy:cf:testnet`** — the config-declared custom domain
  attaches automatically (non-TTY wrangler auto-confirms the override). The tunnel keeps the
  `testnet.robbed.fun → web` ingress rule as STANDBY, same convention as mainnet's `robbed.fun`
  rule (flips back if DNS ever moves off the Worker).

External visitors' browsers cannot reach `http://localhost:4101`,
so the web service's three browser-visible URLs are override-able with localhost defaults
(root `.env` carries the live values; the public URLs also work for local browsing):

| Override (root `.env`) | Wired to | Live value |
|---|---|---|
| `TESTNET_PUBLIC_API_BASE_URL` | `NEXT_PUBLIC_API_BASE_URL` | `https://api-testnet.robbed.fun` |
| `TESTNET_PUBLIC_WS_URL` | `NEXT_PUBLIC_WS_URL` | `wss://api-testnet.robbed.fun/ws` |
| `TESTNET_PUBLIC_R2_BASE_URL` | `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` | *(unset — see limitation)* |

**Known limitation:** R2 stays on the `http://localhost:4190/robbed-assets` default, so
**external visitors see broken images** (token logos/metadata assets). Fix options, either works:
(a) add a tunnel hostname for minio (e.g. `assets.testnet.robbed.fun` → `:4190`) and set
`TESTNET_PUBLIC_R2_BASE_URL` accordingly — note the API's `R2_PUBLIC_BASE_URL` (baked into stored
metadata URLs) must move in lockstep; or (b) switch the stack to **real R2 + CDN** (the T-5
production shape). Local browsing is unaffected either way.

### Bring-up

```bash
export TESTNET_RPC_URL=…   TESTNET_CHAIN_ID=…   # from official docs (§13); TESTNET_RPC_WS_URL optional (Alchemy wss, HTTP-polling fallback)
# tools/localstack/out/testnet.env must exist (T-3 output — see prerequisites)
pnpm dev:testnet          # or dev:testnet:d / :down / :reset / :logs / :ps
docker compose -f docker-compose.testnet.yml config   # static validation (fails loud on missing env)
```

### Chain-identity gate (§12.55, implemented 2026-07-12 — replaces the earlier "bypassed gate" limitation)

The indexer consumes an explicit **`INDEXER_CHAIN_ID`** (compose-injected: `4663` on the local
fork stack, `46630` here; **no default exists**). Double fail-closed assertion
(`apps/indexer/src/config.ts` + `src/assertions.ts`): the id must resolve in the shared deployment
registry (`packages/shared/src/addresses.ts` — env selects a chain, it can never invent one) AND
the live RPC's `eth_chainId` must equal it (`assertRuntime`, run by `migrate` before
`ponder dev`). Every chain-dependent address (WETH, V3 factory/NPM/SwapRouter02, the robbed
contracts, treasury) resolves from that registry entry — the pre-§12.55 mainnet-default fallbacks
that would have silently missed testnet graduated-pool `Swap`/`Collect` are gone. The deploy
artifact (`local.env`/`testnet.env`) takes precedence for the robbed contracts (live truth on a
fork stack; identical to the registry on testnet by construction). **`set -e` is restored in both
compose files' indexer commands (§12.55(d))** — an assertion failure kills the container instead
of being swallowed (the pre-ruling defect observed live). §12.55 known limit: the registry's
`4663` entry is a mainnet-**fork** pipeline artifact, so `INDEXER_CHAIN_ID=4663` is refused unless
the stack declares `INDEXER_ALLOW_FORK_4663=1` (only `docker-compose.yml` does) — until a real
Phase-B deploy replaces the entry.

Also note: minio still stands in for R2 here; verification against **real R2** is the T-5 staging
deploy's concern, not this compose file's.

## Mainnet stack (`docker-compose.mainnet.yml`) — RUNNING in the INTERIM testnet-values state

Same pattern as the testnet stack (project `robbed-mainnet`, own volumes, `chaincheck` one-shot,
no anvil/deploychain). Env seams: `MAINNET_RPC_URL` (required, `:?`), `MAINNET_CHAIN_ID`
(required — asserted live by `chaincheck` **and** advertised as `NEXT_PUBLIC_CHAIN_ID`, one
source of truth), `MAINNET_INDEXER_CHAIN_ID` (optional — indexer §12.55 selection, default 4663),
`MAINNET_RPC_WS_URL` (optional, `:-` — Alchemy wss when a key exists; HTTP-polling fallback),
`MAINNET_PUBLIC_API_BASE_URL` / `MAINNET_PUBLIC_WS_URL` / `MAINNET_PUBLIC_R2_BASE_URL`
(browser-visible URL overrides, same seam as the testnet stack). Scripts:
`dev:mainnet` / `:d` / `:down` / `:reset` / `:logs` / `:ps`.

**⚠ INTERIM (2026-07-12): `robbed.fun` must be alive before a real 4663 deploy exists, so this
stack currently runs with TESTNET (46630) values** ("later we will replace testnet by mainnet"):
root `.env` sets `MAINNET_RPC_URL=https://rpc.testnet.chain.robinhood.com`,
`MAINNET_CHAIN_ID=46630`, `MAINNET_INDEXER_CHAIN_ID=46630`, and
`tools/localstack/out/mainnet.env` is a loudly-marked copy of the 46630 artifact set
(`testnet.env` keys, START_BLOCK 89648621). **§12.55 stays honest — nothing is bypassed:**
`chaincheck` asserts the live RPC serves the declared 46630, the indexer's chain-identity gate
resolves 46630 against the registry's real testnet entry, and `INDEXER_ALLOW_FORK_4663` is never
set (the 4663 default remains refused until a real deploy replaces the fork artifact — that
refusal is exactly why the interim runs on 46630). The DB backfills 46630 from 89648621 as a
**sibling** of the testnet stack's indexer with a physically distinct database
(`robbed-mainnet_*` volumes).

**Public exposure:** the `cloudflared` compose service publishes `robbed.fun` → `web`,
`api.robbed.fun` → `api` (with `/ws` → `ws`) over tunnel `robbed-mainnet`
(UUID `c80870d9-6ce5-40b6-a0d4-3e8e19b537b5`) — same wiring as the testnet stack (see "Public
exposure" above: in-repo ingress `tools/localstack/cloudflared/mainnet.yml`, host-mounted
credentials, `CLOUDFLARED_DIR`/`CLOUDFLARED_UID` seams). The ingress is chain-agnostic and does
not change at the Phase-B swap.

**Phase-B swap (replace testnet by mainnet):** follow the "PHASE-B SWAP CHECKLIST" in the
`docker-compose.mainnet.yml` header — real 4663 deploy lands `contracts/deployments/4663.json`
(registry re-codegen'd; Gate G-A governs), regenerate `mainnet.env` from it, flip root `.env`
(`MAINNET_RPC_URL` → official mainnet, `MAINNET_CHAIN_ID=4663`, delete
`MAINNET_INDEXER_CHAIN_ID`), then `down -v` (the DB holds 46630 backfill state) + `up -d`. The
§12.55 robbed-contracts follow-up still replaces the fork opt-in with a registry-mode assertion.
This compose file is the local staging shape only — the real production deploy is the P-3 images
on Komodo (`prod-images.md`).

Host ports — **42XX block** (dev 40XX/44XX, testnet 41XX; all three stacks can run at once):

| Service | Mainnet host port | (testnet) | (dev) |
|---|---|---|---|
| web | **4200** | 4100 | 4000 |
| api | **4201** | 4101 | 4001 |
| ws | **4202** | 4102 | 4002 |
| ponder dev UI/GraphQL | **4229** (4269 is dev-owned) | 4169 | 4269 |
| postgres | **4232** | 4132 | 4432 |
| indexer metrics | **4264** | 4164 | 4964 |
| redis | **4279** | 4179 | 4379 |
| minio S3 / console | **4290 / 4291** | 4190 / 4191 | 4900 / 4901 |

## Not in this file (deferred)

- **Production images** — these are dev-mode containers (bind mount + watchers). The prod build/deploy landed at **P-3**: `apps/indexer/Dockerfile` + `apps/api/Dockerfile` (multi-stage, non-root, pnpm-workspace-correct) and the backend **compose stacks** (`docker-compose.{testnet,mainnet}.yml`, fronted by Cloudflare Tunnels). Those images reuse this file's `postgres:17` (+`pg_trgm` init) and `redis:7` choices; there is **no prod `web` image** (frontend → Cloudflare Workers, §12.45).
- **Seed data** — deploychain deploys contracts (with the Deploy.s.sol canary create+buy) but no
  richer demo dataset; `NEXT_PUBLIC_MOCK_DATA=true` covers demo needs today. (`dev:stack` /
  `dev:health` wiring landed at I-3 — see "Bring the stack up".)
