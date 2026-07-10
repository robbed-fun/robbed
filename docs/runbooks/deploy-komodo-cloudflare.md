# Runbook — Backend on Komodo, Frontend on Cloudflare Workers

**Status:** v1.0, 2026-07-10. Authored by hoodpad-architect. Implements the hosting split ratified in **spec §12.45** (amends architecture.md §6). This runbook is the *plan* — buildable infra configs and the executed deploy land at implementation-plan **P-2/P-3** (Phase P); nothing here is executed at authoring time.

> **Docs-first rule (mandatory every iteration).** Before touching any config in this runbook, consult current official docs — never work from memory. Primary: context7 MCP (`resolve-library-id` → `get-library-docs`); fallback: WebFetch of the canonical pages below. Docs beat assumptions; the spec beats docs (flag the conflict, do not silently diverge).
>
> Canonical docs for this runbook:
> - Komodo — https://komo.do/docs · Stacks: https://komo.do/docs/resources#stack · Periphery agent: https://komo.do/docs/connect-servers · repo https://github.com/moghtech/komodo
> - OpenNext Cloudflare adapter — https://opennext.js.org/cloudflare · get-started: https://opennext.js.org/cloudflare/get-started · bindings: https://opennext.js.org/cloudflare/bindings
> - Cloudflare Workers — https://developers.cloudflare.com/workers · Wrangler config: https://developers.cloudflare.com/workers/wrangler/configuration · Node.js compat: https://developers.cloudflare.com/workers/runtime-apis/nodejs · R2 bindings: https://developers.cloudflare.com/workers/runtime-apis/bindings/#r2-bucket
> - `next/og` / satori — https://nextjs.org/docs/app/api-reference/functions/image-response · resvg-wasm: https://github.com/yisibl/resvg-js

## 0. Scope and hard boundaries

This is an **infra/deployment-target** decision. It changes **no** contract, indexer, or API *logic* — only where processes run and which OG raster backend ships (spec §12.45).

- **Backend → Komodo Stack:** Postgres (+`pg_trgm`), Redis, Ponder indexer (Node container, spec §8), Hono/Bun API + Bun WS fanout (`apps/api` incl. `apps/api/src/ws.ts`).
- **Frontend → Cloudflare Workers** via OpenNext (`@opennextjs/cloudflare`) — **NOT** Pages-edge.
- **Cloudflare R2 + CDN** = images + canonical metadata: bucket `robbed-assets`, account `0b1b0b8753489a11d35ee922961f6b72`.

Invariants that constrain this runbook (do not violate):
- **<500ms event-to-browser** (§8) → the WS fanout is **co-located** with Redis on the container host; it is never moved to the edge.
- **No hardcoded market metrics** (§2) — the ETH/USD poller runs in the indexer container; nothing in these configs bakes a price/TVL.
- **Bun stays the runtime/test runner** (§8/§9). Komodo runs the API/WS on Bun; the frontend still *builds* under the §12.37 Next.js 16 + React 19 pins.
- **pnpm workspaces** (§12.29): Dockerfiles install with pnpm (strict node_modules, `pnpm-lock.yaml`, `workspace:*`); no phantom deps.

---

## Part A — Komodo backend Stack

### A.1 Topology

One Komodo **Stack** (a git-synced, docker-compose-based resource) holds four services:

| Service | Image base | Notes |
|---|---|---|
| `postgres` | `postgres:17` + `pg_trgm` init SQL | Same image already used in root `docker-compose.yml` (M2-0, `docs/runbooks/docker.md`). Named volume for data. |
| `redis` | `redis:7` | Pub/sub + WS fanout + rate-limit + moderation queue. AOF persistence volume. |
| `indexer` | **Node** container (Ponder, spec §8) | Dockerfile `apps/indexer/Dockerfile`. Also hosts the confirmation tracker + ETH/USD poller (indexer.md §5.1/§9). Exposes `METRICS_PORT 9464` (gate-7 series, M2-12). |
| `api` | **Bun** container (Hono + WS) | Dockerfile `apps/api/Dockerfile`. Two entrypoints: HTTP (`src/index.ts`) + WS fanout (`src/ws.ts`) — run as two processes/replicas from the same image, or one image + two compose services. WS **must** share the host/Redis with the indexer publisher. |

