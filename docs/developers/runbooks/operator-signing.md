# Runbook — Operator Signing Without Exposing Keys

**Rule:** no production or signer private key is pasted into chat, committed to the repo, stored in
`config/env/*.env`, or passed as a CLI argument. Codex can prepare commands and files; the operator
runs signing commands locally with a Foundry keystore, hardware wallet, browser wallet, KMS, or an
unlocked local RPC account.

## LLM Access Boundary

`chmod 600` protects files from other OS users, but it does **not** block Codex if Codex runs as the
same Unix user as the workspace. The production rule is therefore stronger: raw private keys must not
be stored in workspace files at all.

Use one of these paths:

- Best: hardware wallet (`--ledger` / `--trezor`) so the private key never exists on disk.
- Good: encrypted Foundry keystore under `~/.foundry/keystores`; Codex may see an encrypted JSON
  file, but not the key or password.
- Avoid: `DEPLOYER_PRIVATE_KEY`, `SIGNER_PRIVATE_KEY`, `EXECUTOR_PRIVATE_KEY`, or mnemonic values in
  `.env`, `config/env/*.env`, shell history, or chat.
- Runtime-only raw secrets, such as a keeper key, must stay out of the workspace. If needed, use
  `~/.config/robbed/<network>.secrets.env` and keep it mode `600`; the deploy path itself does not
  need raw private-key env vars.

After creating local env/keystore files, run:

```bash
pnpm run secrets:lock
```

## Mainnet Funding Budget

The deployment was dry-run against Robinhood mainnet on 2026-07-15 using public test addresses. Safe
creation reached the mainnet RPC and failed at broadcast because the dry-run deployer had `0 ETH`;
the protocol deploy was simulated without broadcasting.

| Item | Estimate |
|---|---:|
| Safe creation | `336,886` gas |
| Protocol deploy + canary | `28,622,504` gas |
| Total deploy gas | `28,959,390` gas |
| Canary ETH sent by deploy script | `0.001847 ETH` |

| Gas Price | Gas Cost | Gas + Canary | 2x Gas Buffer + Canary |
|---|---:|---:|---:|
| Observed `~0.053144 gwei` | `0.001539 ETH` | `0.003386 ETH` | `0.004925 ETH` |
| Conservative `0.5 gwei` | `0.014480 ETH` | `0.016327 ETH` | `0.030806 ETH` |

Funding recommendation:

| Account | Required ETH | Why |
|---|---:|---|
| Deployer | minimum `0.05 ETH`; comfortable `0.1 ETH` | Safe creation, protocol deploy, canary value, retries, public RPC variance |
| Safe executor | `0.005-0.01 ETH` | Submits already-signed Safe transactions |
| Safe owners | `0 ETH` if they only sign off-chain | Safe signatures do not spend gas |
| Treasury Safe | `0 ETH` for initial ownership acceptance | Fund only when later treasury operations require value |

Check gas and balances before mainnet actions:

```bash
export MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com
export DEPLOYER_ADDRESS=0xDeployer

cast gas-price --rpc-url "$MAINNET_RPC_URL"
cast balance "$DEPLOYER_ADDRESS" --ether --rpc-url "$MAINNET_RPC_URL"
```

## Mainnet Deploy Checklist

