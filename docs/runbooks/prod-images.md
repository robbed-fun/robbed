# Runbook — Production images + gate-7 monitoring configs (P-3)

**Status:** v1.0, 2026-07-11 (hosting refs updated 2026-07-12: the Komodo runbook is retired, §12.45). Owner: robbed-indexer (infra runbooks per plan item P-9). The hosting split is spec §12.45 (backend on the compose stacks + Cloudflare Tunnels; web on Cloudflare Workers) — this file records what P-3 actually **built and verified**: the production container images, the prod compose set, and the gate-7 monitoring/alert configs (spec §10 gate 7, `docs/how-it-works/indexer.md` §9.4).

## 1. Image inventory + path decision

| Image | Dockerfile | Base (pinned) | Runtime | Runs as |
|---|---|---|---|---|
| `robbed-indexer` | `apps/indexer/Dockerfile` | build+runtime `node:22.22.0-bookworm-slim` (+ `bun` 1.3.14 binary for the two side-scripts only) | **Node** (Ponder, spec §8) | `node` |
| `robbed-api` (serves both `api` and `ws`) | `apps/api/Dockerfile` | build `node:22.22.0-bookworm-slim` (pnpm install), runtime `oven/bun:1.3.14` | **Bun** (Hono API + WS fanout, spec §8/§9) | `bun` |
| web | **no image — N/A** | — | Cloudflare Workers | — |

**Decision — Dockerfiles stay at `apps/*/Dockerfile`, not `docker/`.** They landed there at d8f7c20 and are load-bearing `build.dockerfile` references in the prod compose set. Moving them to `docker/` would churn consumers for zero behavior; `docker/` keeps the shared dev image, postgres init SQL, and (new) `monitoring/`. Build context for both prod images is the **repo root** (pnpm workspace + lockfile + `packages/shared`).

**Decision — no web container.** spec §12.45 establishes Cloudflare Workers (OpenNext) as the canonical web deploy; `apps/web/wrangler.jsonc` + `apps/web/open-next.config.ts` exist and the Worker is deployed (robbed.fun, d8f7c20). The old P-3 wording's "web on Bun" container is **moot** (there is no `web` service in the backend stack); building one anyway would create an unmaintained second prod path. The web "manifest" is `apps/web/wrangler.jsonc` + the `deploy:cf` scripts.

**Pinned bases** (docs-first, tags verified against the registry 2026-07-11): `node:22.22.0-bookworm-slim` — exact pin = the recorded toolchain Node (`toolchain.md`); `oven/bun:1.3.14` — the repo toolchain Bun pin; `prom/prometheus:v3.5.0` (LTS line); `prom/alertmanager:v0.28.1`; `postgres:17` / `redis:7-alpine` unchanged from the Stack.

Both Dockerfiles now also carry an image-level `HEALTHCHECK` (host-agnostic default; the Komodo compose services override with their own probes — the `ws` service **must**, since it overrides `command` rather than `APP_ENTRY`).

## 2. Build fixes required (2026-07-11) — why the first builds failed

The A.6b verification was deferred ("no Docker daemon"); running it live surfaced two real breaks, fixed in the Dockerfiles (build stages only, runtime unchanged):

1. **node-gyp toolchain missing.** Root `package.json` whitelists `bufferutil` / `utf-8-validate` in `pnpm.onlyBuiltDependencies`, so pnpm compiles them (ws accelerators used by viem/ponder websockets) — and `*-slim` has no `python3`/`make`/`g++`. → installed in the build stage.
2. **Root `prepare` hook needs git + a repo.** `prepare: git config core.hooksPath .githooks` runs on any workspace install; the image has no git and `.git` is dockerignored. → build stage installs `git` and runs `git init -q .` in the workdir so the hook succeeds harmlessly.

## 3. Verification (live, 2026-07-11, Docker 29.4.3)

```
$ docker build -f apps/indexer/Dockerfile -t robbed-indexer:p3 .   # exit 0
$ docker build -f apps/api/Dockerfile     -t robbed-api:p3     .   # exit 0
$ docker compose -f tools/deploy/komodo/compose.yaml \
                 -f tools/deploy/komodo/compose.monitoring.yaml config --quiet   # exit 0 (placeholder env)
$ promtool check config docker/monitoring/prometheus.yml           # SUCCESS
$ promtool check rules  docker/monitoring/rules/gate7.rules.yml    # SUCCESS: 13 rules found
$ amtool  check-config  docker/monitoring/alertmanager.yml         # SUCCESS
```

Smoke: `robbed-indexer:p3` → `node v22.22.0`, `bun 1.3.14`, user `node`; `robbed-api:p3` → `bun 1.3.14`, user `bun`. Image content sizes ≈160MB (indexer) / ≈124MB (api).