There is **no `web` service here** — the frontend deploys to Cloudflare Workers (Part B). The web Dockerfile referenced by the old P-3 wording is **moot**.

### A.2 Komodo core + periphery model

- **Komodo Core** = the control plane (UI/API + its own Postgres/Mongo per Komodo docs) — runs once, on an ops host.
- **Periphery agent** = a lightweight agent installed on **each target server** that actually runs the containers; Core connects to it over the Komodo connection (see "Connect Servers"). The ROBBED_ Stack is deployed onto a server registered in Core via its periphery agent.
- **Git-synced resource:** the Stack's compose + Komodo resource definition (`.toml` or UI-defined resource) lives **in this repo** (proposed `tools/deploy/komodo/`) and Core syncs from git — infra-as-code, reviewable, no click-ops drift. This mirrors the anti-drift discipline: the compose is versioned, not hand-edited on the box.

### A.3 Env / secret handling

- Secrets (RPC URL/key, Postgres password, R2 access keys, `SESSION_SECRET`, moderation vendor keys) are **Komodo-managed** (Core secret store / periphery `.env`), injected into the Stack at deploy — **never committed**. The repo carries only `.env.example` (already present) as the inventory; the authoritative per-var table is `docs/runbooks/env-inventory.md` (P-1).
- The compose references secrets via `${VAR}` interpolation resolved by Komodo — the committed compose has **no secret values**.
- R2 credentials: the API writes to `robbed-assets` with its own credentials (API-mediated upload, §12.19) — these are backend secrets, distinct from the Workers R2 *binding* in Part B.

### A.4 Build-on-Komodo vs prebuilt images

Two supported models — pick per service in P-3, record the choice in the Stack resource:

- **Build-on-Komodo (git → build → run):** Komodo pulls the repo and builds the image on the periphery host from the service Dockerfile. Simplest ops surface; no external registry. Good default for `indexer` and `api`.
- **Prebuilt images (CI → registry → pull):** GitHub Actions builds + pushes to a registry (GHCR), Komodo pulls the tag. Better for reproducibility/rollback and faster deploys once CI exists (Phase I is where CI first runs). Recommended once the caps-lift path needs auditable image digests.

Both must produce **the same** pnpm-workspace-correct image (A.5). Start with build-on-Komodo for P-3; graduate to prebuilt for the M4 capped-beta if rollback-by-digest is wanted.

### A.5 Dockerfile shape (pnpm workspaces, §12.29)

Both service Dockerfiles are **multi-stage** and workspace-aware (build context = repo root so `pnpm-lock.yaml` + `packages/shared` are available):

- **`apps/indexer/Dockerfile` (Node):** `node:22` base; `corepack enable` for pnpm; copy `pnpm-lock.yaml` + `pnpm-workspace.yaml` + package manifests, `pnpm install --frozen-lockfile --filter @robbed/indexer...` (with workspace deps), copy source, `pnpm --filter @robbed/indexer run build` if a build step exists; entry runs Ponder. `typecheck` in CI is `ponder codegen && tsc --noEmit` (§12.42) — not a runtime concern but keep codegen reproducible.
- **`apps/api/Dockerfile` (Bun):** `oven/bun:1.3.14` base (pin matches toolchain); pnpm for install (strict node_modules), Bun as the runtime (`bun run src/index.ts` / `bun run src/ws.ts`). Do not let Bun's own installer flatten node_modules — install with pnpm to preserve the anti-drift strictness, run with Bun.
- Health: `indexer` head-advancing + `/metrics`; `api` `GET /v1/healthz` (liveness) + `/v1/readyz` (DB+Redis+R2, api.md §3). Compose `healthcheck` per service; Komodo surfaces status.

`docker build` must exit 0 for both images — the P-3 verification leg.

### A.6 Deploy sequence (Komodo)

1. Register the target server in Komodo Core (install periphery agent).
2. Point Core at the git-synced Stack resource (`tools/deploy/komodo/`).
3. Populate Komodo secrets from `env-inventory.md`.
4. Deploy the Stack: Core → periphery pulls/builds → `postgres`+`redis` up (healthy) → `indexer` (backfill from `START_BLOCK`, deploy artifacts from M1) → `api` HTTP + WS.
5. Verify: `/v1/healthz`+`/v1/readyz` green; indexer head advancing; WS handshake+sub/unsub; `/metrics` exposes gate-7 series (M2-12).
6. Point the Workers frontend (Part B) `NEXT_PUBLIC_*` API/WS URLs at this Stack's public endpoints (behind TLS/CDN).

