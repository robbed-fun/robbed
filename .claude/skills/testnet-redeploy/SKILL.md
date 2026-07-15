---
name: testnet-redeploy
description: >-
  Runbook-skill for a full smart-contract REDEPLOY to Robinhood Chain testnet (chain 46630) and the
  mandatory REINDEX that must follow. Use when the user says "redeploy testnet", "redeploy 46630",
  "re-deploy the contracts", "new testnet deploy", "tokens aren't showing after a testnet deploy",
  or "reindex testnet". Immutable contracts ⇒ every redeploy mints NEW addresses ⇒ both docker
  indexers must be re-pointed and force-reindexed or newly-created tokens never appear on the
  discovery pages. Codifies the emit→codegen→rebuild-both-stacks→accept-ownership→smoke sequence
  plus the Orbit gas / ponder-start / mainnet.env gotchas hard-won in this repo.
---

# Testnet (46630) redeploy + reindex

Authoritative source order: the runbooks + design docs under `docs/developers/**` win
(`docs/developers/runbooks/testnet.md`, `deploy.md`, `docker.md` "Testnet/Mainnet stack",
`testnet-lifecycle.md`) → this skill is derived. If this skill and a runbook disagree, the runbook wins
and the drift is reported. Everything below is repo-root-relative; run from the repo root.

This skill AUTHORS the sequence and runs the low-risk idempotent legs (emit/codegen/verify/reindex/smoke).
It does NOT decide to deploy: the `scripts/deploy-onchain.sh protocol …` wrapper in Step 1 spends
real testnet gas and mints new immutable addresses — only run it on explicit user direction.

## Docs-first rule (mandatory, every run)

Before touching any command, consult current official docs for the tools in play — never work from
memory. Primary channel: **context7 MCP** (`resolve-library-id` → `get-library-docs`); fallback
WebFetch of the canonical page. Docs beat assumptions; the spec beats docs (flag any conflict).

- Foundry `forge script` / `forge verify-contract` — https://book.getfoundry.sh
- Ponder (`ponder start`, build_id / schema reuse, re-index) — https://ponder.sh/docs
- Arbitrum Orbit gas model (`gasUsedForL1`, `eth_estimateGas`) — https://docs.arbitrum.io
- Robinhood Chain testnet params + faucet — https://docs.robinhood.com/chain/connecting
- Blockscout verifier (v2, no API key) — the testnet explorer at `$TESTNET_BLOCKSCOUT_URL`
- Safe deployments + `acceptOwnership` choreography — https://docs.safe.global · https://docs.openzeppelin.com/contracts/5.x/api/access

## Invariants this skill will not violate

- **Never read raw secret files** — `.env`, `.env.local`, deployer JSON, keystores, and private-key
  files are SECRET class (`env-inventory.md`, `operator-signing.md`). Reference public variable names
  only; check env shape with name-only commands. Deployment signing uses `scripts/deploy-onchain.sh`
  with a Foundry keystore, hardware wallet, browser wallet, KMS, or unlocked RPC signer.
- **Immutable contracts, no proxies** (`docs/developers/contracts.md`). A redeploy is a *new* deploy: new
  addresses, new `START_BLOCK`. There is no in-place upgrade — which is exactly why the reindex (Step 4) is mandatory.
- **Sells always open / no post-grad pause** — nothing in a redeploy changes this; do not add
  pause plumbing.
- **No hardcoded market metrics** (the always-on `no-market-metrics` rule): constants come only from the
  M0 derive output; never inline a price/ETH figure into a command.
- **Testnet V3 addresses are testnet-ONLY**: the community V3 deployment used on 46630 must
  never leak to mainnet 4663 or LOCAL. The deploy script asserts this at deploy time.

---

## Step 0 — Preconditions (fail-closed; state each, abort on any red)

Report each as present / missing; a missing item blocks the deploy — do not proceed past a red item.

