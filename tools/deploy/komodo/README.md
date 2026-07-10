# ROBBED_ backend — Komodo Stack (`tools/deploy/komodo/`)

Git-synced infra-as-code for the **backend** half of the hosting split
(spec **§12.45**, `docs/runbooks/deploy-komodo-cloudflare.md` **Part A**). The
frontend deploys separately to **Cloudflare Workers** (Part B) — there is **no
`web` service and no web Dockerfile here**.

| File | What |
|---|---|
| `compose.yaml` | The four-service Stack: `postgres` (+`pg_trgm`), `redis`, `indexer` (Ponder/Node), `api` (Hono/Bun) + a `ws` service (Bun WS fanout) from the same api image. Plus a one-shot `apimigrations`. |
| `stack.toml` | Two Komodo `Stack` resources — `robbed-backend-testnet` and `robbed-backend-production` — both pointing at `compose.yaml`, with per-env `environment` blocks (secrets via `[[VAR]]` interpolation). |

Images built by these: `apps/indexer/Dockerfile`, `apps/api/Dockerfile` (both
build with **context = repo root** so `pnpm-lock.yaml` + `packages/shared`
`workspace:*` resolve).

## Deploy model (Komodo Core + periphery)

- **Komodo Core** (control plane) runs once on an ops host.
- A **periphery agent** runs on each target server and actually runs the
  containers (komo.do/docs/connect-servers). Register the server in Core, then
  point a Stack's `server` at it.
- Core **syncs `stack.toml` from git** (komo.do/docs/deploy/compose) and
  reconciles the Stacks — no click-ops drift. On `git push` a webhook can
  auto-redeploy.
- **Build-on-Komodo** (runbook A.4): the periphery host clones the repo and
  builds both images from their Dockerfiles. Graduate to prebuilt/registry
  images at M4 by setting `INDEXER_IMAGE` / `API_IMAGE` to a digest-pinned tag
  and removing the compose `build:` blocks.

## Entrypoint strategy (two API processes, one image)

The API ships **two entrypoints** — HTTP (`src/index.ts`) and WS fanout
(`src/ws.ts`). One image, two compose services (spec §8 co-location for the
<500ms budget):

- `api` service → the image's default `CMD` (`bun run src/index.ts`), `API_PORT` 3001.
- `ws` service → same image, `command:` override (`bun run src/ws.ts`), `WS_PORT` 3002.

The `ws` service shares the compose network with `redis` and the `indexer`
publisher, so a published event fans out without leaving the host. (Alternative:
a dedicated WS image via `docker build --build-arg APP_ENTRY=src/ws.ts` — the
Dockerfile supports it, but the two-services-one-image model is the default.)

The **indexer** entrypoint runs the idempotent offchain `migrate` (creates the
watermarks / eth_usd / metadata_verifications sidecar tables and runs the
fail-closed asserts: `pg_trgm` present + RPC chain id == 4663) **then**
`ponder start`. Ponder runs under **Node** (spec §8); a `bun` binary is present
only to execute the two TypeScript side-scripts (`migrate` / `rebuild`).

### One operational nuance: the pg_trgm search GIN indexes

`migrate` applies migration `0003_trgm_gin_indexes.sql` **only if the Ponder
`tokens` table already exists** (it is created by Ponder, not by `migrate`). So
on a **first** deploy the GIN indexes are skipped, then applied on the **next**
indexer restart (`migrate` re-runs, idempotently) once Ponder has created its
tables. To apply them without waiting for a restart, once the indexer is up:

```bash
# on the periphery host
docker compose -p <project> exec indexer bun run scripts/migrate.ts
```

Search still functions before the GIN index exists (sequential scan); the index
only accelerates `pg_trgm` lookups (§5.1).

## Per-env config (testnet / production)

`stack.toml` maps `docs/runbooks/env-inventory.md` onto the two envs
(environments.md §2, task E-4):

- **testnet** (`robbed-backend-testnet`): chain 46630-shape, `MODERATION_ALLOW_STUBS=true`,
  `CORS_ALLOWED_ORIGINS=https://testnet.robbed.fun`, no fees/legal (Phase A, §14).
  V3/WETH addresses come from the **testnet deploy artifact** (never assume the
  4663 constants exist on testnet — the indexer asserts at startup, fails closed).
- **production** (`robbed-backend-production`): chain 4663, `MODERATION_ALLOW_STUBS=false`,
  `CORS_ALLOWED_ORIGINS=https://robbed.fun`, V3/WETH = the §12.28 constants (inline,
  still asserted at startup). **Gate-G-A-gated (§14) — do not deploy until G-A passes.**

### Secrets — nothing committed here

Every credential is a `[[VAR]]` reference resolved from the Komodo secret store
(Core or periphery `[secrets]`, komo.do/docs/configuration/variables). Populate,
per env, before deploy (names ⇄ `env-inventory.md`): `*_POSTGRES_PASSWORD`,
`*_INDEXER_RPC_HTTP/WS`, the contract addresses, `*_SESSION_SECRET`,
`*_ADMIN_ALLOWLIST`, `R2_ENDPOINT`, `*_R2_ACCESS_KEY_ID`, `*_R2_SECRET_ACCESS_KEY`,
`*_R2_PUBLIC_BASE_URL`, and (prod) the `*_MODERATION_*_VENDOR_*` keys (OI-A7,
§13). Non-secret CONFIG (bucket `robbed-assets`, public R2 account id per §12.45,
ports) is inline. `compose.yaml` additionally uses `${VAR:?...}` so a missing
required value **fails `docker compose config`** rather than silently starting
mis-wired.

## Deploy sequence (runbook A.6)

1. Register the target server in Komodo Core (install periphery agent).
2. Sync this repo's `stack.toml` into Core; populate the `[[VAR]]` secrets/vars per env.
3. Deploy the env's Stack → periphery pulls/builds → `postgres`+`redis` healthy →
   `apimigrations` exits 0 → `indexer` (offchain migrate → `ponder start`, backfill
   from `START_BLOCK`) → `api` (HTTP) + `ws`.
4. Verify: `/v1/healthz` + `/v1/readyz` green; indexer `/health` up and head
   advancing (`/ready` 200 after backfill); WS handshake + sub/unsub; `/metrics`
   on `METRICS_PORT` (9464) exposes the gate-7 series.
5. Point the Workers frontend `NEXT_PUBLIC_*` at this Stack's public API/WS
   endpoints (behind TLS/CDN; environments.md §3/§4).

## Local static validation (no daemon needed)

```bash
# from repo root — parses + interpolates; exit 0 == valid. Requires the required
# secrets to be present in the environment (the ${VAR:?...} guards).
docker compose -f tools/deploy/komodo/compose.yaml config
```

## Not decided here (routed elsewhere)

Beta caps (O-10), Safe signers / `ADMIN_ALLOWLIST` prod values (O-6/OI-A8),
moderation vendor (OI-A7), `ETH_USD_SOURCE_URL` Chainlink-vs-fallback (OI-6),
DNS / custom domains (environments.md §4) — all §13 / owner tasks, not this Stack.