### A.6b P-3 status — configs landed (2026-07-10)

The buildable infra from this Part A is now committed (implementation-plan **P-3**, owner hoodpad-indexer):

- `apps/indexer/Dockerfile` — multi-stage `node:22-bookworm-slim`; corepack `pnpm@10.33.0`; build context = repo root; `pnpm install --frozen-lockfile --filter @robbed/indexer...`; `ponder codegen` (build-only placeholder env, discarded); `pnpm deploy --legacy --prod` bundle; runtime stage runs offchain `migrate` → `ponder start` under **Node**, with a copied `bun` binary used **only** to run the two TypeScript side-scripts (`migrate`/`rebuild`). Non-root (`node`). `EXPOSE 9464 42069`.
- `apps/api/Dockerfile` — build stage on `node:22-bookworm-slim` (pnpm install, strict node_modules) → runtime on **`oven/bun:1.3.14`** (Bun runtime, spec §8/§9). One image, two entrypoints: default `CMD` = HTTP (`src/index.ts`); the `ws` compose service overrides `command` to `src/ws.ts` (build-arg `APP_ENTRY` alternative documented). Non-root (`bun`). `EXPOSE 3001 3002`.
- `.dockerignore` (repo root) — excludes `**/node_modules`, `.git`, `**/.next`, `apps/web/.open-next`, `**/.ponder`, contract artifacts, `**/.env*` (keeps `.env.example`), `bun.lock`, docs.
- `tools/deploy/komodo/` — `compose.yaml` (postgres:17 +pg_trgm init, redis:7, indexer, api, ws, one-shot apimigrations; healthchecks + `depends_on` + named volumes; secrets via `${VAR}`/`${VAR:?}`, zero committed values), `stack.toml` (git-synced `robbed-backend-testnet` + `robbed-backend-production` Stacks, `[[VAR]]` secret interpolation, `ignore_services=["apimigrations"]`), and a `README.md` (periphery model, entrypoint strategy, GIN-index nuance, per-env).

**Verification (2026-07-10):** `docker compose -f tools/deploy/komodo/compose.yaml config` exits 0 (build context resolves to repo root; ws `command` override, healthchecks, and `${VAR:?}` fail-closed guards all confirmed); `stack.toml` parses; the pnpm filter/context logic matches the workspace layout. **ENV-GATED / DEFERRED — no Docker daemon in the authoring environment:** `docker build` for both images and `docker compose up` (A.5 "`docker build` must exit 0" leg + A.6 live deploy) were **not** run; `hadolint` is not installed. Re-run these on a daemon-having host before first deploy.

### A.7 What this runbook does NOT decide

- Beta cap values (O-10), Safe signers (O-6), moderation vendor (OI-A7) — §13, NEEDS-USER, out of Phase-A goal.
- The unify-metrics-surface question (M2-12 flag: `/metrics` on `9464` vs API port) — an M4 ops call, not changed here.
- RPC failover / Ponder re-index / seq-reset heal — the pre-M4 operations runbooks (P-4, findings Bucket 6).

---

## Part B — Cloudflare Workers frontend (OpenNext)

### B.1 Adapter + version gate (docs-first, load-bearing)

Deploy Next.js 16 (§12.37) to Workers with `@opennextjs/cloudflare`. As of 2026-07-10 the adapter states it supports **all minor/patch versions of Next.js 16** (opennext.js.org/cloudflare). **Standing caveat:** re-verify Next.js 16 support against the adapter's live compatibility matrix at implementation time — adapters can lag a Next major. **If the pinned Next 16 minor is unsupported by the current adapter, that is a deploy blocker to surface (to the architect), not to work around** (do not downgrade the §12.37 pin silently).

