#!/usr/bin/env bash
# ROBBED_ local validation — the single entrypoint mirroring .github/workflows/ci.yml.
# Runs from the pre-commit hook (policy: the entire CI suite runs before every
# commit) and manually via `bun run validate` / `scripts/validate.sh`.
#
# Stages skip gracefully when their service or tool doesn't exist yet, and say so —
# a skip is reported, never silent (spec §10 "no silent caps" spirit).
#
# Usage: validate.sh [--staged] [--full]
#   --staged  limits the hard-rule scan to staged files (pre-commit mode)
#   --full    additionally runs the slow stages (web production build) —
#             `bun run validate:full` is the run-everything entrypoint

set -u
cd "$(git rev-parse --show-toplevel)"

STAGED=0; FULL=0
for arg in "$@"; do
  case "$arg" in
    --staged) STAGED=1 ;;
    --full)   FULL=1 ;;
  esac
done

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; NC=$'\033[0m'
fail=0
declare -a results=()

record() { # record <status> <name> <detail>
  results+=("$1|$2|$3")
  [ "$1" = "FAIL" ] && fail=1
  case "$1" in
    PASS) echo "${GREEN}✔ $2${NC} $3" ;;
    SKIP) echo "${YELLOW}∅ $2${NC} $3" ;;
    FAIL) echo "${RED}✘ $2${NC} $3" ;;
  esac
}

run_stage() { # run_stage <name> <command...>
  local name=$1; shift
  local out
  if out=$("$@" 2>&1); then
    record PASS "$name" ""
  else
    record FAIL "$name" $'\n'"$out"
  fi
}

# ── 1. Spec hard rules (CLAUDE.md) over committed files ─────────────────────
if [ "$STAGED" = "1" ]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
else
  files=$(git ls-files)
fi
rule_fail=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  if ! printf '{"tool_input":{"file_path":"%s"}}' "$PWD/$f" | .claude/hooks/check-hard-rules.sh >/dev/null 2>&1; then
    printf '{"tool_input":{"file_path":"%s"}}' "$PWD/$f" | .claude/hooks/check-hard-rules.sh || true
    rule_fail=1
  fi
done <<< "$files"
if [ $rule_fail -eq 0 ]; then record PASS "hard-rules" ""; else record FAIL "hard-rules" "see SPEC VIOLATION lines above"; fi

# ── 2. Doc lint: links, § refs, LP copy, fences, m0 numbers, openapi ─────────
if [ -f scripts/doc-check.ts ]; then
  if command -v bun >/dev/null 2>&1; then
    run_stage "doc-check" bun scripts/doc-check.ts
  else
    record SKIP "doc-check" "(bun not on PATH — install Bun; CI still enforces it)"
  fi
else
  record SKIP "doc-check" "(no scripts/doc-check.ts yet)"
fi

# ── 2b. Env-sync: .env.example ⇄ docs/runbooks/env-inventory.md. Also runs
#        inside doc-check (check g) — the named stage exists so a drift
#        failure is attributed clearly. Self-contained block. ─────────────────
if [ -f scripts/env-sync-check.ts ]; then
  if command -v bun >/dev/null 2>&1; then
    run_stage "env-sync" bun scripts/env-sync-check.ts
  else
    record SKIP "env-sync" "(bun not on PATH — install Bun; CI still enforces it via doc-check)"
  fi
else
  record SKIP "env-sync" "(no scripts/env-sync-check.ts yet)"
fi

# ── 3. Contracts: fmt / build / tests (unit+fuzz+invariant) — §10 gates 1–2 ──
if [ -f contracts/foundry.toml ]; then
  if command -v forge >/dev/null 2>&1; then
    ( cd contracts && forge fmt --check >/dev/null 2>&1 )
    if [ $? -eq 0 ]; then record PASS "forge fmt" ""; else record FAIL "forge fmt" "run: cd contracts && forge fmt"; fi
    run_stage "forge build" bash -c 'cd contracts && forge build'
    run_stage "forge test"  bash -c 'cd contracts && forge test'
  else
    record FAIL "contracts" "forge not on PATH — install Foundry (foundryup) or open a new shell"
  fi
else
  record SKIP "contracts" "(no contracts/foundry.toml yet)"
fi

