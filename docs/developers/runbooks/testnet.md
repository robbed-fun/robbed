# Runbook — Working with Robinhood Chain Testnet

**Owner:** authored 2026-07-11 (Phase-T prep); ratified by hoodpad-architect at Phase-T entry · **Master items:** T-1…T-5, `docker-compose.testnet.yml` · **Spec:** §13 (testnet params — never invented), contracts.md §7.2 (deploy order)

Everything in this document is either (a) verified against an official source — cited inline with retrieval date — or (b) explicitly marked **PENDING**. Re-verify the official values at Phase-T start per the plan's §13 note.

---

## 1. Official network parameters

Source: [docs.robinhood.com/chain/connecting](https://docs.robinhood.com/chain/connecting/), retrieved 2026-07-11.

| Parameter | Value |
|---|---|
| Chain ID | **46630** |
| Native gas token | ETH |
| Public RPC (HTTP) | `https://rpc.testnet.chain.robinhood.com` (rate-limited) |
| Provider RPC (HTTP/WS) | `https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}` / `wss://…` (Alchemy is the documented recommendation; QuickNode, Blockdaemon, dRPC, Validation Cloud also listed) |
| Block explorer (Blockscout) | `https://explorer.testnet.chain.robinhood.com` |
| Sequencer feed | `wss://feed.testnet.chain.robinhood.com` |
| Faucet | `https://faucet.testnet.chain.robinhood.com` |

⚠ Some third-party RPC lists print chain ID **46646** for this testnet. The official docs say **46630**. When in doubt: `cast chain-id --rpc-url https://rpc.testnet.chain.robinhood.com` — the compose `chaincheck` one-shot performs exactly this assertion on every `dev:testnet` bring-up.

Like mainnet (4663), the testnet is an Arbitrum Orbit L2: **never use `block.number`** in any logic (returns an L1 estimate — CLAUDE.md hard rule), and priority fees do not jump the FCFS sequencer queue.

## 2. Wallet setup

### 2.1 Deployer wallet (for contract deploys / scripts)

```bash
cast wallet new          # prints a fresh address + private key
```

- **Always a fresh throwaway key.** It will live in env files and shell history; it must never hold or control anything real.
- Fund it at the faucet (§3), then wire it into the root `.env` (§4).

### 2.2 Browser wallet (for using the dApp on testnet)

Add the network to MetaMask/Rabby manually (or via the "Add network to your wallet" page in the official docs):

| Field | Value |
|---|---|
| Network name | Robinhood Chain Testnet |
| RPC URL | `https://rpc.testnet.chain.robinhood.com` |
| Chain ID | `46630` |
| Currency symbol | ETH |
| Block explorer | `https://explorer.testnet.chain.robinhood.com` |

The web app's wallet plumbing (RainbowKit/wagmi) needs no secret for injected wallets; `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is only required for WalletConnect QR flows (§13 web-6, NEEDS-USER).

## 3. Getting testnet ETH

Go to **https://faucet.testnet.chain.robinhood.com** and request funds for your address. Deploying all six ROBBED_ contracts plus the canary lifecycle costs a small fraction of one ETH-equivalent at testnet gas prices — one faucet drip is expected to cover many full deploys.

**Drip mechanics (verified 2026-07-11, Robinhood support article; recorded in spec §12.52):** **0.05 ETH + 5 of each stock token, per 24h, after account verification.**

If the official faucet is dry or rate-limited, two verified fallbacks target chain 46630: **Chainlink** [faucets.chain.link/robinhood-testnet](https://faucets.chain.link/robinhood-testnet) and **QuickNode** [faucet.quicknode.com/robinhood/testnet](https://faucet.quicknode.com/robinhood/testnet). Beyond those, do not use third-party faucets without verifying they target chain 46630.

## 4. Environment setup (the only file you edit is the root `.env`)

The root `.env` is **gitignored** (`.gitignore`: `.env`, `.env.*`, with only `.env.example` templates committed). Compose auto-loads it.

```bash
# ── identity ────────────────────────────────────────────────────────────────
DEPLOYER_PRIVATE_KEY=0x…       # from `cast wallet new`, faucet-funded (§2.1, §3)
                               # Deploy.s.sol REVERTS (MissingDeployerKey) on any
                               # non-local chain without it; the anvil account-0
                               # fallback is local-only by design.

# ── testnet stack (docker-compose.testnet.yml — all four REQUIRED, no defaults;
#     `${VAR:?}` aborts `config`/`up` when unset or empty) ────────────────────
TESTNET_CHAIN_ID=46630
TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com
TESTNET_RPC_WS_URL=wss://robinhood-testnet.g.alchemy.com/v2/<API_KEY>   # public RPC has no documented WS
TESTNET_BLOCKSCOUT_URL=https://explorer.testnet.chain.robinhood.com

# ── optional ────────────────────────────────────────────────────────────────
# ROBBED_CONSTANTS=…   # deploy-script constants OVERRIDE only — on chain 46630 the
#                      # script already defaults to ../tools/m0/out/constants.testnet.json
#                      # (and cross-checks constants.chainId == chainid, fail-closed)
```

Secrets discipline: `DEPLOYER_PRIVATE_KEY` and any Alchemy key are **SECRET** class per `docs/developers/runbooks/env-inventory.md` — env only, never in code, compose defaults, or docs.

## 5. Running the stack against testnet

```bash
bun run dev:testnet        # foreground; dev:testnet:d for detached
bun run dev:testnet:ps     # status
bun run dev:testnet:down   # stop (dev:testnet:reset drops volumes)
```

What it does (full detail: `docs/developers/runbooks/docker.md` → "Testnet stack"): brings up Postgres/Redis/minio + indexer/API/WS/web against the **remote** testnet — no `anvil`, no `deploychain`. A `chaincheck` one-shot asserts the RPC's `eth_chainId == TESTNET_CHAIN_ID` before anything starts. Separate `robbed-testnet` compose project ⇒ its volumes/state never mix with the local fork stack; same 4XXX host ports, so don't run both simultaneously without overriding `*_PORT`.

**Fail-closed prerequisites** (the stack refuses to start without them, by design):

| Prerequisite | Produced by | Status |
|---|---|---|
| The four `TESTNET_*` env vars | you (§4) | ✅ values known (this doc) |
| `tools/localstack/out/testnet.env` — contract addresses + `START_BLOCK` | **T-3** testnet deploy (§6) | ⛔ does not exist until the deploy runs |
| Testnet constants in `@robbed/shared` (indexer/web chain gates currently pin mainnet 4663) | **T-1** (robbed-shared, architect-ratified) | ⛔ PENDING |

So today the *infra* runs but the indexer will fail its chain-gate assertions — expected and honest. The two ⛔ rows are exactly the Phase-T engineering in flight.

## 6. Deploying the contracts to testnet (Phase T-3)

**Current status: blocked ONLY on the T-2 treasury Safe address — every other input is in place.** The remaining step is exactly: create the dev-signer Safe (**T-2 subsection below**), paste its address into `external.treasurySafe` in `tools/m0/external.testnet.json`, and re-run `bun run --cwd tools/m0 derive --network=testnet --reuse-snapshot`. Until then the deploy fails closed (`TreasurySafeUnset`) — by design.

1. **Testnet infrastructure inventory — RESOLVED (spec §12.52, 2026-07-11, live-verified against the testnet RPC):**
   - **WETH** `0x7943e237c7F95DA44E0301572D358911207852Fa` (official `docs.robinhood.com/chain/protocol-contracts`), **canonical Safe v1.4.1** (safe-deployments lists 46630 "canonical"; dev signers for the T-2 treasury), and **Multicall3** at the canonical address — all CONFIRMED on 46630.
   - **Uniswap V3:** the §12.28 mainnet addresses carry **zero code** on testnet (official registry is 4663-only). The architect-ratified **TESTNET-ONLY substitute** is the Blockscout-verified community deployment: Factory `0xdf9e3D6ffaC4513dD7b053212bbECcbCD15ec932`, NPM `0xFFe6CFc4f759b65f9B62c9D05A9E21a78cE93e12`, SwapRouter02 `0xb79cB26e90EBBD9bC02c75267c9a86dBa1AFedB7`, QuoterV2 `0xDDcBe4989C8171F721c5e683C9C6339B59718213` — the mandatory assertions pass live (`feeAmountTickSpacing(10000)==200`, `NPM.factory()`, `NPM.WETH9()`→official WETH) and the deploy still runs them fail-closed. Trust caveat + scope limit in §12.52 (unknown factory-owner EOA can tune protocol fees but cannot break pools; **never** use these addresses on mainnet or LOCAL — mainnet stays §12.28). Unverified V3 clones on testnet are rejected outright.
2. **Deploy-script testnet mode — DONE (Phase-T prep, 2026-07-11):** `Deploy.s.sol` now three-way branches on the chain id: **live** (4663 — unchanged), **testnet** (46630), **local** (anything else, anvil smoke). Testnet mode enforces the full public-chain discipline: `DEPLOYER_PRIVATE_KEY` REQUIRED (`MissingDeployerKey` — the anvil account-0 fallback is local-only, never on any public chain), ALL externals (WETH/V3 factory/NPM/SwapRouter02/QuoterV2/treasury) read from the constants file's `external.*` (**zero** testnet addresses hardcoded in Solidity), the §12.28 runtime V3/WETH assertions (contracts.md §7.2), the O-6 `TreasurySafeUnset` guard, and a `constants.chainId == block.chainid` pin (`ConstantsChainIdMismatch`) so a mainnet constants file can never drive a testnet broadcast. On 46630 the default constants path is `../tools/m0/out/constants.testnet.json` (`ROBBED_CONSTANTS` env overrides). Only live-mode delta: the F-2 canonical-WETH literal check is 4663-only (testnet WETH comes from §12.52; a wrong value still fails `assertV3Wiring`). Unit-covered by `contracts/test/unit/DeployModes.t.sol`.
3. **Testnet constants (T-1 derive) — DONE:** the §12.52 external set is recorded in the checked-in fixture `tools/m0/external.testnet.json` (provenance + trust caveats inline); `bun run --cwd tools/m0 derive --network=testnet --reuse-snapshot` emits `tools/m0/out/constants.testnet.json` through the same 16 validations, with economics identical to the reviewed mainnet constants (only `chainId` + `external` differ; `--reuse-snapshot` reuses the canonical ETH/USD snapshot). The derive **fails closed**, naming the fixture, if any external value is ever reverted to `null`. Testnet mode emits only the JSON — the Sol/TS renderings and plots stay mainnet-canonical.

With `treasurySafe` filled (T-2 below), the deploy is:

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url "$TESTNET_RPC_URL" --broadcast \
  --skip-simulation --slow --gas-estimate-multiplier 200 \
  --verify --verifier blockscout \
  --verifier-url "$TESTNET_BLOCKSCOUT_URL/api"
bun script/emit-testnet-env.ts   # post-broadcast: reads canonical contracts/deployments/46630.json → writes tools/localstack/out/testnet.env
```

⚠ **`--skip-simulation --slow` are MANDATORY on this chain (incident 2026-07-12, first T-3 attempt).**
Robinhood testnet is an Arbitrum Orbit L2: every tx's `gasUsed` includes an ArbOS **L1 data-fee
component** (`gasUsedForL1` in receipts) that Foundry's *local* simulation cannot model. With the
default flow (local sim × 1.3 multiplier) all four top-level CREATEs ran out of gas exactly at their
limits (e.g. CurveFactory: limit 6,103,116 hit, of which 2,764,298 was `gasUsedForL1`), while the
follow-up CALLs "succeeded" as value-transferring no-ops against the codeless addresses — stranding
the canary's ETH at a dead address (CREATE nonce consumed, unrecoverable). `--skip-simulation` makes
forge take gas limits from the node's `eth_estimateGas` (ArbOS includes the L1 component);
`--gas-estimate-multiplier 200` adds a 2× buffer (unused gas is not charged); `--slow` waits for each
receipt and **stops on the first failure**, preventing the no-op cascade. The 2026-07-12 T-3 deploy
succeeded with exactly these flags.

which per contracts.md §7.2 deploys all six contracts in order, runs the runtime V3/WETH assertions, executes the canary create+buy, initiates the Ownable2Step handoff to the treasury Safe (the Safe must `acceptOwnership()`), and Blockscout-verifies everything (this doubles as the **M1-2/O-5** solc-0.8.35+cancun verification check). *(Verifier endpoint: **RESOLVED — §12.52:** the testnet explorer runs the **Blockscout v2 verifier, no API key required, with `solc v0.8.35+commit.47b9dedd` in its supported list**.)* The `emit-testnet-env.ts` step (contracts-owned, mirrors the local `deploychain` one-shot) reads the canonical deploy artifact `contracts/deployments/46630.json` + the broadcast receipts (for `START_BLOCK` = first deploy block, so the indexer backfill includes the canary events) and writes `tools/localstack/out/testnet.env` with the **same keys as the local `local.env`** (`CURVE_FACTORY_ADDRESS`, `ROUTER_ADDRESS`, `MIGRATOR_ADDRESS`, `TREASURY_ADDRESS`, `LP_FEE_VAULT_ADDRESS`, `START_BLOCK`) — the fail-closed prerequisite of the §5 stack. (`contracts/deployments/<chainId>.json`, i.e. `46630.json`, is the **canonical** deploy artifact — D-2, spec §12.49 annotation; the legacy `tools/deployments/*.json` path is superseded.)

**Treasury (T-2):** the constants file's `treasurySafe` is the zero address until the dev-signer Safe exists, and the deploy fails closed without it. Testnet uses **canonical Safe v1.4.1 contracts with dev signers** (§6.6 — canonical, never bespoke; CONFIRMED on 46630, spec §12.52). The mainnet signer set stays OPEN (§13 O-6, NEEDS-USER).

#### T-2: treasury Safe (create it with `bun run safe:create`)

The canonical Safe v1.4.1 set is **CONFIRMED on 46630** (spec §12.52 — safe-deployments "canonical", live-re-verified; the same addresses exist on mainnet 4663, so the local anvil fork carries them too and the tool is testable against `dev:seed`'s fork first). Creation goes through `tools/deploy/create-safe.ts` (bun + viem): `SafeProxyFactory.createProxyWithNonce` → `Safe.setup(owners, threshold, …, CompatibilityFallbackHandler, …)` against the canonical addresses (SafeProxyFactory `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`, SafeL2 singleton `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`, fallback handler `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99`), with fail-closed preflight (code present + singleton `VERSION() == "1.4.1"`) and post-create read-back (`getOwners()`/`getThreshold()` must match the input exactly). The tool **refuses any chainid outside {4663, 46630, 31337}**.

```bash
# dev signers only on testnet (fresh throwaway keys per §2.1 — like the deployer
# key [§2.1, faucet-funded §3], they live in env/shell history and must never
# control anything real)
RPC_URL=https://rpc.testnet.chain.robinhood.com \
DEPLOYER_PRIVATE_KEY=0x… \
OWNERS=0xOwnerA,0xOwnerB \
THRESHOLD=2 \
bun run safe:create
# → prints SAFE_ADDRESS=0x… after on-chain verification
```

`SALT_NONCE` is optional (defaults to the current timestamp; pass a fixed value for a deterministic CREATE2 address — re-using an already-consumed salt with the same owners/threshold fails with a "CREATE2 collision" hint). Record the printed `SAFE_ADDRESS` as the treasury: paste it into `external.treasurySafe` in `tools/m0/external.testnet.json` and re-run `bun run --cwd tools/m0 derive --network=testnet --reuse-snapshot` to regenerate the `constants.testnet.json` the deploy consumes — the deploy stays fail-closed (`TreasurySafeUnset`) until it is set. Dry-run the whole thing today against the local fork: same command with `RPC_URL=http://localhost:4545` and anvil dev keys.

## 7. After the deploy — lifecycle exercise (T-4/T-5)

Scripted create → multi-actor buys/sells → clamp-to-threshold → permissionless `graduate()` (arb-back observed) → V3 swaps → `LPFeeVault.collect()`; every tx hash recorded in `docs/developers/runbooks/testnet-lifecycle.md` and checkable on the explorer. Then the staging stack (§5) backfills from the deploy block and `GET /v1/confirmations` must show `safe`/`finalized` watermarks advancing against the real RPC (already probe-confirmed supported on mainnet; testnet re-checked here). These fulfill gates **G-7/G-8**.

## 8. Quick reference

```bash
cast chain-id      --rpc-url https://rpc.testnet.chain.robinhood.com   # → 46630
cast balance $ADDR --rpc-url https://rpc.testnet.chain.robinhood.com   # faucet arrived?
cast code  $CONTRACT --rpc-url …                                       # deployed?
```

| I want to… | Do |
|---|---|
| get funds | faucet (§3) |
| point my wallet at testnet | §2.2 table |
| run the off-chain stack against testnet | `bun run dev:testnet` (§5) |
| deploy the contracts | create the T-2 Safe (`bun run safe:create`), fill `treasurySafe` in `tools/m0/external.testnet.json`, re-run the testnet derive, then the §6 forge command + `bun script/emit-testnet-env.ts` |
| see a tx / verify a contract | `https://explorer.testnet.chain.robinhood.com` |