## 4. Gate-7 monitoring configs

| File | Purpose |
|---|---|
| `docker/monitoring/prometheus.yml` | Scrape config — one target: indexer `/metrics` on `METRICS_PORT` 9464 (M2-12 server merges in-process registry + DB-derived snapshot at scrape time) + Prometheus self-scrape for `up`. |
| `docker/monitoring/rules/gate7.rules.yml` | 13 alert rules for the indexer.md §9.4 series. Threshold provenance labeled per rule: **SPEC'D** (head lag >10s; publish p95 >300ms; metadata mismatch >0; fee-recipient mismatch; fee-ceiling breach; graduation double-fire; ETH/USD age >5m), **M0** (cluster-share breach gauges bake `constants.json.governance.clusterAlertThresholds` 25/10/24h — rules key off the breach gauge so retuning never edits this file, spec §2), **PLACEHOLDER `tuning: placeholder`** (confirmation-watermark stall via lag-derivative ≈ head rate; scrape-down; sustained Redis publish errors; 6h unfetched-metadata backlog) — tuned at M4 with robbed-security. |
| `docker/monitoring/alertmanager.yml` | Grouping/dedup only; default receiver has **no integrations** — indexer.md §9.4: delivery mechanism is an M4 infra choice. Replace the placeholder receiver at M4. |
| `tools/deploy/komodo/compose.monitoring.yaml` | Host-agnostic overlay (Prometheus + Alertmanager, pinned, healthchecked, localhost-bound host ports by default). Merge: `docker compose -f tools/deploy/komodo/compose.yaml -f tools/deploy/komodo/compose.monitoring.yaml up -d` (lives beside `compose.yaml` because relative paths in an overlay resolve against the first `-f` file's directory). On k8s: mount the same three config files as ConfigMaps. |

indexer.md §9.4 series **not yet emitted** (config cannot alert on them; flagged, not worked around): `ws_connected_clients` (the Bun WS fanout exposes no metrics endpoint) and the per-token `real_eth_reserves` vs on-chain balance spot-check sampler. Both are indexer/API source work (M4-adjacent), tracked for robbed-architect prioritization.

## 5. FINDING — indexer Redis publish transport no-ops under the Node container (real bug, open)

`apps/indexer/src/publish.ts` (`createBunPublisher`) and `apps/indexer/src/sidecar.ts` (`createReverifySubscriber`) use **`globalThis.Bun.RedisClient`** and degrade to logged no-ops when it is absent. The sidecars are wired from a Ponder `:setup` handler (`src/handlers/setup.ts`), i.e. they run **inside the Ponder process**, which the production image runs under **Node** (`ponder start`, spec §8: "Ponder runs in a Node container"). The `bun` binary copied into the image executes only the two side-scripts (`migrate`/`rebuild`) as separate short-lived processes — it does **not** put `Bun` into Ponder's globals.

**Consequence under `robbed-indexer` as built:** every realtime WS publish (trade / candle / launch / graduated / fee_collected via the handler helpers, **plus** the `global:confirmations` watermark broadcast, reorg notices, and `metadata_verified` events from the tracker/verifier) is silently dropped; the `control:reverify` admin seam is inert. Clients would degrade to REST-heal permanently — the §8 <500ms WS budget is structurally unmet, and `redis_publish_errors_total` stays at 0 (no-op ≠ error), so **monitoring does not catch it**. This was pre-flagged in the module comments (M2-8) as an infra decision; the honest container cannot fix it, because the publisher lives in Ponder's process, not a sidecar process bun could host.

**Resolution needed (apps source — out of P-3 scope, not patched here):** add a Node-compatible Redis client to `apps/indexer` (e.g. `redis`/`ioredis`) and make `getDefaultPublisher()` + the reverify subscriber prefer it (or select by runtime), keeping the hot-path constraints (no DB reads, fire-and-forget). Running Ponder itself under Bun is **not** an acceptable dodge (spec §8). Escalated to robbed-architect for ratification of the dependency addition; implementation is robbed-indexer's once ratified.

## 6. Cross-references

- Hosting (§12.45): backend on the compose stacks (`docker.md`, `deploy.md` §3) + Cloudflare Tunnels; web on Cloudflare Workers (OpenNext). The former Komodo runbook is retired; its "docker build … DEFERRED" note is superseded by §3 above.
- Mainnet-prep checklist: `docs/runbooks/deploy.md` §3 (hosting) and §3.2 (monitoring bring-up — now satisfiable with the §4 files).
- Env vars: `docs/runbooks/env-inventory.md`; dev stack: `docs/runbooks/docker.md`.