1. **Funded deployer signer.** A local signer is available for the intended public deployer address
   and the address is funded on 46630. Prefer the current testnet deployer address
   `0xfD6A3a8E829140b02192D3154A6D53c2662E0704`; verify an encrypted Foundry keystore with:
   ```bash
   cast wallet address --account robbed-testnet-deployer
   cast balance 0xfD6A3a8E829140b02192D3154A6D53c2662E0704 --ether --rpc-url "$TESTNET_RPC_URL"
   ```
   A full deploy is heavy on this Orbit chain: `createToken` alone runs
   **~7.6–8M gas** because it deploys + initializes the graduation V3 pool (observed on-chain, tx
   `0xd79f5d…`; the web ceiling was raised 8M→30M for exactly this — commit `7017954`). Six-contract
   deploy + in-script canary create+buy ⇒ budget **~0.05–0.1 ETH**.
   Faucet: `https://faucet.testnet.chain.robinhood.com` (0.05 ETH / 24h; Chainlink + QuickNode
   fallbacks target 46630 — testnet.md). A full *graduation* needs more than one drip (`GRADUATION_ETH`
   on testnet is the faucet-scale value below) — see testnet-lifecycle.md for the funding caveat.

2. **Constants present + current.** `tools/m0/out/constants.testnet.json` exists,
   `chainId == 46630`, and it is the current faucet-scale derive: `curve.graduationEthWei ≈
   5.0169e15` (**G ≈ 0.005 ETH**, `M0_TESTNET_GRADUATION_ETH` small-G override active) and
   `fees.creatorFeeBps == 50` (the creator-fee leg, 0.5%; treasury 100 + creator 50 = 150 ≤ the
   200/2% additive cap). If stale/missing, re-derive (it fails closed if `external.treasurySafe` is
   the zero address):
   ```bash
   bun run --cwd tools/m0 derive --network=testnet --reuse-snapshot
   ```
   The deploy defaults to this path on 46630 (`ROBBED_CONSTANTS` overrides); it also asserts
   `constants.chainId == block.chainid` (`ConstantsChainIdMismatch`), so a mainnet constants file can
   never drive a testnet broadcast.

3. **Treasury Safe exists** (T-2). `constants.testnet.json` → `external.treasurySafe` is a real
   canonical Safe v1.4.1 (dev signers on testnet), not `0x0`. If absent, create it
   with `scripts/deploy-onchain.sh safe`, paste into
   `tools/m0/external.testnet.json`, re-derive (item 2). Deploy fails closed (`TreasurySafeUnset`)
   otherwise. A *re*-deploy against the same chain normally reuses the existing Safe.

4. **RPC + explorer reachable.**
   ```bash
   cast chain-id --rpc-url "$TESTNET_RPC_URL"   # MUST be 46630 (docs say 46630, not 46646)
   ```
   `TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com` (public, rate-limited, **non-archive** —
   prunes state ~40 min; fine for logs/receipts backfill), `TESTNET_BLOCKSCOUT_URL=https://explorer.testnet.chain.robinhood.com`.

---

## Step 1 — Deploy (spends gas; new immutable addresses)

`script/Deploy.s.sol` three-way-branches on chain id; on 46630 it runs testnet mode: a real public
`DEPLOYER_ADDRESS` plus a Foundry wallet selector are REQUIRED (no anvil fallback on a public chain),
all externals read from the constants file (zero testnet addresses hardcoded in Solidity), the
**deploy-time runtime asserts** (`V3Factory.feeAmountTickSpacing(10000)==200`,
`NPM.factory()`, `NPM.WETH9()`), the **O-6 `TreasurySafeUnset` guard**, and the cap/graduation-fundable
guards. It deploys the current-tree **creator-fee topology** — the script encodes the order
(CurveFactory → **CreatorVault** → **LPFeeVault (creator/factory-aware)** → V3Migrator → Router, then
`factory.setLpFeeVault(...)`) — runs the in-script **canary create + buy**, initiates the Ownable2Step
ownership handoff, and writes the canonical artifact `contracts/deployments/46630.json`.

```bash
bash scripts/deploy-onchain.sh protocol \
  --network testnet \
  --deployer 0xfD6A3a8E829140b02192D3154A6D53c2662E0704 \
  --verify \
  --account robbed-testnet-deployer
```