| Step | What Happens | What You Need To Do | Commands |
|---|---|---|---|
| 1 | Create/import deployer wallet | Import deployer locally. Do not paste private key into chat. | `cast wallet import robbed-mainnet-deployer --interactive` |
| 2 | Get deployer public address | Copy deployer address for env/config. | `cast wallet list` |
| 3 | Fund deployer | Send `0.05-0.1 ETH` to deployer on Robinhood mainnet `4663`; verify balance before deploy. | `cast balance 0xDeployer --ether --rpc-url https://rpc.mainnet.chain.robinhood.com` |
| 4 | Create mainnet env file | Make gitignored mainnet config. | `cp config/env/mainnet.env.example config/env/mainnet.env` |
| 5 | Fill env values | Set public deployer/RPC values. | `nano config/env/mainnet.env` |
| 6 | Choose Safe signers | Collect 4 public owner addresses. Private keys stay with signers. | No repo command. Need `0xA,0xB,0xC,0xD`. |
| 7 | Create treasury Safe | Deploy `2-of-4` Safe on mainnet. | `bash scripts/deploy-onchain.sh safe --network mainnet --deployer 0xDeployer --owners 0xA,0xB,0xC,0xD --threshold 2 --account robbed-mainnet-deployer` |
| 8 | Save Safe address | Copy `SAFE_ADDRESS=0x...` from output. | No command. |
| 9 | Wire Safe into constants | Set mainnet `treasurySafe` to Safe address. | `nano tools/m0/derive.ts` |
| 10 | Re-derive constants | Generate deploy constants with real Safe/economics. | `bun run --cwd tools/m0 derive --network=mainnet` |
| 11 | Review constants | Confirm only expected economics/Safe changes. | `git diff tools/m0/out/constants.json tools/m0/out/constants.ts tools/m0/out/Constants.sol.txt` |
| 12 | Deploy contracts | Deploy protocol to Robinhood mainnet and verify. | `bash scripts/deploy-onchain.sh protocol --network mainnet --deployer 0xDeployer --verify --account robbed-mainnet-deployer` |
| 13 | Generate shared addresses | Update app/indexer address registry from live artifact. | `bun contracts/script/codegen-addresses.ts` |
| 14 | Build ownership Safe tx | Prepare `acceptOwnership()` for `CurveFactory`. | `RPC_URL="$MAINNET_RPC_URL" SAFE_ADDRESS=0xSafe bun run safe:tx hash --preset accept-ownership --target 0xCurveFactory --out tx-accept-owner.json` |
| 15 | Sign ownership tx | Two Safe owners sign independently. | `bash scripts/safe-sign.sh --network mainnet --tx tx-accept-owner.json --signer 0xOwnerA --out sig-owner-a.json --account <owner-a-keystore>` |
| 16 | Sign second owner | Second signer signs same tx. | `bash scripts/safe-sign.sh --network mainnet --tx tx-accept-owner.json --signer 0xOwnerB --out sig-owner-b.json --account <owner-b-keystore>` |
| 17 | Execute ownership tx | Executor submits threshold-signed Safe tx. | `bash scripts/safe-exec.sh --network mainnet --tx tx-accept-owner.json --sig sig-owner-a.json --sig sig-owner-b.json --executor 0xExecutor --account <executor-keystore>` |
| 18 | Verify owner | Confirm `CurveFactory.owner()` is Safe. | `cast call 0xCurveFactory "owner()(address)" --rpc-url https://rpc.mainnet.chain.robinhood.com` |
| 19 | Create runtime env | Fill `tools/localstack/out/mainnet.env` from live `4663` artifact. | Generator still needed, or fill manually from `contracts/deployments/4663.json`. |
| 20 | Reset old DB | Drop interim/testnet backfill state. | `pnpm run dev:mainnet:reset` |
| 21 | Start mainnet stack | Start API/indexer/web/tunnel stack. | `pnpm run dev:mainnet:d` |
| 22 | Check services | Confirm containers are up. | `pnpm run dev:mainnet:ps` |
| 23 | Check logs | Watch startup/backfill issues. | `pnpm run dev:mainnet:logs` |
| 24 | Check API | Confirm public API health. | `curl https://api.robbed.fun/v1/healthz` |
| 25 | Run live canary | Small real-money flow: create, buy/sell, graduate, collect. | Use UI/API with tiny amounts, then verify txs in Blockscout. |

For hardware wallet, replace `--account ...` with `--ledger` or `--trezor`.

## One-Time Wallet Setup

Recommended deployer path:

```bash
cast wallet import robbed-mainnet-deployer --interactive
```

Foundry prompts for the private key and keystore password locally. The encrypted keystore is stored
under `~/.foundry/keystores`, outside the repo. Record only the public address in
`config/env/mainnet.env`:

```bash
DEPLOYER_ADDRESS=0x...
MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com
```

Hardware wallet alternative:

