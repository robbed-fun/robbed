#!/usr/bin/env bash
# Execute a threshold-signed Safe transaction with a Foundry wallet, without
# exposing an executor private key to Codex or env files.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage:
  bash scripts/safe-exec.sh --network <mainnet|testnet> --tx tx.json \
    --sig a.json --sig b.json --executor <0xSubmitter> <wallet selector>

wallet selector, choose exactly one:
  --account NAME | --ledger | --trezor | --browser | --unlocked | --aws | --gcp | --turnkey
USAGE
}

die() {
  echo "[safe-exec] ERROR: $*" >&2
  exit 1
}

for key in EXECUTOR_PRIVATE_KEY PRIVATE_KEY MNEMONIC ETH_PRIVATE_KEY; do
  if [ -n "${!key:-}" ]; then die "refusing raw-key env var $key; use Foundry wallet signing"; fi
done

network=""
tx_file=""
executor=""
sig_args=()
wallet_count=0
wallet_args=()
extra_args=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --network)
      network="${2:-}"
      shift 2
      ;;
    --tx)
      tx_file="${2:-}"
      shift 2
      ;;
    --sig)
      sig_args+=(--sig "${2:-}")
      shift 2
      ;;
    --executor | --from)
      executor="${2:-}"
      shift 2
      ;;
    --account)
      wallet_count=$((wallet_count + 1))
      wallet_args+=(--account "${2:-}")
      shift 2
      ;;
    --ledger | --trezor | --browser | --unlocked | --aws | --gcp | --turnkey)
      wallet_count=$((wallet_count + 1))
      wallet_args+=("$1")
      shift
      ;;
    --private-key | --mnemonic | --interactive | -i)
      die "$1 is disabled for this wrapper"
      ;;
    --)
      shift
      extra_args+=("$@")
      break
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[ "$network" = "mainnet" ] || [ "$network" = "testnet" ] || die "--network must be mainnet or testnet"
[ -n "$tx_file" ] || die "--tx is required"
[ -n "$executor" ] || die "--executor is required"
[ "${#sig_args[@]}" -gt 0 ] || die "at least one --sig is required"
[ "$wallet_count" -eq 1 ] || die "choose exactly one wallet selector"

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

env_file="config/env/${network}.env"
if [ -f "$env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
fi

if [ "$network" = "mainnet" ]; then
  rpc_url="${MAINNET_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
else
  rpc_url="${TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

RPC_URL="$rpc_url" bun tools/deploy/safe-tx.ts exec-data --tx "$tx_file" "${sig_args[@]}" --out "$tmp"

safe_and_data="$(bun -e 'import { readFileSync } from "node:fs"; const j = JSON.parse(readFileSync(process.argv[1], "utf8")); console.log(`${j.safe} ${j.data}`);' "$tmp")"
safe_address="${safe_and_data%% *}"
exec_data="${safe_and_data#* }"

echo "[safe-exec] executing Safe tx on $network via $safe_address from $executor"
cast send "$safe_address" \
  --data "$exec_data" \
  --rpc-url "$rpc_url" \
  --from "$executor" \
  "${wallet_args[@]}" \
  "${extra_args[@]}"