> **`--skip-simulation --slow --gas-estimate-multiplier 200` are MANDATORY on this chain**
> (incident 2026-07-12, first T-3 attempt). Robinhood testnet is an Arbitrum Orbit L2: every tx's
> `gasUsed` includes an ArbOS **L1 data-fee component** (`gasUsedForL1`) that Foundry's *local*
> simulation cannot model. With the default flow (local sim × 1.3) the top-level CREATEs ran out of
> gas at their limits and the follow-up CALLs "succeeded" as no-ops against codeless addresses,
> stranding the canary's ETH at a dead address (CREATE nonce consumed, unrecoverable).
> `--skip-simulation` takes limits from the node's `eth_estimateGas` (includes the L1 component),
> `--gas-estimate-multiplier 200` adds a 2× buffer (unused gas is not billed), `--slow` waits for each
> receipt and **stops on first failure**, preventing the no-op cascade.

**NOT idempotent:** re-running this mints a *different* set of addresses (fresh nonce). If a prior
`46630.json` exists you are intentionally replacing it — that is the whole point of a redeploy; just
be sure you mean to (and that you then complete Steps 3–5, or the stacks will point at the OLD deploy).

---

## Step 2 — Verify on Blockscout (record addresses + deploy block)

The inline `--verify` from Step 1 handles most contracts as they deploy. Confirm on
`$TESTNET_BLOCKSCOUT_URL` that **every deployed contract** took — CurveFactory, Router, V3Migrator,
LPFeeVault, **CreatorVault**, plus the canary LaunchToken + BondingCurve — all with **solc
`v0.8.35+commit.47b9dedd` + `cancun` target, MIT**. For any that didn't take, **use the
`/verify-contract` skill** — it carries the full Blockscout-v2 (no-API-key) recipe: after-the-fact
`--guess-constructor-args`, explicit `--constructor-args 0x…` for CurveFactory's 20-field `FactoryInit`,
the factory-created-instance path for the canary LaunchToken/BondingCurve, and the Code-tab confirm.
Do not re-document those flags here — that skill is the single source so the two don't diverge. This
step doubles as the **M1-2/O-5** pin check on the testnet verifier (the mainnet
`robinhoodchain.blockscout.com` round-trip is a separate owed item — B4). Record: the six/seven
addresses from `contracts/deployments/46630.json` and the deploy block (min receipt block =
`START_BLOCK`, computed in Step 3).

---

## Step 3 — Emit env + regenerate address artifacts (idempotent)

```bash
bun contracts/script/emit-testnet-env.ts      # reads contracts/deployments/46630.json + broadcast receipts
bun contracts/script/codegen-addresses.ts     # regenerates the shared registry from ALL deployments/*.json
```

