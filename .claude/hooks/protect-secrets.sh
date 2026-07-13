#!/usr/bin/env bash
# PreToolUse guard for Bash: blocks reads of secret material and destructive
# commands that the permission globs can't see inside a shell string. Exit 2
# blocks the call and feeds the message back to the agent; exit 0 passes.
# High-precision rules only — the committed .env.example / apps/web/.env.mainnet|
# testnet|production build configs stay fully accessible.

set -u
input=$(cat)

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
else
  cmd=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)
fi
[ -z "$cmd" ] && exit 0

deny() { echo "BLOCKED by protect-secrets hook: $1" >&2; exit 2; }

# 1. Secret material — raw .env / .env.local (private keys live there, e.g.
#    KEEPER_PRIVATE_KEY), deploy creds, keystores, key files. Only block when a
#    read-capable command appears; writing/copying INTO .env (cp .env.example
#    .env) stays allowed.
secret_re='(^|[ /"'"'"'=])\.env(\.local)?($|[ "'"'"';)])|deployer\.json|keystore/|[^ "'"'"']*\.pem\b|(^|[ /])id_(rsa|ed25519)\b'
reader_re='\b(cat|less|more|head|tail|bat|strings|base64|xxd|od|grep|rg|awk|sed|cut|sort|source|scp|curl|python3?|node|bun)\b'
if printf '%s' "$cmd" | grep -qE "$secret_re" && printf '%s' "$cmd" | grep -qE "$reader_re"; then
  deny "reading secret material (.env/.env.local, deployer.json, keystore/, key files). Use .env.example for shape — never read or print real env files."
fi

# 2. Recursive force-delete aimed at root/home/repo-wide targets. Scoped
#    cleanups (rm -rf node_modules, rm -rf apps/web/.next) stay allowed.
if printf '%s' "$cmd" | grep -qE '\brm\s+(-[a-zA-Z]+\s+)*-[a-zA-Z]*([rR][a-zA-Z]*f|f[a-zA-Z]*[rR])'; then
  if printf '%s' "$cmd" | grep -qE '\brm\s[^|;&]*( /($|[ "'"'"'])|~/?($|[ "'"'"'])|\$HOME|\.\.(/|$| )|(^|\s)\*($|\s)|\.git($|[ "'"'"']))'; then
    deny "recursive force-delete aimed at a root/home/parent/repo-wide path."
  fi
fi

# 3. Raw destructive SQL from the shell — schema changes go through migrations
#    (apps/indexer scripts / the compose apimigrations one-shot).
if printf '%s' "$cmd" | grep -qiE 'psql[^|;&]*(drop\s+(table|database|schema)|truncate\s+)'; then
  deny "raw destructive SQL via psql — schema changes go through migrations."
fi

exit 0
