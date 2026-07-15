#!/usr/bin/env bash
# Run a network-specific compose stack with its matching gitignored env file.
#
# Preferred files:
#   config/env/testnet.env
#   config/env/mainnet.env
#
# Optional raw-secret files outside the repo:
#   ~/.config/robbed/testnet.secrets.env
#   ~/.config/robbed/mainnet.secrets.env
#
# If the split file is not present yet, this falls back to the legacy root .env so
# existing local setups keep working during migration.
set -euo pipefail

usage() {
  echo "usage: bash scripts/compose-env.sh <testnet|mainnet> <compose args...>" >&2
}

if [ "$#" -lt 2 ]; then
  usage
  exit 2
fi

network="$1"
shift

case "$network" in
  testnet | mainnet) ;;
  *)
    usage
    echo "unknown network: $network" >&2
    exit 2
    ;;
esac

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

env_file="config/env/${network}.env"
compose_file="docker-compose.${network}.yml"
upper_network="$(printf '%s' "$network" | tr '[:lower:]' '[:upper:]')"
secrets_env_var="ROBBED_${upper_network}_SECRETS_ENV"
default_secrets_file="${HOME:-}/.config/robbed/${network}.secrets.env"
secrets_file="${!secrets_env_var:-$default_secrets_file}"

args=(docker compose)
if [ -f "$env_file" ]; then
  prefix="${upper_network}_"
  conflicts=()
  while IFS='=' read -r key _; do
    case "$key" in
      "" | "#"*) continue ;;
    esac
    if [[ "$key" == "$prefix"* || "$key" == "DEPLOYER_ADDRESS" || "$key" == "NEXT_PUBLIC_"* ]] && [ "${!key+x}" = "x" ]; then
      conflicts+=("$key")
    fi
  done <"$env_file"
  if [ "${#conflicts[@]}" -gt 0 ]; then
    echo "[compose-env] warning: exported shell vars override $env_file: ${conflicts[*]}" >&2
  fi
  args+=(--env-file "$env_file")
  if [ -n "$secrets_file" ] && [ -f "$secrets_file" ]; then
    args+=(--env-file "$secrets_file")
  fi
elif [ -f ".env" ]; then
  echo "[compose-env] $env_file not found; falling back to legacy root .env" >&2
else
  echo "[compose-env] $env_file not found and no legacy .env exists." >&2
  echo "[compose-env] Copy config/env/${network}.env.example to $env_file and fill it." >&2
  exit 1
fi

args+=(-f "$compose_file" "$@")
exec "${args[@]}"
