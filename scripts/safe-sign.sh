#!/usr/bin/env bash
# Sign an existing safe:tx JSON with a Foundry wallet, then wrap the signature
# into the JSON format consumed by `bun run safe:tx exec`.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage:
  bash scripts/safe-sign.sh --network <mainnet|testnet> --tx tx.json \
    --signer <0xOwner> --out sig.json <wallet selector>

wallet selector, choose exactly one:
  --account NAME | --ledger | --trezor | --aws | --gcp | --turnkey

extra `cast wallet sign` args can be appended after --.
USAGE
}

die() {
  echo "[safe-sign] ERROR: $*" >&2
  exit 1
}

for key in SIGNER_PRIVATE_KEY PRIVATE_KEY MNEMONIC ETH_PRIVATE_KEY; do
  if [ -n "${!key:-}" ]; then die "refusing raw-key env var $key; use Foundry wallet signing"; fi
done

network=""
tx_file=""
signer=""
out_file=""
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
    --signer | --from)
      signer="${2:-}"
      shift 2
      ;;
    --out)
      out_file="${2:-}"
      shift 2
      ;;
    --account)
      wallet_count=$((wallet_count + 1))
      wallet_args+=(--account "${2:-}")
      shift 2
      ;;
    --ledger | --trezor | --aws | --gcp | --turnkey)
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
[ -n "$signer" ] || die "--signer is required"
[ -n "$out_file" ] || die "--out is required"
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

safe_hash="$(bun -e 'import { readFileSync } from "node:fs"; const j = JSON.parse(readFileSync(process.argv[1], "utf8")); if (!j.safeTxHash) process.exit(2); console.log(j.safeTxHash);' "$tx_file")"

echo "[safe-sign] signing SafeTx hash $safe_hash as $signer"
signature="$(cast wallet sign --no-hash "$safe_hash" --from "$signer" "${wallet_args[@]}" "${extra_args[@]}")"

RPC_URL="$rpc_url" bun tools/deploy/safe-tx.ts sign \
  --tx "$tx_file" \
  --signer "$signer" \
  --signature "$signature" \
  --out "$out_file"
