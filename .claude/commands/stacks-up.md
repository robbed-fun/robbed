---
description: Bring up all three Docker Compose stacks (robbed / robbed-testnet / robbed-mainnet) plus verify the two compose-managed Cloudflare tunnels — pre-flight env checks, deploychain-safe dev handling, per-stack health, tunnel registration + end-to-end probes, fixed report format.
allowed-tools: Bash, Read, Grep, Glob
---

Bring up and verify the full local/infra stack per `docs/runbooks/docker.md` (the canonical runbook — **read its "Bring the stack up", "Testnet stack", "Mainnet stack", and "Public exposure" sections first**; if this command and the runbook disagree, the runbook wins and the drift is reported). `$ARGUMENTS` may name a subset (`dev`, `testnet`, `mainnet`, `tunnels`); default is all, in that order. All paths below are repo-root-relative; run everything from the repo root.

The three stacks (distinct project names → distinct volumes/networks; all three run simultaneously on disjoint host-port blocks):

| Compose file | Project | Ports | Chain |
|---|---|---|---|
| `docker-compose.yml` | `robbed` | 40XX/44XX | anvil fork of 4663 (in-stack `deploychain`) |
| `docker-compose.testnet.yml` | `robbed-testnet` | 41XX | remote testnet 46630 |
| `docker-compose.mainnet.yml` | `robbed-mainnet` | 42XX | INTERIM: testnet 46630 values until the Phase-B 4663 deploy (see the mainnet compose header's swap checklist) |

## 1. Pre-flight (report missing prerequisites — NEVER fabricate values)

Check each; a missing item blocks only the stack(s) that need it, and goes in the report verbatim:

- Docker daemon up (`docker version`), Compose v2 (`docker compose version`).
- Root `.env` exists and contains (check **key names only** — it holds `DEPLOYER_PRIVATE_KEY`; never print values: `grep -oE '^[A-Z_]+=' .env`): `TESTNET_RPC_URL`, `TESTNET_CHAIN_ID` (testnet stack `${VAR:?}` guards abort without them) and `MAINNET_RPC_URL`, `MAINNET_CHAIN_ID`, `MAINNET_INDEXER_CHAIN_ID` (interim 46630 wiring). `TESTNET_RPC_WS_URL`/`MAINNET_RPC_WS_URL` are optional (HTTP-polling fallback).
- Deploy artifacts: `tools/localstack/out/testnet.env` and `tools/localstack/out/mainnet.env` exist (api + indexer fail closed without them; there is no best-effort mode). `local.env` is emitted by the dev stack's `deploychain` one-shot — its absence is fine pre-first-boot.
- Tunnel credentials in `${CLOUDFLARED_DIR:-~/.cloudflared}`: `15ec4e57-6998-4da2-8a5b-ca45c10eecba.json` (tunnel `robbed_testnet`) and `c80870d9-6ce5-40b6-a0d4-3e8e19b537b5.json` (tunnel `robbed-mainnet`). Ingress configs are in-repo: `tools/localstack/cloudflared/{testnet,mainnet}.yml`.
- Static validation: `docker compose -f <file> config --quiet` for each stack about to be started (this is also what surfaces missing `${VAR:?}` env, loudly, without starting anything).

## 2. Dev stack (`robbed`) — deploychain hazard: NEVER re-up while running

**CRITICAL:** if the dev stack is already running, do **NOT** run `up -d` (nor `compose start`) on it. Both re-run the exited `deploychain` one-shot, which redeploys contracts to the live anvil and **rewrites `tools/localstack/out/local.env` under the running indexer/api/web** (observed live; documented in `docs/runbooks/docker.md` "DB-only reset"). Decide by state:

- `docker compose -f docker-compose.yml ps --format 'table {{.Service}}\t{{.Status}}'` shows the long-running services (anvil, postgres, redis, minio, api, ws, indexer, web, apiproxy) `Up` → **verify only**, skip bring-up.
- Fully or partially down → bring up with `bun run dev:stack` (readiness-gated; first boot builds `robbed-dev` + full pnpm install, be patient — default deadline 900s). A partially-up stack is safest fully restarted: `docker compose -f docker-compose.yml down` first (contracts redeploy anyway; anvil state is ephemeral).

**Verify (either path):** `docker compose -f docker-compose.yml ps -a` — 9 long-running services `Up (healthy)`, one-shots (`deps`, `createbuckets`, `apimigrations`, `deploychain`) `Exited (0)`. Then `bun run dev:health` — must print **all 7 G-1 checks passed** (DB, Redis, chainId 0x1237, indexer head advancing, API healthz/readyz, WS round-trip, web 200).

## 3. Testnet + mainnet stacks

No deploychain exists in these files, and their one-shots (`deps`, `createbuckets`, `apimigrations`, `chaincheck`) are idempotent — `up -d` is safe whether the stack is down or already running:

```bash
docker compose -f docker-compose.testnet.yml up -d
docker compose -f docker-compose.mainnet.yml up -d
```

Wait for the indexers to leave `starting` with a **bounded** until-loop on `docker inspect -f '{{.State.Health.Status}}' robbed-testnet-indexer-1` (and `robbed-mainnet-indexer-1`) — never unbounded; Ponder `/ready` answers 200 only once backfill is caught up, so `healthy` means caught-up, not merely alive.

**Verify per stack** — `docker compose -f <file> ps -a`: all long-running services `Up (healthy)`, one-shots `Exited (0)`, **no restart loops** (a climbing restart count / `Restarting` status is a failure even if the instantaneous state looks Up). Then endpoints:

| Stack | API readyz | Ponder ready |
|---|---|---|
| testnet | `curl -s -o /dev/null -w '%{http_code}' http://localhost:4101/v1/readyz` → 200 | `http://localhost:4169/ready` → 200 |
| mainnet | `http://localhost:4201/v1/readyz` → 200 | `http://localhost:4229/ready` → 200 |

## 4. Tunnels (compose-managed cloudflared, one per remote stack)

The connectors are compose services with `restart: unless-stopped` — they usually outlive stack stops, so "container Up" alone proves nothing. Check three layers:

1. **Edge registration:** `docker logs robbed-testnet-cloudflared-1` and `docker logs robbed-mainnet-cloudflared-1` each show **4× `Registered tunnel connection`** for the current run, plus `Settings: map[config:/etc/cloudflared/config.yml …]`.
2. **Benign vs real errors:** `ERR … dial tcp: lookup web|api|ws … server misbehaving` lines are **transient and expected** while backends are down/starting (the connector outlived them). Compare timestamps: errors that stop once the recreated backends are healthy are benign; errors **continuing after** backends are `Up (healthy)` are a real failure (typically a stale network attachment — compare `docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$v.NetworkID}}{{end}}'` of connector vs backend; report before restarting anything).
3. **End-to-end probes** (hostnames per `tools/localstack/cloudflared/{testnet,mainnet}.yml` + runbook "Public exposure" — **cross-check both before probing**; hostnames changed on 2026-07-12):

| Probe | Expect | Proves |
|---|---|---|
| `https://api.robbed.fun/v1/healthz` | 200 | **mainnet tunnel** end-to-end |
| `https://api-testnet.robbed.fun/v1/readyz` | 200 | **testnet tunnel** end-to-end |
| `https://robbed.fun/` | 200 | mainnet web (served by the `robbed` **Worker** — NOT tunnel proof) |
| `https://testnet.robbed.fun/` | 200 | testnet web (flipping to the `robbed-testnet` **Worker**; tunnel keeps a STANDBY `→ web` ingress rule — NOT tunnel proof once flipped) |

`api.testnet.robbed.fun` is **deprecated** (renamed 2026-07-12 → `api-testnet.robbed.fun`; the old second-level host sits outside Universal SSL coverage and fails TLS with alert 40 — do not probe it, do not report its failure as a regression). The two web-apex probes can return 200 from the Workers with a dead tunnel — only the api-host probes and the registration logs prove tunnel health.

## 5. Failure handling

For any failing service: capture `docker compose -f <file> logs --tail 40 <service>`, diagnose briefly, and put the evidence in the report. **Do NOT change configs, env files, ingress YAMLs, or code, and do not `down -v` any stack (volumes hold backfill state), without reporting first and getting an explicit go-ahead.** Container restarts of a stuck connector are the only self-serve remediation, and even those go in the report.

## 6. Report (exact format — always produce it, even on partial failure)

```
## Stack bring-up report (<UTC timestamp>)

### Pre-flight
- <compose files validated; env prerequisites present/missing — names only, never values>

### Stack status
- **Dev (`robbed`)** — <brought up | already up, verified only (deploychain hazard)>; <N>/<N> long-running Up (healthy), one-shots Exited (0); dev:health → <7/7 | failures>
- **Testnet (`robbed-testnet`)** — <…>; api :4101 readyz <code>, ponder :4169 ready <code>
- **Mainnet (`robbed-mainnet`, interim 46630)** — <…>; api :4201 readyz <code>, ponder :4229 ready <code>

### Tunnels
- **`robbed_testnet` (15ec4e57…)**: <N>× Registered tunnel connection; https://api-testnet.robbed.fun/v1/readyz → <code>
- **`robbed-mainnet` (c80870d9…)**: <N>× Registered tunnel connection; https://api.robbed.fun/v1/healthz → <code>
- Web apexes (Worker-served, informational): https://robbed.fun → <code>, https://testnet.robbed.fun → <code>
- <transient dial-tcp errors observed: benign (timestamps predate backend health) | ONGOING → failure>

### Failures (omit section if none)
- <service>: <status> — diagnosis + log tail evidence; <what remediation is proposed, awaiting go-ahead>
```