### B.2 `wrangler.jsonc` (in `apps/web`)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "main": ".open-next/worker.js",
  "name": "robbed",
  "compatibility_date": "2025-05-05",           // recent date; bump as adapter docs advise
  "compatibility_flags": ["nodejs_compat"],      // MANDATORY for OpenNext SSR on workerd
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "services": [{ "binding": "WORKER_SELF_REFERENCE", "service": "robbed" }],
  "r2_buckets": [
    { "binding": "ASSETS_R2", "bucket_name": "robbed-assets" }   // images + metadata read; account 0b1b0b8753489a11d35ee922961f6b72
  ]
}
```

Notes:
- `nodejs_compat` + a `compatibility_date` ≥ the adapter's floor are non-negotiable — OpenNext's server shim needs Node APIs.
- The R2 binding here is for the **frontend's** access to `robbed-assets` (e.g. reading metadata/images at SSR/OG time). The **write** path (uploads) stays on the Komodo API (§12.19) — the Worker never accepts raw uploads.
- Public runtime vars (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, chain 4663 config) are Worker vars/secrets pointing at the Komodo Stack endpoints (A.6 step 6).

### B.3 `open-next.config.ts` (in `apps/web`)

```typescript
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
// Optional: R2 incremental cache override if ISR/caching is used.
// import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

export default defineCloudflareConfig({
  // incrementalCache: r2IncrementalCache,   // enable only if a cache bucket is provisioned
});
```

ROBBED_'s three pages are SSR/live-read heavy (Trust panel reads on-chain live, §5.2) — ISR/incremental cache is largely N/A; keep the config minimal and add the R2 cache override only if a caching need appears.

### B.4 `next.config.ts` dev hook (in `apps/web`)

```typescript
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
// ...existing NextConfig...
initOpenNextCloudflareForDev();   // exposes CF bindings during `next dev`
```

### B.5 `package.json` scripts (in `apps/web`)

```json
{
  "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
  "deploy":  "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
  "cf-typegen": "wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts"
}
```

`next build` stays as `build`; OpenNext wraps it. Deploy = `opennextjs-cloudflare build && opennextjs-cloudflare deploy`. `cf-typegen` generates `cloudflare-env.d.ts` so the `ASSETS_R2` binding is typed.

### B.6 OG rendering: native → WASM (supersedes M3-8 for this target)

`workerd` **cannot load native N-API addons**, so `@resvg/resvg-js` (chosen at implementation-plan M3-8) is unrunnable on Workers. Swap the raster backend to a **WASM path**:

- **Preferred:** `@resvg/resvg-wasm` + `satori` in the OG route — keeps the existing satori layout code (web.md §6 content is unchanged: sparkline from `candles?from=&to=`, mcap ETH-first, progress, brand mark). Only the rasteriser and its init change (WASM module must be initialised once).
- **Alternative:** Next `ImageResponse` / `next/og` (ships a WASM resvg internally) — viable if it behaves under OpenNext/workerd; verify at impl time (mirrors the old web-7 runtime check, now retargeted from Bun-self-host to workerd).
- **Remove** the native dep: delete `@resvg/resvg-js` from `apps/web` deps and drop it from `serverExternalPackages` in `next.config` (that entry existed to keep the native addon external — no longer needed).

This is spec §12.45's required frontend consequence; layout unchanged, raster backend swapped.

### B.7 Deploy sequence (Workers)

1. `pnpm --filter @robbed/web run cf-typegen` (types for bindings).
2. `pnpm --filter @robbed/web run preview` — local `workerd` smoke: `/`, `/t/[address]`, `/launch`, and the OG route return 200 / `image/png` 1200×630 (the M3-8 assertion, now on the WASM backend).
3. Set Worker secrets/vars (`NEXT_PUBLIC_*` → Komodo Stack endpoints).
4. `pnpm --filter @robbed/web run deploy`.
5. Bind `robbed-assets` (`ASSETS_R2`) and confirm the custom domain / CDN route.
6. Post-deploy: OG image renders on a shared link; Trust-panel live reads hit chain 4663 via viem; WS connects to the Komodo WS endpoint (<500ms budget observed end-to-end).

### B.8 Owner / handoff

The Workers adaptation (OpenNext config + wrangler + OG→WASM + native-resvg removal) is **hoodpad-frontend**, executed **after** the concurrent `apps/web` redesign lands (do not edit `apps/web` while the redesign owns it). The Komodo Dockerfiles + Stack are **hoodpad-indexer** (owner of root compose / infra runbooks per implementation-plan P-9). See the two task specs in the delivering report.
