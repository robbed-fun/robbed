# Runbook — Treasury Safe (2-of-4 Gnosis Safe, O-6)

**Status:** v1 (2026-07-13). How the mainnet treasury Safe works and how to operate the deployment + signing ceremony. The treasury is a **2-of-4 Gnosis Safe** on the **canonical Safe v1.4.1** contracts (confirmed live on chain 4663). Design context: section 6.6 (Treasury — Safe, not bespoke) + [`deploy.md`](deploy.md) section 2 (Treasury Safe + admin handover) + [`environments.md`](environments.md) (LOCAL/TESTNET/MAINNET matrix). Root authority: the design docs + [`design-decisions.md`](../design-decisions.md) — D-10 (canonical Safe, never a bespoke multisig), D-61 (the `setTreasury` rotation trap), D-25 (fees pull-withdrawn, never pushed to the treasury), Gate G-A (go/no-go). Closes open item **O-6**. A runbook never overrides the design docs.

The tooling and the fork drill below are **built and re-usable now**. The one thing that is not settled is the human O-6 decision — the four signer addresses and the threshold (see [Prerequisites](#prerequisites-the-open-o-6-decision)).

## What the treasury Safe is (one paragraph)

The mainnet treasury is a **2-of-4 Gnosis Safe**: it is the `Ownable2Step` owner of the `CurveFactory` **and** the fixed recipient of protocol fees (curve trade fees via the permissionless `sweepFees()`, graduation fees, WETH dust, and LP trading fees via `LPFeeVault.collect()`). Spec section 6.6 mandates a canonical Safe over any bespoke multisig — verify the official Safe deployment on 4663 and, if absent, deploy the audited canonical contracts; **never** hand-roll a multisig. Two roles stay distinct and must never be conflated: the **treasury** (the Safe, receives value, cannot pause anything) and the **admin** (`Ownable2Step` owner of `CurveFactory`, sets operational config + `pauseCreates`/`pauseBuys` + caps, and — critically — **cannot touch live curves or the LPFeeVault**, section 6.6). Because fees accrue in-contract and are pulled out by permissionless, non-phase-gated functions (`sweepFees()` D-25, `collect()` section 6.3), a hostile or reverting treasury address can never freeze curve sells — the sells-always-open guarantee (section 6.5) does not depend on the treasury behaving.

## Tooling (`tools/deploy/`)

Production signing uses [`operator-signing.md`](operator-signing.md): private keys stay in a Foundry keystore, hardware wallet, browser wallet, KMS, or unlocked RPC signer. The older Bun + viem scripts remain useful for local fork drills, but production Safe creation goes through `scripts/deploy-onchain.sh safe` and `contracts/script/CreateSafe.s.sol` so Codex never needs to see a deployer key.

For Robinhood testnet redeploy rehearsals, Safe UI is the preferred coordination surface when its
network support is available: one owner proposes the Safe transaction in the UI, the other owner
opens the same Safe from their own machine and signs, and either owner executes after the threshold
is met. The local `safe-sign.sh` / `safe-exec.sh` flow remains the fallback when the hosted Safe
Transaction Service cannot queue a Robinhood testnet transaction.

| Command | Script | What it does |
|---|---|---|
| `bash scripts/deploy-onchain.sh safe …` | [`CreateSafe.s.sol`](../../../contracts/script/CreateSafe.s.sol) | Production Safe deployment via Foundry wallet signing (`--account`, `--ledger`, `--trezor`, `--unlocked`, etc.). Requires only public `DEPLOYER_ADDRESS` + owner addresses; asserts canonical Safe v1.4.1 code and read-back. |
| `bun run safe:create` | [`create-safe.ts`](../../../tools/deploy/create-safe.ts) | Local-only fork drill helper. It takes `DEPLOYER_PRIVATE_KEY` and must not be used for operator ceremonies. |
| `bun run safe:tx` | [`safe-tx.ts`](../../../tools/deploy/safe-tx.ts) | Build / co-sign / execute a SafeTx. Subcommands `hash` / `sign` / `exec`; presets `accept-ownership`, `transfer-eth`, and a raw `--to/--value/--data`. Uses only the on-chain v1.4.1 primitives (`getTransactionHash` / `execTransaction`) — never the hosted Safe Transaction Service (not deployed for 4663). |
| `bash scripts/safe-sign.sh …` | [`safe-sign.sh`](../../../scripts/safe-sign.sh) | Production owner-signature wrapper. Uses `cast wallet sign --no-hash` with a Foundry wallet and then wraps/verifies the signature JSON through `safe-tx.ts`; no `SIGNER_PRIVATE_KEY` needed. |
| `bash scripts/safe-exec.sh …` | [`safe-exec.sh`](../../../scripts/safe-exec.sh) | Production executor wrapper. Uses `safe-tx.ts exec-data` to validate signatures + build `execTransaction` calldata, then submits with `cast send` through a Foundry wallet; no `EXECUTOR_PRIVATE_KEY` needed. |
| `bun run safe:drill` | [`safe-drill.ts`](../../../tools/deploy/safe-drill.ts) | The fork rehearsal (below) — proves the whole 2/4 workflow byte-for-byte on an anvil fork of 4663. |

### How `safe:tx` signing works (the load-bearing details)

- **`hash`** builds the SafeTx (a plain `CALL`, `operation=0`, all gas-refund params zero — the Safe self-executes and pays no relayer), computes the EIP-712 digest locally, and **cross-checks it against the Safe's own `getTransactionHash()` on chain** before anyone signs. The contract is the arbiter, so any viem-vs-Solidity encoding drift fails loud instead of producing an unusable signature. It writes a tx JSON for the signers.
- **Production signing** uses `bash scripts/safe-sign.sh --tx tx.json --signer <owner> --out sig.json --ledger` or `--account <name>`. It signs the already-verified SafeTx hash through Foundry and writes the same **signature JSON** format. Raw-key `safe:tx sign` is local-drill only.
- **Production execution** uses `bash scripts/safe-exec.sh --tx tx.json --sig a.json --sig b.json --executor <addr> --account <name>`. It validates each signature (current owner, no duplicates, correct Safe / chain / nonce), enforces `count ≥ threshold`, sorts signatures ascending by address, builds `execTransaction` calldata, and submits it via `cast send`. Raw-key `safe:tx exec` is local-drill only.

## Validation — the fork drill (DONE)

`bun run safe:drill` proved the entire byte-level 2/4 workflow on a local anvil **fork of chain 4663** (which carries the canonical Safe v1.4.1 set, section 6.6 / D-52). It is the dress rehearsal for the mainnet ceremony — only the signers (dev keys → real hardware) and the executor (dev EOA → funded mainnet EOA) change. Every step asserts and the drill exits non-zero on any failure. All green:

1. **Create** a 2/4 Safe with anvil dev keys via `safe:create` (canonical v1.4.1), then **fund** it.
2. **POSITIVE — two-signature ETH transfer**, driven through the real `safe:tx` CLI (`hash` → `sign` on two "machines" → `exec`, JSON files exchanged on disk exactly as two separated signers would): asserts `ExecutionSuccess`, recipient credited exactly, Safe debited exactly, nonce advanced.
3. **NEGATIVE — single signature** reverts on-chain (`GS020`), nonce unchanged (threshold is 2).
4. **NEGATIVE — descending-order signatures** revert (`GS026`); the **same two** signatures in ascending order then succeed as the control (isolates ordering as the only difference).
5. **POSITIVE — `acceptOwnership()` handoff**: deploy a `CurveFactory` via the existing Deploy script in Fork mode (which transfers ownership to the Safe), then the Safe `acceptOwnership()`s it via `safe:tx`; asserts `factory.owner() == Safe`.

The negatives call the exported `safe-tx` helpers directly so they can bypass the CLI's own fail-closed guards and prove the **on-chain contract itself** rejects a bad blob (defense in depth — the CLI refuses these too).

## Mainnet ceremony (the operational procedure)

Run against `rpc.mainnet.chain.robinhood.com`; verify every step on `robinhoodchain.blockscout.com`. **Signers need no gas** — the Safe self-executes; only the executor EOA pays.

1. **Prereqs.** The 4 signer addresses (checksummed), threshold = **2**, and a **gas-funded executor EOA** (~0.01 ETH). The signer set + threshold are the open O-6 decision (see [Prerequisites](#prerequisites-the-open-o-6-decision)).
2. **Create the Safe.** `bash scripts/deploy-onchain.sh safe --network mainnet --deployer <addr> --owners A,B,C,D --threshold 2 --account <name>` or the hardware-wallet equivalent. Record `SAFE_ADDRESS` + the salt nonce + the creation tx hash. Verify the read-back (`getOwners()` / `getThreshold()`) and the `ProxyCreation` event on Blockscout.
3. **Live 2/4 dust drill.** Fund the Safe with dust; two signers run `scripts/safe-sign.sh` on separate machines (→ JSON); `safe:tx exec` a transfer of the dust back out. Acceptance = `ExecutionSuccess` on the explorer + Safe balance back to zero. This exercises the real signer machines and hardware before any value or authority is committed.
4. **Wire it in.** Set the Safe as `MAINNET_EXTERNAL.treasurySafe` in [`tools/m0/derive.ts`](../../../tools/m0/derive.ts) and re-derive — the `out/` diff **must be treasurySafe-only** (nothing else should move). Set `TREASURY_ADDRESS` and the admin SIWE allowlist (`ADMIN_ALLOWLIST`, OI-A8) from the same signer set; env values live in [`env-inventory.md`](env-inventory.md), never inlined in source (section 2).
5. **Deploy + finalize.** Deploy the protocol (`Deploy.s.sol` initiates `transferOwnership` to the Safe — a *nomination* only under Ownable2Step), then finalize with `bun run safe:tx --preset accept-ownership --target <CurveFactory>` and assert `factory.owner() == Safe`.

## Deployer & ops hardening

- The **deployer stays an ephemeral, gas-only EOA** — a fresh keystore or hardware wallet address. It holds authority only transiently: `Deploy.s.sol` nominates the Safe, and the Safe accepts (step 5).
- **Deployer retirement checklist** (after deploy): assert `factory.owner() == Safe`; confirm **no pending owner** on the Ownable2Step handoff; drain the deployer's residual gas. The deployer must end powerless.
- Rotate any signer or executor key immediately if exposed; the executor's only power is paying gas for already-signed, threshold-satisfying txs.

## Constraints (read before the mainnet deploy)

- **`LPFeeVault.treasury` is immutable at construction (section 6.3 / section 6.6).** The Safe is therefore the **permanent recipient** of the v1 LPFeeVault's `collect()` fees. A later `CurveFactory.setTreasury` only redirects **curve trade + graduation fees** — it does **not** move ongoing LP `collect()` fees, which keep flowing to the original treasury until a **new factory/vault version** (this is the D-61 / G5-INFO-A rotation trap — a feature of the ~50-line ownerless vault's minimalism, not a bug; recorded so ops never treats a Safe rotation as a complete live-config change — see [`deploy.md`](deploy.md) section 2 / H.5).
- **⇒ The Safe MUST exist before the mainnet protocol deploy**, because the LPFeeVault bakes the treasury address in at construction (immutable). Create the Safe (steps 1–3) before deploying any contract that takes the treasury as a constructor arg.
- **The mainnet protocol deploy is gated on Gate G-A** and on the pre-deploy contract work landing first: the graduation donation-freeze fix (robbed-contracts audit, 2026-07-13, D-66) plus the graduation re-derivation. Nothing here runs until Gate G-A passes and the user directs a Phase B launch. On chain 4663 the Safe contracts are canonical/present (D-28 records the V3 set; D-52 records the canonical Safe v1.4.1 set on 46630); the Safe *deployment + signer set* on 4663 is what O-6 closes.

## Prerequisites (the open O-6 decision)

The only thing blocking the mainnet ceremony is the **human O-6 / the open items decision**: the **4 signer addresses and the threshold (M-of-N = 2-of-4)**. This is an architect + ops decision (the open items); the admin SIWE allowlist (OI-A8) follows the same signer set. Until those addresses are furnished, `MAINNET_EXTERNAL.treasurySafe` stays the zero sentinel and `Deploy.s.sol` fails closed (`TreasurySafeUnset`) — never invented. The fork tooling and the drill are complete and re-usable now; only the signer set and Gate G-A stand between here and execution.
