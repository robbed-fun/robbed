# Runbook — Local Docker dev stack (`docker-compose.yml`)

**Owner:** hoodpad-indexer · **Master item:** M2-0 (infra) + dev-mode app services · **Spec:** §8 (off-chain stack), api.md §8 (minio/R2 in CI)

The root `docker-compose.yml` brings up the full local stack: the three dependency-free infra services
(**Postgres** (+`pg_trgm`), **Redis**, **minio**), a **local chain** (anvil **fork of Robinhood Chain
4663** + one-shot contract deploy — implementation-plan I-2), plus **every workspace app in
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
| `indexer` | `robbed-dev` | offchain `migrate` then `ponder dev` (apps/indexer); requires `local.env` from deploychain | — |
| `web` | `robbed-dev` | `next dev` (apps/web); browser RPC → `http://localhost:4545` | `curl /` |

**Image-tag choices (docs-first, verified 2026-07-10):** Postgres 17 (fully-supported, Ponder-proven major;
18 is `latest`), Redis 7 (battle-tested pub/sub; 8.x is `latest`), minio tag verified against the quay.io tag
API (the earlier `2025-09-06` pin did not exist), `mc ready local` is the official dependency-free readiness
probe (the server image has no curl/wget).

## Bring the stack up

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

## Not in this file (deferred)

- **Production images** — these are dev-mode containers (bind mount + watchers). The prod build/deploy landed at **P-3**: `apps/indexer/Dockerfile` + `apps/api/Dockerfile` (multi-stage, non-root, pnpm-workspace-correct) and the Komodo backend Stack at `tools/deploy/komodo/` (see `deploy-komodo-cloudflare.md` A.6b). Those images reuse this file's `postgres:17` (+`pg_trgm` init) and `redis:7` choices; there is **no prod `web` image** (frontend → Cloudflare Workers, §12.45).
- **anvil / seed data / one-command `dev:stack` wiring** — Phase I (I-1/I-3), reusing this compose file.
