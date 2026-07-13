#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-command e2e (owner: robbed-e2e).  `pnpm run e2e`
#
# Brings up EVERYTHING the Playwright suite needs and runs it against the live
# stack, then reports.  Concretely:
#   1. `docker compose up -d` the DEV project (docker-compose.yml, ports 40xx) in
#      E2E MODE — anvil fork of Robinhood Chain 4663 + deploychain (deploys the
#      current-tree contracts + emits tools/localstack/out/local.env) + postgres/
#      redis/minio + api + ws + indexer + keeper + an e2e-mode web (the wagmi
#      `mock` connector replaces the real wallet, strictly behind NEXT_PUBLIC_E2E).
#   2. Wait until anvil (chainId 4663) + api /v1/healthz + web + indexer /ready
#      are all up (poll, never sleep-and-hope).
#   3. Run the full `@flow` suite via Playwright, forwarding any extra args
#      (e.g. `pnpm run e2e -- --grep @flow:TD-6`).
#
# This wrapper is the ONLY thing that starts the stack.  playwright.config.ts
# still POINTS AT a running stack and NEVER spawns one (I-5a) — the harness
# `test.skip()`s with a clear message if the stack is somehow unreachable, so a
# false green is impossible.
#
# It touches ONLY the default `robbed` compose project — the mainnet (:42xx) and
# testnet (:41xx) stacks are separate projects and are never affected.
#
# Env:
#   E2E_FRESH=1   recreate from a clean slate first (down + drop the pg/redis/minio
#                 data volumes so the indexer re-indexes from the fresh fork) — use
#                 for a deterministic full-suite run; slower.
#   E2E_NO_UP=1   skip bringing the stack up (assume it is already running) and
#                 just wait-for-ready + run — fast iteration against a warm stack.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f docker-compose.yml)

# Anvil dev accounts 0..3 (creator / treasury / trader / trader2) — the public
# Foundry mnemonic accounts, funded + unlocked on the fork (NOT secrets). The
# e2e-mode web mounts one wagmi `mock` connector per address in this exact order
# (apps/web/e2e/harness/config.ts ROLE_INDEX).
export NEXT_PUBLIC_E2E=true
export NEXT_PUBLIC_MOCK_DATA=false
export NEXT_PUBLIC_E2E_ACCOUNTS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266,0x70997970C51812dc3A010C7d01b50e0d17dc79C8,0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,0x90F79bf6EB2c4f870365E785982E1f101E93b906

# Host ports (compose defaults) — the harness reads these E2E_* with the same
# defaults (apps/web/e2e/harness/config.ts), so they need not be exported; kept
# explicit here so an overridden compose port stays in lockstep with the suite.
WEB_URL="${E2E_WEB_URL:-http://localhost:4000}"
API_URL="${E2E_API_URL:-http://localhost:4001}"
RPC_URL="${E2E_RPC_URL:-http://localhost:4545}"
PONDER_URL="${E2E_PONDER_URL:-http://localhost:4269}"

if [[ "${E2E_FRESH:-}" == "1" ]]; then
  echo "▶ E2E_FRESH=1 — clean recreate (drop pg/redis/minio data; keep node_modules)…"
  "${COMPOSE[@]}" down --remove-orphans || true
  docker volume rm robbed_robbed_pgdata robbed_robbed_redisdata robbed_robbed_miniodata 2>/dev/null || true
fi

if [[ "${E2E_NO_UP:-}" != "1" ]]; then
  echo "▶ bringing up the dev stack in e2e mode (docker compose up -d)…"
  "${COMPOSE[@]}" up -d
fi

# ── wait for readiness (poll — never a blind sleep) ──────────────────────────
wait_for() {
  local name="$1" url="$2" want="$3" tries="${4:-90}" i code
  printf '  waiting for %s … ' "$name"
  for ((i = 0; i < tries; i++)); do
    if [[ "$name" == "anvil" ]]; then
      code=$(curl -s "$url" -H 'content-type: application/json' \
        --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' 2>/dev/null | grep -o '0x1237' || true)
      [[ -n "$code" ]] && { echo "ok (chainId 4663)"; return 0; }
    else
      code=$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)
      [[ "$code" == "$want" ]] && { echo "ok"; return 0; }
    fi
    sleep 5
  done
  echo "TIMEOUT"; return 1
}

echo "▶ waiting for the stack to be healthy…"
wait_for anvil   "$RPC_URL"                 ""    120
wait_for api     "$API_URL/v1/healthz"      200   120
wait_for web     "$WEB_URL"                 200   120
wait_for indexer "$PONDER_URL/ready"        200   120

echo "▶ running the Playwright suite…"
# Invoke Playwright directly from apps/web (bunx) — routing through `pnpm exec`
# mangles forwarded args (a stray `--` makes Playwright treat flags as test-path
# filters → "No tests found"). `$@` forwards any extra args verbatim, e.g.
#   pnpm run e2e -- --grep @flow:TD-6
cd apps/web
exec bunx playwright test "$@"
