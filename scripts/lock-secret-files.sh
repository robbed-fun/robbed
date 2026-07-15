#!/usr/bin/env bash
# Best-effort OS permission hardening for local secret files.
#
# This protects against other OS users/processes. It does not create an LLM
# access boundary when Codex runs as the same Unix user. For production keys, use
# a hardware wallet or encrypted Foundry keystore and never store raw keys in the
# workspace.
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

lock_dir() {
  [ -d "$1" ] || return 0
  chmod 700 "$1"
  echo "locked dir  $1"
}

lock_file() {
  [ -f "$1" ] || return 0
  chmod 600 "$1"
  echo "locked file $1"
}

warn_raw_key_file() {
  [ -f "$1" ] || return 0
  if grep -Eq '(^|_)(PRIVATE_KEY|MNEMONIC)=' "$1"; then
    echo "WARNING: $1 contains raw-key-style env vars. Move production keys to a hardware wallet or encrypted Foundry keystore." >&2
  fi
}

lock_dir "config/env"
lock_dir "tools/localstack/out"

lock_file ".env"
warn_raw_key_file ".env"

for f in config/env/*.env; do
  [ -e "$f" ] || continue
  lock_file "$f"
  warn_raw_key_file "$f"
done

for f in tools/localstack/out/*secret* tools/localstack/out/*signer* tools/localstack/out/*key*; do
  [ -e "$f" ] || continue
  lock_file "$f"
  warn_raw_key_file "$f"
done

if [ -d "$HOME/.foundry" ]; then
  lock_dir "$HOME/.foundry"
fi
if [ -d "$HOME/.foundry/keystores" ]; then
  lock_dir "$HOME/.foundry/keystores"
  for f in "$HOME"/.foundry/keystores/*; do
    [ -f "$f" ] || continue
    lock_file "$f"
  done
fi
