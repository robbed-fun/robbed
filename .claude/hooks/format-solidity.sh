#!/usr/bin/env bash
# Auto-format Solidity files on write (security-gate 1 of the 10-gate program
# requires forge fmt in CI — format at write time so CI never fails on style;
# docs/developers/threat-model.md). No-ops if forge is absent or the file isn't
# .sol. Never blocks.

set -u
input=$(cat)

if command -v jq >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
else
  file=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
fi

case "$file" in
  *.sol)
    if [ -f "$file" ] && command -v forge >/dev/null 2>&1; then
      forge fmt "$file" >/dev/null 2>&1 || true
    fi
    ;;
esac
exit 0
