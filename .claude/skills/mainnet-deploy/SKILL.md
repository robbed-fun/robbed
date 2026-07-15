---
name: mainnet-deploy
description: >-
  Runbook-skill for deploying ROBBED_ smart contracts to Robinhood Chain mainnet
  (chain 4663), wiring runtime envs, and avoiding the exact footguns from the
  2026-07-15 deploy. Use when the user says "deploy mainnet", "mainnet contract
  deploy", "redeploy mainnet", "update mainnet addresses", "how did we deploy
  the contract", or "finish ownership/Safe handoff". Private keys must never be
  read by Claude/Codex; signing is operator-controlled through Foundry keystores
  or hardware/browser/KMS signers.
---

# ROBBED_ Mainnet Contract Deploy

Authoritative sources, in order:

1. `docs/developers/runbooks/operator-signing.md`
2. `scripts/deploy-onchain.sh`
3. `contracts/script/Deploy.s.sol`
4. `packages/shared/src/addresses.ts`
5. `tools/localstack/out/mainnet.env` on the operator machine

If these disagree, stop and report the drift. Do not invent addresses.

## Safety Rules

- Never read, print, or ask for private keys. Signing uses `--account`, `--ledger`,
  `--trezor`, `--browser`, `--unlocked`, or KMS options through
  `scripts/deploy-onchain.sh`.
- Never use the keeper key as the deployer key. Keeper is a separate funded ops
  wallet.
- A Safe address must have contract code. Check it before wiring treasury or
  ownership:
  ```bash
  cast code 0xSafe --rpc-url https://rpc.mainnet.chain.robinhood.com
  ```
  `0x` means it is an EOA, not a Safe.
- `contracts/broadcast/Deploy.s.sol/4663/run-latest.json` is not authoritative;
  later failed or simulated runs can overwrite it. Check live bytecode before
  trusting an address.
- Do not rerun the full deploy script just to "continue" a partial deploy; that
  creates a second immutable deployment set.

## Wallets

Create/import the mainnet deployer locally:

```bash
cast wallet new
cast wallet import robbed-mainnet-deployer --interactive
cast wallet address --account robbed-mainnet-deployer
```

Create the keeper wallet separately and store only its private key in the
operator secrets file:

```bash
mkdir -p ~/.config/robbed
chmod 700 ~/.config/robbed
$EDITOR ~/.config/robbed/mainnet.secrets.env
chmod 600 ~/.config/robbed/mainnet.secrets.env
```

Expected secret variable name:

```bash
MAINNET_KEEPER_PRIVATE_KEY=0x...
```

## Config Before Deploy

Public deployer address:

```bash
$EDITOR config/env/mainnet.env
```

Set:

```bash
DEPLOYER_ADDRESS=0xYourDeployer
MAINNET_CHAIN_ID=4663
MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com
```

Treasury/Safe address:

```bash
$EDITOR tools/m0/external.mainnet.json
```

Set `external.treasurySafe` to the deployed Safe contract address, not an EOA.
Then rebuild constants:

```bash
bun run --cwd tools/m0 derive --network=mainnet --reuse-snapshot
```

## Deploy Command

The deployer must be funded. The 2026-07-15 mainnet run showed the core deploy
cost was small, but the canary `createToken` needs value plus gas. Fund with a
real buffer, not the exact estimate; `0.005 ETH` was enough margin for this chain
at the observed gas price, and `0.02 ETH` is a safer operator buffer.

Run from repo root:

```bash
bash scripts/deploy-onchain.sh protocol \
  --network mainnet \
  --deployer 0xYourDeployer \
  --verify \
  --account robbed-mainnet-deployer
```

What happens:

1. `CurveFactory`, `CreatorVault`, `LPFeeVault`, `V3Migrator`, and `Router` are deployed.
2. Factory setters wire migrator/router/vaults.
3. Script attempts the canary create/buy.
4. Script writes `contracts/deployments/4663.json`.
5. Script initiates `transferOwnership(treasurySafe)` if it reaches the ownership step.

If the deploy fails after the core contracts but before canary/ownership, do not
assume the whole deployment failed. Verify live state:

```bash
cast code 0xCurveFactory --rpc-url https://rpc.mainnet.chain.robinhood.com
cast call 0xCurveFactory "owner()(address)" --rpc-url https://rpc.mainnet.chain.robinhood.com
cast call 0xCurveFactory "pendingOwner()(address)" --rpc-url https://rpc.mainnet.chain.robinhood.com
cast call 0xCurveFactory "treasury()(address)" --rpc-url https://rpc.mainnet.chain.robinhood.com
cast call 0xCurveFactory "tokenCounter()(uint256)" --rpc-url https://rpc.mainnet.chain.robinhood.com
```

## Runtime Address Wiring

After a successful deploy, update the generated/shared runtime addresses:

```bash
bun contracts/script/codegen-addresses.ts
```

Emit the compose env only when the broadcast file is known to match the real
deploy run:

```bash
bun contracts/script/emit-deployment-env.ts --network mainnet
```

If `run-latest.json` was overwritten by a later failed/simulated run, do not use
the emitter blindly. Patch the runtime set from live on-chain state and verify
bytecode first.

Current live runtime set from the 2026-07-15 deployment:

```bash
CURVE_FACTORY_ADDRESS=0xba97fb098Cd85890f764acf260D0c152cBF1ad30
ROUTER_ADDRESS=0x0Ce4D916898FaDcCDB0a7e1335B28852e9fAF2F5
MIGRATOR_ADDRESS=0xE76E7C7fc08a3cD6C8bc23dED36DAA1928B6E433
TREASURY_ADDRESS=0x5e884B8B23a1176bE95B536399F333bD8652547C
LP_FEE_VAULT_ADDRESS=0x85CD81d1fDF1a40b6060Cc75d18F07DDD97057BA
CREATOR_VAULT_ADDRESS=0x56Cd8Db022Ce736961a67224575E1e673322e2e4
WETH_ADDRESS=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
START_BLOCK=10705237
```

The current `TREASURY_ADDRESS` above is an EOA address. Do not call it a Safe
until a deployed Safe contract is wired and ownership is accepted.

## Safe Ownership Handoff

If `pendingOwner()` equals the Safe, execute `acceptOwnership()` from the Safe UI:

| Field | Value                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------- |
| To    | `CurveFactory` address                                                                                   |
| Value | `0`                                                                                                      |
| ABI   | `[{"type":"function","name":"acceptOwnership","stateMutability":"nonpayable","inputs":[],"outputs":[]}]` |
| Data  | `0x79ba5097`                                                                                             |

After execution:

```bash
cast call 0xCurveFactory "owner()(address)" --rpc-url https://rpc.mainnet.chain.robinhood.com
cast call 0xCurveFactory "pendingOwner()(address)" --rpc-url https://rpc.mainnet.chain.robinhood.com
```

Expected final state:

```text
owner()         = Safe address
pendingOwner() = 0x0000000000000000000000000000000000000000
```

## Restart Stack

Mainnet local compose should run the keeper all the time:

```bash
bash scripts/compose-env.sh mainnet down
bash scripts/compose-env.sh mainnet up -d --build
bash scripts/compose-env.sh mainnet ps
bash scripts/compose-env.sh mainnet logs --no-color indexer
bash scripts/compose-env.sh mainnet logs --no-color keeper
```

If the keeper logs `keeper_wallet_low_balance`, fund the keeper wallet before
expecting graduation or fee collection automation to work.
