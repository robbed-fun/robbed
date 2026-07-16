#!/usr/bin/env bash
# Drop only the network-specific Ponder schema after a Ponder app/build
# fingerprint change. Leaves public offchain/API tables and ponder_sync RPC
# cache intact.
set -euo pipefail

usage() {
  echo "usage: bash scripts/reset-ponder-schema.sh <testnet|mainnet>" >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

network="$1"
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

upper_network="$(printf '%s' "$network" | tr '[:lower:]' '[:upper:]')"
env_file="config/env/${network}.env"
secrets_env_var="ROBBED_${upper_network}_SECRETS_ENV"
default_secrets_file="${HOME:-}/.config/robbed/${network}.secrets.env"
secrets_file="${!secrets_env_var:-$default_secrets_file}"

if [ -f "$env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
elif [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ".env"
  set +a
else
  echo "[reset-ponder-schema] $env_file not found and no root .env exists." >&2
  exit 1
fi

if [ -n "$secrets_file" ] && [ -f "$secrets_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$secrets_file"
  set +a
fi

keeper_key_var="${upper_network}_KEEPER_PRIVATE_KEY"
if [ -z "${!keeper_key_var:-}" ]; then
  export "$keeper_key_var=0x0000000000000000000000000000000000000000000000000000000000000001"
fi

schema_var="${upper_network}_DATABASE_SCHEMA"
default_schema="robbed_${network}_ponder"
schema="${!schema_var:-$default_schema}"
if [ -z "$schema" ]; then
  schema="$default_schema"
fi

if [ "$schema" = "public" ] || [ "$schema" = "ponder_sync" ]; then
  echo "[reset-ponder-schema] refusing to drop protected schema: $schema" >&2
  exit 1
fi

if [[ ! "$schema" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "[reset-ponder-schema] refusing unsafe schema name: $schema" >&2
  echo "[reset-ponder-schema] use a simple Postgres identifier or reset manually." >&2
  exit 1
fi

postgres_user="${POSTGRES_USER:-robbed}"
postgres_password="${POSTGRES_PASSWORD:-robbed_dev_pw}"
postgres_db="${POSTGRES_DB:-robbed}"

echo "[reset-ponder-schema] stopping ${network} indexer if it is running..."
bash scripts/compose-env.sh "$network" stop indexer >/dev/null 2>&1 || true

echo "[reset-ponder-schema] ensuring ${network} postgres is running..."
bash scripts/compose-env.sh "$network" up -d postgres

echo "[reset-ponder-schema] dropping schema \"$schema\" only (public + ponder_sync are preserved)..."
bash scripts/compose-env.sh "$network" exec -T -e "PGPASSWORD=$postgres_password" postgres \
  psql -U "$postgres_user" -d "$postgres_db" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS \"$schema\" CASCADE;"

echo "[reset-ponder-schema] OK. Restart with: pnpm run dev:${network}"
