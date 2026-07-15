#!/usr/bin/env bash
# Operator-run on-chain deployment wrapper.
#
# This script intentionally does not accept raw private keys. Use a Foundry
# keystore account, hardware wallet, browser wallet, KMS, or an unlocked local RPC
# account. Codex can prepare the command, but the operator runs it locally.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage:
  bash scripts/deploy-onchain.sh safe --network <mainnet|testnet> --deployer <0x...> \
    --owners <A,B,C,D> --threshold 2 [--salt-nonce N] <wallet selector>

  bash scripts/deploy-onchain.sh protocol --network <mainnet|testnet> --deployer <0x...> \
    [--constants PATH] [--verify] <wallet selector>

wallet selector, choose exactly one:
  --account NAME      Foundry encrypted keystore (~/.foundry/keystores)
  --ledger            Ledger hardware wallet
  --trezor            Trezor hardware wallet
  --browser           Browser wallet
  --unlocked          RPC node signs eth_sendTransaction for --deployer
  --aws | --gcp | --turnkey

extra Foundry wallet args can be appended after --, for example:
  -- --mnemonic-derivation-path "m/44'/60'/0'/0/0"
USAGE
}

die() {
  echo "[deploy-onchain] ERROR: $*" >&2
  exit 1
}

secret_env_guard() {
  local bad=()
  for key in DEPLOYER_PRIVATE_KEY PRIVATE_KEY SIGNER_PRIVATE_KEY EXECUTOR_PRIVATE_KEY MNEMONIC ETH_PRIVATE_KEY; do
    if [ -n "${!key:-}" ]; then bad+=("$key"); fi
  done
  if [ "${#bad[@]}" -gt 0 ]; then
    die "refusing to run with raw-key env vars set: ${bad[*]}. Use --account/--ledger/--trezor/--unlocked instead."
  fi
}

if [ "$#" -lt 1 ]; then
  usage
  exit 2
fi

cmd="$1"
if [ "$cmd" = "-h" ] || [ "$cmd" = "--help" ]; then
  usage
  exit 0
fi
shift
case "$cmd" in
  safe | protocol) ;;
  *)
    usage
    die "unknown command: $cmd"
    ;;
esac

network=""
deployer=""
owners=""
threshold=""
salt_nonce=""
constants_path=""
verify=0
wallet_count=0
wallet_args=()
extra_args=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --network)
      network="${2:-}"
      shift 2
      ;;
    --deployer)
      deployer="${2:-}"
      shift 2
      ;;
    --owners)
      owners="${2:-}"
      shift 2
      ;;
    --threshold)
      threshold="${2:-}"
      shift 2
      ;;
    --salt-nonce)
      salt_nonce="${2:-}"
      shift 2
      ;;
    --constants)
      constants_path="${2:-}"
      shift 2
      ;;
    --verify)
      verify=1
      shift
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
    --private-key | --private-keys | --mnemonic | --mnemonics | --interactive | -i | --interactives)
      die "$1 is disabled for this wrapper; use keystore/hardware/unlocked signing"
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
[ -n "$deployer" ] || die "--deployer is required"
[ "$wallet_count" -eq 1 ] || die "choose exactly one wallet selector"

secret_env_guard

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root/contracts"

env_file="../config/env/${network}.env"
if [ -f "$env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
fi

if [ "$network" = "mainnet" ]; then
  rpc_url="${MAINNET_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
  blockscout_url="https://robinhoodchain.blockscout.com"
  deploy_env=(ROBBED_DEPLOY_ENV=mainnet)
else
  rpc_url="${TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
  blockscout_url="${TESTNET_BLOCKSCOUT_URL:-https://explorer.testnet.chain.robinhood.com}"
  deploy_env=()
fi

[ -n "$rpc_url" ] || die "RPC URL is empty"

common=(
  --rpc-url "$rpc_url"
  --broadcast
  --skip-simulation
  --slow
  --gas-estimate-multiplier 200
  --sender "$deployer"
  "${wallet_args[@]}"
  "${extra_args[@]}"
)

if [ "$cmd" = "safe" ]; then
  [ -n "$owners" ] || die "--owners is required for safe"
  [ -n "$threshold" ] || die "--threshold is required for safe"
  env_args=(DEPLOYER_ADDRESS="$deployer" OWNERS="$owners" THRESHOLD="$threshold")
  if [ -n "$salt_nonce" ]; then env_args+=(SALT_NONCE="$salt_nonce"); fi
  echo "[deploy-onchain] creating Safe on $network with deployer $deployer"
  env "${env_args[@]}" forge script script/CreateSafe.s.sol "${common[@]}"
  exit 0
fi

env_args=(DEPLOYER_ADDRESS="$deployer" "${deploy_env[@]}")
if [ -n "$constants_path" ]; then env_args+=(ROBBED_CONSTANTS="$constants_path"); fi

verify_args=()
if [ "$verify" = "1" ]; then
  verify_args+=(--verify --verifier blockscout --verifier-url "${blockscout_url}/api")
fi

echo "[deploy-onchain] deploying protocol on $network with deployer $deployer"
env "${env_args[@]}" forge script script/Deploy.s.sol "${common[@]}" "${verify_args[@]}"
