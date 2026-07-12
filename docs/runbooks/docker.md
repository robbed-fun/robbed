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
`TESTNET`). Distinct project name `robbed-testnet` → distinct volumes/network; host ports reuse the
4XXX convention, so don't run both stacks simultaneously without overriding `*_PORT`.

### Prerequisites (§13 / Phase-T artifacts — the stack fails closed without them)

| Artifact | Produced by | Consumed as |
|---|---|---|
| Official testnet chain ID / RPC URL / WS URL | §13 item, pulled from official Robinhood docs at Phase-T start — **never invented** | `TESTNET_CHAIN_ID`, `TESTNET_RPC_URL`, `TESTNET_RPC_WS_URL` env (no defaults; `${VAR:?}` aborts `config`/`up` when unset or empty) |
| Official testnet Blockscout URL | same §13 item | **Not consumed by compose** — used by the T-3 `forge` verification step and the T-4 lifecycle runbook |

**Official values (docs.robinhood.com/chain/connecting/, retrieved 2026-07-11 — re-verify at Phase-T start):** chain ID **46630**; public RPC `https://rpc.testnet.chain.robinhood.com` (rate-limited; Alchemy `https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}` + `wss://…` recommended for sustained use); explorer `https://explorer.testnet.chain.robinhood.com`; sequencer feed `wss://feed.testnet.chain.robinhood.com`; faucet `https://faucet.testnet.chain.robinhood.com`. Native gas token ETH. Beware: some third-party RPC lists print chain ID 46646 — the official docs say 46630; the `chaincheck` one-shot settles it against the live RPC.
| Testnet constants in `@robbed/shared` | **T-1** (via robbed-shared, architect-ratified) | Unblocks the indexer + web chain gates (see limitation below) |
| Contract addresses + deploy block | **T-3** deploy (`contracts/deployments/46630.json` — canonical `contracts/deployments/<chainId>.json` per **D-2**, decisions.md §15, 2026-07-12; supersedes the earlier `tools/deployments/testnet.json` wording) | `tools/localstack/out/testnet.env` — same keys as the local `local.env` (`CURVE_FACTORY_ADDRESS`, `ROUTER_ADDRESS`, `MIGRATOR_ADDRESS`, `TREASURY_ADDRESS`, `LP_FEE_VAULT_ADDRESS`, `START_BLOCK`), emitted/derived from the T-3 artifact via `emit-testnet-env.ts`. `api` and `indexer` refuse to start without it, with an error pointing here — there is no best-effort mode (no local deploy one-shot can fill the gap) |

### Env contract

Export in the shell or a root `.env` (compose auto-loads it). All three are required; missing/empty
values abort with the interpolation error message (verified: `docker compose -f
docker-compose.testnet.yml config` exits 1 with a message naming the variable and this section —
never a silent default).

| Variable | Required | Meaning |
|---|---|---|
| `TESTNET_RPC_URL` | yes | Official testnet JSON-RPC → indexer `INDEXER_RPC_HTTP`, api `ROBINHOOD_RPC_URL`, web `NEXT_PUBLIC_RPC_HTTP`, `chaincheck` preflight |
| `TESTNET_RPC_WS_URL` | yes | Official testnet WS RPC → indexer `INDEXER_RPC_WS`, web `NEXT_PUBLIC_RPC_WS` |
| `TESTNET_CHAIN_ID` | yes | Official testnet chain id — asserted by the `chaincheck` one-shot (`cast chain-id` against `TESTNET_RPC_URL` must match; api/indexer gate on it via `depends_on`) |

Everything else (`POSTGRES_*`, `MINIO_*`, `R2_BUCKET`, `*_PORT`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`,
`NEXT_PUBLIC_LARGE_VALUE_ETH_THRESHOLD`) keeps the same dev defaults as the local stack. `web` runs with
`NEXT_PUBLIC_MOCK_DATA=false` hardcoded — this stack exists to exercise real testnet data.

### Bring-up

```bash
export TESTNET_RPC_URL=…   TESTNET_RPC_WS_URL=…   TESTNET_CHAIN_ID=…   # from official docs (§13)
# tools/localstack/out/testnet.env must exist (T-3 output — see prerequisites)
pnpm dev:testnet          # or dev:testnet:d / :down / :reset / :logs / :ps
docker compose -f docker-compose.testnet.yml config   # static validation (fails loud on missing env)
```

### Known limitation — indexer/web chain gates are MAINNET constants (honest status)

The indexer's fail-closed startup assertions (`apps/indexer/src/assertions.ts` +
`apps/indexer/src/config.ts`) pin `chainId === 4663` via the shared `CHAIN_ID` constant (statically
AND against the live RPC) and canonical WETH from `@robbed/shared`; **neither is env-overridable**
(only `V3_FACTORY_ADDRESS` / `V3_NPM_ADDRESS` accept env overrides). The web wallet config derives
from the same shared `CHAIN_ID`. If the official testnet chain id ≠ 4663, the indexer will
correctly refuse to start until **T-1** lands testnet constants through robbed-shared
(architect-ratified). This is fail-closed behavior working as designed — the compose file is
delivered ahead of the testnet deploy as ready infrastructure; **do not weaken the assertions** to
make the stack boot. Also note: minio still stands in for R2 here; verification against **real R2**
is the T-5 staging deploy's concern, not this compose file's.

## Not in this file (deferred)

- **Production images** — these are dev-mode containers (bind mount + watchers). The prod build/deploy landed at **P-3**: `apps/indexer/Dockerfile` + `apps/api/Dockerfile` (multi-stage, non-root, pnpm-workspace-correct) and the Komodo backend Stack at `tools/deploy/komodo/` (see `deploy-komodo-cloudflare.md` A.6b). Those images reuse this file's `postgres:17` (+`pg_trgm` init) and `redis:7` choices; there is **no prod `web` image** (frontend → Cloudflare Workers, §12.45).
- **Seed data** — deploychain deploys contracts (with the Deploy.s.sol canary create+buy) but no
  richer demo dataset; `NEXT_PUBLIC_MOCK_DATA=true` covers demo needs today. (`dev:stack` /
  `dev:health` wiring landed at I-3 — see "Bring the stack up".)
