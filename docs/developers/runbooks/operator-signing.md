# Operator Signing And Deployment

Private keys are never pasted into chat and never stored in repo files. The deployer signs through a
Foundry wallet or hardware wallet. The keeper key lives only in the operator secrets file.

## Files

| Network | Public env               | Safe config                      | Constants output                      | Deploy output                      | Compose output                     | Keeper secret                          |
| ------- | ------------------------ | -------------------------------- | ------------------------------------- | ---------------------------------- | ---------------------------------- | -------------------------------------- |
| Testnet | `config/env/testnet.env` | `tools/m0/external.testnet.json` | `tools/m0/out/constants.testnet.json` | `contracts/deployments/46630.json` | `tools/localstack/out/testnet.env` | `~/.config/robbed/testnet.secrets.env` |
| Mainnet | `config/env/mainnet.env` | `tools/m0/external.mainnet.json` | `tools/m0/out/constants.mainnet.json` | `contracts/deployments/4663.json`  | `tools/localstack/out/mainnet.env` | `~/.config/robbed/mainnet.secrets.env` |

## Steps

| Step                           | What happens                                                                                                                                   | Testnet command                                                                                                                                                                                                                         | Mainnet command                                                                                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Create deployer EOA         | A funded public address pays deployment gas. The private key stays in an encrypted Foundry keystore.                                           | `cast wallet new`<br>`cast wallet import robbed-testnet-deployer --interactive`<br>`cast wallet address --account robbed-testnet-deployer`                                                                                              | `cast wallet new`<br>`cast wallet import robbed-mainnet-deployer --interactive`<br>`cast wallet address --account robbed-mainnet-deployer`                                                                                              |
| 2. Put deployer address in env | Compose and deploy scripts know the public deployer address.                                                                                   | Edit `config/env/testnet.env`:<br>`DEPLOYER_ADDRESS=0xYourDeployer`                                                                                                                                                                     | Edit `config/env/mainnet.env`:<br>`DEPLOYER_ADDRESS=0xYourDeployer`                                                                                                                                                                     |
| 3. Create keeper EOA           | A separate funded wallet pays keeper gas for graduation and fee collection.                                                                    | `cast wallet new`<br>`mkdir -p ~/.config/robbed`<br>`chmod 700 ~/.config/robbed`<br>Edit `~/.config/robbed/testnet.secrets.env`:<br>`TESTNET_KEEPER_PRIVATE_KEY=0xKeeperPrivateKey`<br>`chmod 600 ~/.config/robbed/testnet.secrets.env` | `cast wallet new`<br>`mkdir -p ~/.config/robbed`<br>`chmod 700 ~/.config/robbed`<br>Edit `~/.config/robbed/mainnet.secrets.env`:<br>`MAINNET_KEEPER_PRIVATE_KEY=0xKeeperPrivateKey`<br>`chmod 600 ~/.config/robbed/mainnet.secrets.env` |
| 4. Create Safe in Safe UI      | The Safe becomes factory owner and treasury fee recipient. Owners sign Safe transactions in the UI.                                            | Create Safe on Robinhood testnet, then set `external.treasurySafe` in `tools/m0/external.testnet.json`.                                                                                                                                 | Create Safe on Robinhood mainnet, then set `external.treasurySafe` in `tools/m0/external.mainnet.json`.                                                                                                                                 |
| 5. Rebuild constants           | Deploy script consumes the network-specific constants JSON and fails if Safe is missing.                                                       | `bun run --cwd tools/m0 derive --network=testnet --reuse-snapshot`                                                                                                                                                                      | `bun run --cwd tools/m0 derive --network=mainnet --reuse-snapshot`                                                                                                                                                                      |
| 6. Deploy contracts            | Deployer signs all deployment transactions. The script writes `contracts/deployments/<chainId>.json` and initiates ownership transfer to Safe. | `bash scripts/deploy-onchain.sh protocol --network testnet --deployer 0xYourDeployer --verify --account robbed-testnet-deployer`                                                                                                        | `bash scripts/deploy-onchain.sh protocol --network mainnet --deployer 0xYourDeployer --verify --account robbed-mainnet-deployer`                                                                                                        |
| 7. Emit runtime env            | Address artifacts and `START_BLOCK` are generated for compose/api/indexer/web. Mainnet refuses fork artifacts.                                 | `bun contracts/script/emit-deployment-env.ts --network testnet`<br>`bun contracts/script/codegen-addresses.ts`                                                                                                                          | `bun contracts/script/emit-deployment-env.ts --network mainnet`<br>`bun contracts/script/codegen-addresses.ts`                                                                                                                          |
| 8. Accept ownership in Safe UI | Safe executes `acceptOwnership()` on the new `CurveFactory`; after this, only Safe can call owner functions.                                   | Use Safe UI custom transaction on the new `curveFactory`.                                                                                                                                                                               | Use Safe UI custom transaction on the new `curveFactory`.                                                                                                                                                                               |
| 9. Reset stack                 | Indexer starts from the new `START_BLOCK`; frontend/API use the new addresses.                                                                 | `bash scripts/compose-env.sh testnet down -v`<br>`bash scripts/compose-env.sh testnet up -d --build`                                                                                                                                    | `bash scripts/compose-env.sh mainnet down -v`<br>`bash scripts/compose-env.sh mainnet up -d --build`                                                                                                                                    |

## Safe UI Ownership Transaction

Use the new `curveFactory` address from the deploy artifact:

```bash
cat contracts/deployments/46630.json
cat contracts/deployments/4663.json
```

Safe UI values:

| Field | Value                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------- |
| To    | new `curveFactory`                                                                                       |
| Value | `0`                                                                                                      |
| ABI   | `[{"type":"function","name":"acceptOwnership","stateMutability":"nonpayable","inputs":[],"outputs":[]}]` |
| Data  | `0x79ba5097`                                                                                             |

After the Safe transaction executes:

```bash
cast call 0xCurveFactory "owner()(address)" --rpc-url https://rpc.testnet.chain.robinhood.com
cast call 0xCurveFactory "pendingOwner()(address)" --rpc-url https://rpc.testnet.chain.robinhood.com
cast call 0xCurveFactory "treasury()(address)" --rpc-url https://rpc.testnet.chain.robinhood.com
```

For mainnet, use the same calls with `https://rpc.mainnet.chain.robinhood.com`.

Expected:

```text
owner()         = Safe address
pendingOwner() = 0x0000000000000000000000000000000000000000
treasury()      = Safe address
```

## Funding Targets

| Wallet   | Testnet target | Mainnet target before first deploy |
| -------- | -------------: | ---------------------------------: |
| Deployer |     `0.05 ETH` |          `0.05 ETH` minimum buffer |
| Keeper   |     `0.05 ETH` |          `0.02 ETH` minimum buffer |

The latest testnet protocol deploy used about `18,405,584` gas and paid `0.00018405584 ETH` at
`0.01 gwei`. Keep the larger buffers above because mainnet gas price can differ and failed deploy
attempts still burn gas.

## Rules

- Do not use `DEPLOYER_PRIVATE_KEY` for public deploys.
- Do not run the keeper with the deployer key.
- Do not commit `config/env/*.env` or `~/.config/robbed/*.secrets.env`.
- Safe owner keys stay with each owner; Safe UI handles collection of signatures.
- Mainnet deploy env emission works only after a real `mode: "live"` artifact exists.