# ── 4. Slither — §10 gate 1 (zero unexplained findings) ─────────────────────
if [ -f contracts/foundry.toml ] && ls contracts/src/*.sol >/dev/null 2>&1; then
  if command -v slither >/dev/null 2>&1; then
    # MUST match CI (crytic/slither-action: target=contracts, fail-on: low) byte-for-byte:
    # run from REPO ROOT with the same target so (a) the config's triage_database/filter_paths
    # resolve (they are repo-root-relative — from contracts/ the triage DB silently fails to
    # load and every dispositioned finding resurfaces) and (b) finding IDs match the DB.
    # `--fail-low` is the CLI spelling of the action's `fail-on: low` input.
    run_stage "slither" slither contracts --config-file contracts/slither.config.json --fail-low
  else
    record SKIP "slither" "(not installed — pip3 install slither-analyzer; CI still enforces it)"
  fi
else
  record SKIP "slither" "(no contract sources yet)"
fi

# ── 5. Workspace: typecheck + unit tests (Vitest/bun test) ───────────────────
if [ -f package.json ]; then
  if grep -q '"typecheck"' package.json 2>/dev/null || ls apps/*/package.json packages/*/package.json >/dev/null 2>&1; then
    has_ts=0
    for pkg in packages/* apps/*; do
      [ -f "$pkg/package.json" ] || continue
      if grep -q '"typecheck"' "$pkg/package.json"; then
        has_ts=1
        run_stage "typecheck:$(basename "$pkg")" bash -c "cd '$pkg' && bun run typecheck"
      fi
    done
    [ $has_ts -eq 0 ] && record SKIP "typecheck" "(no package defines a typecheck script yet)"
  fi
  has_tests=0
  for pkg in packages/* apps/*; do
    [ -f "$pkg/package.json" ] || continue
    # find-based discovery: the previous `ls glob1 glob2 glob3` exited non-zero unless ALL
    # globs matched, silently skipping every package (confirmed by the commit-review workflow
    # 2026-07-11 — CI ran zero bun tests). find matches any *.test.ts at any depth.
    if find "$pkg/src" "$pkg/test" -name '*.test.ts' -type f 2>/dev/null | grep -q .; then
      has_tests=1
      run_stage "test:$(basename "$pkg")" bash -c "cd '$pkg' && bun test"
    fi
  done
  [ $has_tests -eq 0 ] && record SKIP "unit tests" "(no *.test.ts files yet)"
else
  record SKIP "workspace" "(no root package.json yet)"
fi

# ── 5b. Web unit suite (Vitest — tests/*.test.tsx, a different runner by design,
#        web.md §8; the bun-test glob above cannot discover it) ────────────────
if [ -f apps/web/vitest.config.ts ]; then
  run_stage "vitest:web" bash -c 'cd apps/web && bun run test'
else
  record SKIP "vitest:web" "(no apps/web/vitest.config.ts yet)"
fi

# ── 5c. Flow-catalog coverage — static diff of apps/web/e2e/user-flows.md IDs vs
#        @flow-tagged Playwright specs + declared assertable-layers; needs no stack ──
if [ -f scripts/e2e-coverage.ts ]; then
  run_stage "e2e:coverage" bun scripts/e2e-coverage.ts
else
  record SKIP "e2e:coverage" "(no scripts/e2e-coverage.ts yet)"
fi

# ── 5d. Web production build (SLOW — --full / validate:full only) ────────────
if [ "$FULL" = "1" ]; then
  if [ -f apps/web/next.config.ts ]; then
    run_stage "build:web" bash -c 'cd apps/web && bun run build'
  else
    record SKIP "build:web" "(no apps/web/next.config.ts yet)"
  fi
else
  record SKIP "build:web" "(--full only — run \`bun run validate:full\`)"
fi

# ── 6. E2E: Playwright against the local stack — §9 ─────────────────────────
# The flow matrix needs the running local stack (anvil :4545 via docker compose).
# Same skip-gracefully-never-silently rule as every other stage: a down stack is
# the "service doesn't exist" case, and CI's e2e job (I-6) enforces it in full.
if [ -f apps/web/playwright.config.ts ]; then
  if curl -sf -m 2 -X POST -H 'Content-Type: application/json' \
       --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
       "http://localhost:${ANVIL_PORT:-4545}" >/dev/null 2>&1; then
    run_stage "e2e (playwright)" bash -c 'cd apps/web && bunx playwright test'
  else
    record SKIP "e2e" "(local stack not running — anvil :${ANVIL_PORT:-4545} unreachable; start it with \`bun run dev:d\`. CI e2e job still enforces the matrix)"
  fi
else
  record SKIP "e2e" "(no apps/web/playwright.config.ts yet — arrives in M3)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [ $fail -ne 0 ]; then
  echo "${RED}validation FAILED${NC} — commit blocked. Fix the failures above."
  echo "(emergency bypass: SKIP_VALIDATION=1 git commit … — CI will still enforce everything)"
  exit 1
fi
echo "${GREEN}validation passed${NC}"
exit 0
