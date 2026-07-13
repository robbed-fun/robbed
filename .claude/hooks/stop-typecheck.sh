#!/usr/bin/env bash
# Stop hook: typecheck every workspace touched in the working tree before the
# agent finishes its turn — the cheap layer only (tsc --noEmit / forge build);
# full tests stay in validate.sh + CI. Exit 2 feeds failures back so type
# errors get fixed before stopping; stop_hook_active guards against loops.
# Tools that aren't installed skip silently — CI still enforces everything.

set -u
input=$(cat)

if command -v jq >/dev/null 2>&1; then
  active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false')
else
  active=$(printf '%s' "$input" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("stop_hook_active", False)).lower())' 2>/dev/null)
fi
[ "$active" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" 2>/dev/null || exit 0

changed=$( { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | sort -u )
[ -z "$changed" ] && exit 0

declare -A targets=()
while IFS= read -r f; do
  case "$f" in
    contracts/*.sol|contracts/foundry.toml) targets[contracts]=1 ;;
    apps/web/*)         targets[apps/web]=1 ;;
    apps/api/*)         targets[apps/api]=1 ;;
    apps/indexer/*)     targets[apps/indexer]=1 ;;
    apps/keeper/*)      targets[apps/keeper]=1 ;;
    packages/shared/*)  targets[packages/shared]=1 ;;
  esac
done <<< "$changed"
[ "${#targets[@]}" -eq 0 ] && exit 0

fail=0; out=""
for t in "${!targets[@]}"; do
  if [ "$t" = "contracts" ]; then
    command -v forge >/dev/null 2>&1 || continue
    if ! r=$(cd contracts && forge build 2>&1); then
      out+="[contracts] forge build failed:"$'\n'"$r"$'\n'; fail=1
    fi
  else
    command -v bun >/dev/null 2>&1 || continue
    if ! r=$(cd "$t" && bun run typecheck 2>&1); then
      out+="[$t] typecheck failed:"$'\n'"$r"$'\n'; fail=1
    fi
  fi
done

if [ "$fail" -ne 0 ]; then
  printf '%s\n' "$out" >&2
  exit 2
fi
exit 0