```bash
cast wallet list --ledger
```

Use the displayed public address as `DEPLOYER_ADDRESS`.

## Trezor Setup

Use Trezor as a signing device, not as a file where keys are stored. The private key stays inside
the Trezor. One Trezor seed can derive many Ethereum addresses, but do **not** create all four Safe
signer addresses from the same Trezor/seed; that defeats the purpose of a multisig. For the
recommended `2-of-4` Safe, use four independent signer addresses, ideally four separate
devices/people/seeds.

| Use | Recommendation |
|---|---|
| Deployer | Can be a Trezor address |
| Safe signer | One Trezor address can be one Safe signer |
| `2-of-4` Safe | Use 4 independent signer addresses |
| Executor | Can be Trezor or keystore; does not need to be a Safe owner |

List Trezor Ethereum addresses:

```bash
cast wallet list --trezor
```

Put the chosen deployer address in `config/env/mainnet.env`:

```env
DEPLOYER_ADDRESS=0xYourTrezorAddress
MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com
MAINNET_CHAIN_ID=4663
```

Create the Safe with Trezor signing:

```bash
bash scripts/deploy-onchain.sh safe \
  --network mainnet \
  --deployer 0xYourTrezorAddress \
  --owners 0xA,0xB,0xC,0xD \
  --threshold 2 \
  --trezor
```

Deploy the protocol with Trezor signing:

```bash
bash scripts/deploy-onchain.sh protocol \
  --network mainnet \
  --deployer 0xYourTrezorAddress \
  --verify \
  --trezor
```

Sign a Safe tx with Trezor:

```bash
bash scripts/safe-sign.sh \
  --network mainnet \
  --tx tx-accept-owner.json \
  --signer 0xOwnerA \
  --out sig-owner-a.json \
  --trezor
```

Confirm each transaction/signature on the Trezor screen and verify the address shown there.

## Create the Treasury Safe

The Safe needs public owner addresses only. Owner private keys remain with the owners.

```bash
bash scripts/deploy-onchain.sh safe \
  --network mainnet \
  --deployer 0xDeployer \
  --owners 0xOwnerA,0xOwnerB,0xOwnerC,0xOwnerD \
  --threshold 2 \
  --account robbed-mainnet-deployer
```

Use `--ledger`, `--trezor`, `--browser`, `--aws`, `--gcp`, `--turnkey`, or `--unlocked` instead of
`--account` when that is the operator's signing setup.

## Deploy the Protocol

```bash
bash scripts/deploy-onchain.sh protocol \
  --network mainnet \
  --deployer 0xDeployer \
  --verify \
  --account robbed-mainnet-deployer
```

This wrapper refuses raw-key env vars such as `DEPLOYER_PRIVATE_KEY`, sets
`ROBBED_DEPLOY_ENV=mainnet` for mainnet, passes `DEPLOYER_ADDRESS` into `Deploy.s.sol`, and lets
Foundry sign with the selected wallet.

## Safe Owner Signatures

Build a Safe tx:

```bash
RPC_URL="$MAINNET_RPC_URL" SAFE_ADDRESS=0xSafe \
  bun run safe:tx hash --preset accept-ownership --target 0xCurveFactory --out tx.json
```

Each owner signs on their own machine:

```bash
bash scripts/safe-sign.sh \
  --network mainnet \
  --tx tx.json \
  --signer 0xOwnerA \
  --out sig-owner-a.json \
  --ledger
```

The wrapper signs the SafeTx hash with `cast wallet sign --no-hash` and then asks
`tools/deploy/safe-tx.ts` to verify/recover the signature before writing the JSON file.

Execute after collecting two signatures:

```bash
bash scripts/safe-exec.sh \
  --network mainnet \
  --tx tx.json \
  --sig sig-owner-a.json \
  --sig sig-owner-b.json \
  --executor 0xExecutor \
  --account robbed-mainnet-executor
```

The executor key only submits an already threshold-signed transaction. It can be a separate funded
ops key; it does not need to be a Safe owner, and it can live in its own Foundry keystore or hardware
wallet.
