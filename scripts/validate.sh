#!/usr/bin/env bash
# ROBBED_ local validation — the single entrypoint mirroring .github/workflows/ci.yml.
# Runs from the pre-commit hook (policy: the entire CI suite runs before every
# commit) and manually via `bun run validate` / `scripts/validate.sh`.
#
# Stages skip gracefully when their service or tool doesn't exist yet, and say so —
# a skip is reported, never silent (spec §10 "no silent caps" spirit).
#
# Usage: validate.sh [--staged]   (--staged limits the hard-rule scan to staged files)

set -u
cd "$(git rev-parse --show-toplevel)"

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
if [ "${1:-}" = "--staged" ]; then
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
    run_stage "slither" bash -c 'cd contracts && slither . --config-file slither.config.json'
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
    if ls "$pkg"/src/**/*.test.ts "$pkg"/test/*.test.ts "$pkg"/src/*.test.ts >/dev/null 2>&1; then
      has_tests=1
      run_stage "test:$(basename "$pkg")" bash -c "cd '$pkg' && bun test"
    fi
  done
  [ $has_tests -eq 0 ] && record SKIP "unit tests" "(no *.test.ts files yet)"
else
  record SKIP "workspace" "(no root package.json yet)"
fi

# ── 6. E2E: Playwright against the local stack — §9 ─────────────────────────
if [ -f apps/web/playwright.config.ts ]; then
  run_stage "e2e (playwright)" bash -c 'cd apps/web && bunx playwright test'
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
