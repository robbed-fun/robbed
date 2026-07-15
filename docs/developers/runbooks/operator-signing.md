# Testnet Operator Signing

Short runbook for Robinhood Chain testnet only. Private keys are never pasted into chat and never
stored in repo files.

## Addresses

| Address | Purpose | Where it goes |
|---|---|---|
| Deployer EOA | Pays gas and signs contract deployment txs | `config/env/testnet.env` as `DEPLOYER_ADDRESS` |
| Keeper EOA | Pays gas for auto-graduation keeper txs | `~/.config/robbed/testnet.secrets.env` as `TESTNET_KEEPER_PRIVATE_KEY` |
| Safe address | Factory owner and treasury / fee recipient | `tools/m0/external.testnet.json` as `external.treasurySafe` |

## 1. Create Deployer Wallet

Create a new throwaway EOA:

```bash
cast wallet new
```

Save the private key outside the repo, then import it into a Foundry encrypted keystore:

```bash
cast wallet import robbed-testnet-deployer --interactive
cast wallet address --account robbed-testnet-deployer
```

Put the printed public address in `config/env/testnet.env`:

```env
DEPLOYER_ADDRESS=0xYourDeployer
TESTNET_CHAIN_ID=46630
TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com
TESTNET_BLOCKSCOUT_URL=https://explorer.testnet.chain.robinhood.com
```

Fund the deployer from the faucet. Target `0.05 ETH`.

```bash
cast balance 0xYourDeployer --ether --rpc-url https://rpc.testnet.chain.robinhood.com
```

## 2. Create Keeper Wallet

Create a separate EOA for the keeper:

```bash
cast wallet new
```

Save the private key outside the repo, then put it in the external secrets file:

```bash
mkdir -p ~/.config/robbed
nano ~/.config/robbed/testnet.secrets.env
chmod 600 ~/.config/robbed/testnet.secrets.env
```

File contents:

```env
TESTNET_KEEPER_PRIVATE_KEY=0xKeeperPrivateKey
```

Fund the keeper address from the faucet. Target `0.05 ETH`.

## 3. Create Safe In UI

Use Safe UI on Robinhood testnet.

| Field | Value |
|---|---|
| Network | Robinhood Chain Testnet |
| Owners | Your test owner addresses |
| Threshold | `2` recommended |

Copy the created Safe address into:

```json
{
  "external": {
    "treasurySafe": "0xYourSafe"
  }
}
```

File:

```text
tools/m0/external.testnet.json
```

Then re-derive constants:

```bash
bun run --cwd tools/m0 derive --network=testnet --reuse-snapshot
```

## 4. Deploy Contracts

Deploy with the Foundry keystore:

```bash
bash scripts/deploy-onchain.sh protocol \
  --network testnet \
  --deployer 0xYourDeployer \
  --verify \
  --account robbed-testnet-deployer
```

Then regenerate address artifacts:

```bash
bun contracts/script/emit-testnet-env.ts
bun contracts/script/codegen-addresses.ts
```

## 5. Accept Ownership In Safe UI

The deployer only nominates the Safe. The Safe must accept ownership.

Use the new `curveFactory` from:

```bash
cat contracts/deployments/46630.json
```

Safe UI transaction:

| Field | Value |
|---|---|
| To | new `curveFactory` |
| Value | `0` |
| ABI | `function acceptOwnership()` |
| Data | `0x79ba5097` |

After execution, verify:

```bash
cast call 0xCurveFactory "owner()(address)" --rpc-url https://rpc.testnet.chain.robinhood.com
cast call 0xCurveFactory "pendingOwner()(address)" --rpc-url https://rpc.testnet.chain.robinhood.com
cast call 0xCurveFactory "treasury()(address)" --rpc-url https://rpc.testnet.chain.robinhood.com
```

Expected:

```text
owner()        = Safe address
pendingOwner() = 0x0000000000000000000000000000000000000000
treasury()     = Safe address
```

## 6. Reset Indexer And Frontend

After every redeploy, addresses and `START_BLOCK` change. Rebuild and reset the testnet stack:

```bash
bash scripts/compose-env.sh testnet down -v
bash scripts/compose-env.sh testnet up -d --build
```

For the interim `robbed.fun` stack that still points at testnet, sync
`tools/localstack/out/mainnet.env` to `tools/localstack/out/testnet.env`, then rebuild:

```bash
bash scripts/compose-env.sh mainnet down -v
bash scripts/compose-env.sh mainnet up -d --build
```

Check readiness:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4101/v1/readyz
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4169/ready
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4201/v1/readyz
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4229/ready
```

## Notes

- Deployer private key: encrypted Foundry keystore, outside repo.
- Keeper private key: `~/.config/robbed/testnet.secrets.env`, mode `600`.
- Safe owner keys: stay with owners; Safe UI handles signatures.
- Do not use `DEPLOYER_PRIVATE_KEY` for deploys.
- Do not run keeper with the deployer key.