- `emit-testnet-env.ts` (fail-closed; refuses non-"testnet" mode) writes:
  - `tools/deployments/testnet.json` — addresses + `START_BLOCK` (= **min** receipt block, so backfill
    INCLUDES the canary's `TokenCreated`/`Trade`) + verification-GUID record (preserved across re-runs).
  - `tools/localstack/out/testnet.env` — the fail-closed prerequisite of the testnet compose stack:
    `CURVE_FACTORY_ADDRESS, ROUTER_ADDRESS, MIGRATOR_ADDRESS, TREASURY_ADDRESS, LP_FEE_VAULT_ADDRESS,
    CREATOR_VAULT_ADDRESS, WETH_ADDRESS, START_BLOCK` (the last two gate creator-fee
    indexing + WETH-leg USD pricing — added to the emitter alongside the CreatorVault generation).
- `codegen-addresses.ts` regenerates `packages/shared/src/addresses.ts` (the single registry consumed by
  the indexer config + web). It fail-closes on the mode invariant (only 4663 may be `live`; no
  anvil-dev-account `live` treasury) — a testnet redeploy stays `mode:"testnet"`, always fine.

Both are safe to re-run. **Do NOT hand-edit** `packages/shared/src/addresses.ts` (generated) — regenerate.

### New-address blast radius (know what moved, and what did NOT)

| Artifact | How it updates | Action on redeploy |
|---|---|---|
| `contracts/deployments/46630.json` | written by `Deploy.s.sol` | automatic (Step 1) |
| `tools/deployments/testnet.json` + `tools/localstack/out/testnet.env` | `emit-testnet-env.ts` | automatic (Step 3) |
| `packages/shared/src/addresses.ts` (generated registry) | `codegen-addresses.ts` | automatic (Step 3) |
| `apps/web/src/shared/config/addresses.ts` (HAND-authored) | *imports* the generated registry via `getDeployment(chainId)` | **no edit** — derives at runtime; codegen never writes here |
| `tools/localstack/out/mainnet.env` (INTERIM 46630 copy) | **NOT** auto-regenerated | **hand-update in Step 4** |
| `NEXT_PUBLIC_E2E_*` fork overrides | LOCAL anvil-fork e2e seam only | **do NOT touch** — separate from testnet; these override addresses for the LOCAL fork, never for 46630 |

---

## Step 4 — REINDEX (THE critical gotcha — both stacks, fresh index)

**Symptom if skipped:** a token created on the new deployment is correct on-chain but never appears on
the discovery page. The page reads page → API → Postgres ← Ponder. If the indexer still watches the OLD
factory (or resumes an OLD checkpoint), the new token is never written.

The indexer reads the factory address from **`@robbed/shared` `getDeployment(chainId)` baked into the
image** (the `CURVE_FACTORY_ADDRESS` env is empty), so a plain restart uses the stale image — you MUST
**rebuild**. And the persistent stacks run **`ponder start`** (crash-recovery ON, resume-on-restart),
so a bare restart RESUMES the OLD checkpoint in the same `DATABASE_SCHEMA (public)` instead of
re-indexing the new factory from the new `START_BLOCK`. New addresses + new start block change Ponder's
`build_id`, so Ponder REFUSES to reuse the schema — you must give it a clean schema (drop it or bump
`DATABASE_SCHEMA`) or the boot errors.

TWO stacks currently index 46630 and BOTH must be redone: `robbed-testnet`
(`docker-compose.testnet.yml`, serves `testnet.robbed.fun`) and `robbed-mainnet`
(`docker-compose.mainnet.yml`, INTERIM @ 46630, serves `robbed.fun`).

### 4a. Point the mainnet-interim stack at the new deploy (hand-edit)

`mainnet.env` is a hand-maintained INTERIM copy of `testnet.env` (NOT emitted by `emit-testnet-env.ts`).
Sync its eight keys to the freshly-emitted `testnet.env`:

```bash
diff <(grep -vE '^\s*#' tools/localstack/out/testnet.env) \
     <(grep -vE '^\s*#' tools/localstack/out/mainnet.env)   # see the drift first
```
Then update `CURVE_FACTORY_ADDRESS / ROUTER_ADDRESS / MIGRATOR_ADDRESS / TREASURY_ADDRESS /
LP_FEE_VAULT_ADDRESS / CREATOR_VAULT_ADDRESS / WETH_ADDRESS / START_BLOCK` in
`tools/localstack/out/mainnet.env` to match `testnet.env` (keep the ⚠ INTERIM header). A stale
`START_BLOCK` here forces a multi-hour full-history backfill; a missing `CREATOR_VAULT_ADDRESS`
silently drops post-grad creator-claim indexing on the interim stack.

### 4b. Rebuild + force a fresh index — both stacks

Clean-slate (simplest, guaranteed fresh — drops the volume so Ponder re-indexes from the new
`START_BLOCK`; acceptable because both stacks are ephemeral 46630 backfills):

```bash
bun run dev:testnet:reset && bun run dev:testnet:d                                   # robbed-testnet
docker compose -f docker-compose.mainnet.yml down -v && \
docker compose -f docker-compose.mainnet.yml up -d --build                          # robbed-mainnet interim
```

No-downtime alternative (rebuild the image so the new baked addresses load, then hand a clean schema
so `ponder start` re-indexes rather than resumes) — per the ponder-start schema-change procedure
(`indexer.md`; the compose header documents the build_id/schema-reuse refusal):

```bash
docker compose -f docker-compose.testnet.yml up -d --build indexer api ws
# then EITHER drop the ponder schema in that stack's Postgres (DROP SCHEMA public CASCADE; CREATE SCHEMA public;
# — the sidecar migrate step re-creates its tables on boot) OR set a new DATABASE_SCHEMA for the indexer
# (e.g. include the deploy block) so Ponder starts a fresh index instead of resuming the old checkpoint.
docker compose -f docker-compose.mainnet.yml up -d --build indexer api ws
```

**Verify (bounded until-loop, per stack):** Ponder `/ready` returns 200 only once backfill is
caught up, so `healthy` == caught-up. Testnet: api `http://localhost:4101/v1/readyz` → 200, ponder
`http://localhost:4169/ready` → 200. Mainnet-interim: api `http://localhost:4201/v1/readyz` → 200,
ponder `http://localhost:4229/ready` → 200. No restart loops. (Recent-window backfill on the
non-archive public RPC completes fine; deep history wants an Alchemy archive RPC — testnet-lifecycle.md
caveat.)

---

## Step 5 — Accept ownership (Ownable2Step; T-4 / deploy.md)

The deploy only *nominated* the new owner. A redeploy is a NEW `CurveFactory`, so the treasury Safe
(dev-signer on testnet) must `acceptOwnership()` on the new factory — ownership does not transfer until
the accept. Use the Safe tx tool (2-step: build hash → collect M-of-N sigs → exec):

```bash
bun run safe:tx hash --safe <TREASURY_SAFE> --preset accept-ownership --target <NEW_CURVE_FACTORY>
# collect threshold signatures, then exec via safe:tx (see tools/deploy/safe-tx.ts + safe-drill.ts;
# full choreography in deploy.md). Use RPC_URL plus signer/executor wallet selectors; never inline keys.
```

Assert afterward: `cast call <NEW_CURVE_FACTORY> "owner()(address)" --rpc-url "$TESTNET_RPC_URL"` ==
the Safe, and the deployer EOA has zero remaining authority. (On mainnet, admin ≠ treasury;
testnet uses the one dev Safe for both as a simplification.) LPFeeVault/CreatorVault/Migrator are
unowned/immutable — nothing to accept there; post-graduation there is zero pause authority.

---

## Step 6 — Post-deploy smoke (prove the end-to-end path)

The in-script canary from Step 1 is already in the `START_BLOCK` window and should index. For an
independent end-to-end proof, create one canary token **via the Router** and confirm it surfaces:

```bash
# 1) create a canary through the Router (values from constants.testnet.json; never inline a price).
#    Use the launch UI on testnet.robbed.fun, or a scripted Router.createToken(...) with the M0 params.
# 2) confirm it lands in the testnet API (page ← API ← Postgres ← Ponder):
curl -s http://localhost:4101/v1/tokens | jq '.[0:3]'          # local testnet stack
curl -s https://api-testnet.robbed.fun/v1/tokens | jq '.[0:3]' # public (tunnel), if exposed
```

Confirm the new token's address (and the on-chain `TokenCreated` tx) appears within ~1–2 min. Also
sanity-check that trades show the exact **1% fee** and a **sell** is accepted with no
pause gating (sells-always-open) — matching the on-chain evidence pattern in
`testnet-lifecycle.md`.

---

## Definition of done

- [ ] `contracts/deployments/46630.json` rewritten with the new addresses; `mode == "testnet"`.
- [ ] All deployed contracts Blockscout-verified (solc 0.8.35 + cancun, MIT).
- [ ] `testnet.env` + `tools/deployments/testnet.json` + `packages/shared/src/addresses.ts` regenerated;
      `mainnet.env` hand-synced to match (seven address keys + `START_BLOCK`).
- [ ] BOTH stacks rebuilt AND force-reindexed from the new `START_BLOCK`; both `/v1/readyz` and both
      ponder `/ready` return 200; no restart loops.
- [ ] Treasury Safe `acceptOwnership()` done; `owner()` == Safe; deployer EOA powerless.
- [ ] Smoke: a Router-created canary appears in `/v1/tokens`; trades charge exactly 1%; a sell is accepted.

## Idempotency notes

- **Re-runnable any time:** `emit-testnet-env.ts`, `codegen-addresses.ts`, `forge verify-contract`,
  the reindex, the smoke.
- **One-shot / destructive:** the `forge script --broadcast` deploy (new addresses each run) and
  `down -v` / schema drop (wipes indexed state — intended, forces the fresh backfill).
- If tokens still don't show after all steps: the #1 cause is a **stale indexer image** (rebuild, not
  restart) or a **resumed old checkpoint** (drop schema / bump `DATABASE_SCHEMA`); the #2 cause is a
  `mainnet.env` that was never hand-synced (Step 4a).
