# Runbook — Mainnet-Prep Deploy (contracts + Safe handover + hosting)

**Status:** v1.3, 2026-07-12 (living pre-mainnet checklist). Authored by robbed-architect + robbed-contracts (plan item **P-2**; the M4/M5 handoff register at the bottom is **P-4**). History: v1.1 re-derived the register against spec §13 as of 2026-07-11 (M1 close-out); v1.2 corrected the H.6 `PORT-*`/mutation rows. **v1.3 (this revision) re-dates the whole register + §0 preconditions against TODAY's state — the 2026-07-11 M1-close snapshot was stale.** The delta since M1 close: **testnet chain 46630 is DEPLOYED and all six contracts Blockscout-verified** (`contracts/deployments/46630.json`), O-5 pin `v0.8.35+commit.47b9dedd` + `cancun` **proven on the testnet Blockscout**; partial on-chain lifecycle validated (creation, 6 trades with exact 1% fee + curve math + sells, fee accrual to treasury §12.25). Every register item is now tagged with an explicit status: **DONE** / **BLOCKING** (blocking-before-mainnet, agent-owned) / **RECOMMENDED** / **NEEDS-USER** (§13 human/policy) / **GATE-G-A** (gated on §14 Gate-G-A entry). See **H.0** for the prioritized "what's left" split. This is a **prepared, not executed** runbook — the Goal is "production-ready, not production-launched" (spec §14 Phase A). Nothing here runs until Gate G-A passes and the user directs a mainnet launch (Phase B / M4).

> **Status legend (used throughout this runbook):**
> - **DONE** — completed and evidenced in-repo / on-chain (path or tx cited).
> - **BLOCKING** — must be green before a real chain-4663 mainnet deploy; agent-owned, needs no user decision to *start*. This is the hard code/deploy gate list.
> - **RECOMMENDED** — strongly advised for a real-money launch; a risk decision, not a mechanical gate.
> - **NEEDS-USER** — a human/policy value or ratification outside the Goal (spec §13). The choreography is executable; the value is furnished by the user/ops/security.
> - **GATE-G-A** — gated on Gate G-A (spec §14) passing with explicit user direction; nothing downstream runs until then.

> **This runbook does not decide human/policy items.** Every step marked **NEEDS-USER** is a placeholder for a decision outside the Goal (§13). The runbook makes the *choreography* executable; the *values* are furnished by the user/ops/security before Phase B.

> **Docs-first rule (mandatory every iteration).** Before executing any step, consult current official docs (context7 MCP → fallback WebFetch):
> - Foundry `forge script` / verification — https://book.getfoundry.sh
> - Safe deployments + Safe{Wallet} — https://docs.safe.global · https://github.com/safe-global/safe-deployments
> - Robinhood Blockscout verifier — https://robinhoodchain.blockscout.com
> - OpenZeppelin Ownable2Step — https://docs.openzeppelin.com/contracts/5.x/api/access
> - Cloudflare Workers / OpenNext — https://developers.cloudflare.com/workers · https://opennext.js.org/cloudflare ; backend compose stacks + Cloudflare Tunnels → `docker.md` + `docker-compose.{testnet,mainnet}.yml`
>
> Docs beat assumptions; the spec beats docs (flag the conflict).

## 0. Preconditions (must all be green before starting)

Status tag on each line reflects TODAY (2026-07-12). "must all be green **before starting**" = before the real chain-4663 deploy in §1, not before authoring this runbook.

- [ ] **GATE-G-A** — Gate G-A passed with **explicit user direction** to launch (spec §14; the legal-wrapper/ToS item is BLOCKING at G-A, NEEDS-USER) — this runbook is not entered otherwise.
- [ ] **BLOCKING / GATE-G-A** — Security gates 1–4 green (M1, DONE) + gates 5–8 green (M4). Today: gates 1–4 green incl. gate-3 fork run vs live 4663 and gate-4 calibration pin; **gates 5, 6, 8, 9 still open** and **gate 7 (capped beta) NEEDS-USER on the O-10 caps** — see the M4/M5 handoff register (**H.1**) below.
- [ ] **BLOCKING (partly NEEDS-USER)** — `docs/developers/runbooks/env-inventory.md` (P-1) filled with real prod values. Structure DONE; the NEEDS-USER values (O-6 Safe/`ADMIN_ALLOWLIST`, O-10 caps, OI-A7 moderation, web-6 WalletConnect) are still placeholders — see **H.2**.
- [ ] **BLOCKING** — Compiler pin `0.8.35` + `cancun` target confirmed against a Blockscout verifier. **Proven on the TESTNET Blockscout** (`explorer.testnet.chain.robinhood.com`, `v0.8.35+commit.47b9dedd` / `cancun`, all six verified — `contracts/deployments/46630.json`). **STILL OWED: the MAINNET `robinhoodchain.blockscout.com` round-trip** (O-5 / §12.44) — testnet ≠ mainnet verifier. If the mainnet verifier rejects `0.8.35`/`cancun`, the architect records the corrected pin in spec §12 first; **never silently diverge**.
- [ ] **DONE (sourced) / GATE-G-A (use)** — Robinhood **mainnet** chain params (chain id 4663, RPC `rpc.mainnet.chain.robinhood.com`, Blockscout `robinhoodchain.blockscout.com`) sourced from official Robinhood docs (§12.55); consumed only at Phase B. Deploy fails if unset.
- [ ] **BLOCKING — gas-model leg DONE (§12.62); ETH-peg RE-LOCK owed at deploy** — `tools/m0/out/constants.json` re-derived on a mainnet-fork (real §12.28 V3, 2026-07-12; gate-2 suite green, 182 pass). The **gas-model fixes are locked** (`MIGRATION_GAS_ESTIMATE 3M→1.5M` fork-measured `817,845` gas, cost-based `graduationFee` §12.26, `callerReward` ≥10×-gas floor at 6.2× §12.34). **BUT the ETH-pegged curve constants (`GRADUATION_ETH`, `VIRTUAL_ETH_0`, `CREATION_FEE`, `MAX_EARLY_BUY`, `CALLER_REWARD`, floor, V3 target tick) are a SNAPSHOT at `$1817.62115697` and MUST be re-derived + re-locked against the then-current sourced ETH/USD immediately before the mainnet deploy tx** (see §1 re-lock gate). Beta-cap values (below) remain NEEDS-USER.

---

## 1. Contract deploy (order per contracts.md §7.2)

Executed with `script/Deploy.s.sol` (M1-14) against the mainnet RPC. The script is the source of truth for order + assertions; this section narrates it and marks the NEEDS-USER inputs.

> **DEPLOY-TIME RE-LOCK GATE (§12.62 durability caveat) — run immediately before this deploy.** The ETH-pegged M0 constants MUST be re-derived against a **fresh sourced ETH/USD** (§2 live-query) and `constants.json` regenerated right before the deploy tx: `GRADUATION_ETH`, `VIRTUAL_ETH_0`, `CREATION_FEE`, `MAX_EARLY_BUY`, `CALLER_REWARD`, `organicVolumeFloor`, and the V3 `targetTick` all drift with ETH/USD — the `2026-07-12 $1817.62115697` snapshot is NOT valid at an arbitrary later deploy. `GRADUATION_FEE` is finalized here against **live gas** (§12.26). The gas-model constants (`MIGRATION_GAS_ESTIMATE` etc., fork-measured `817,845` gas) are **durable** and need no re-measure unless the §12.28 V3 addresses or opcode costs change. Do NOT deploy against a stale `constants.json`.

**Deploy order (contracts.md §7.2, steps 1–7):**

1. **Pre-flight assertions (in-script, must pass or revert):**
   - `V3Factory.feeAmountTickSpacing(10000) == 200` (§12.28)
   - `NPM.factory() == V3_FACTORY_ADDRESS`, `NPM.WETH9() == WETH` (§12.28)
   - `WETH == 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (F-2 require)
   - chain id from RPC `== 4663`
2. **Deploy `LPFeeVault`** (immutable, no owner; `collect(tokenId) → treasury` only). Treasury address is a constructor arg → **NEEDS-USER (O-6)**: the Gnosis Safe (§2 below) must exist first, or deploy the vault after the Safe. *(Sequencing: create the Safe in §2 before this step so the treasury address is final; the LPFeeVault treasury is immutable and cannot be changed after deploy.)*
3. **Deploy `V3Migrator`** (immutable; references V3 factory/NPM, WETH, LPFeeVault, treasury for the WETH-dust leg §12.13, and the graduation-fee push).
4. **Deploy `CurveFactory`** with the `FactoryConfig` (§12.39) from `constants.json`:
   - operational fields incl. `treasury` (the Safe), `tradeFeeBps` (1% / 100), `creatorFeeBps` (0), `creationFee`, `graduationFee` (§12.26, cost-based, re-validated at M1), `callerReward` (§12.34), `earlyWindowSeconds` (§12.32 = 8), `maxEarlyBuyWei` (§12.32), **`perTokenEthCap` / `globalEthCap` → NEEDS-USER (O-10)** — see §3.
   - immutable ceilings (`maxCreationFee`, `maxGraduationFee`, `maxCallerReward` = 5×), curve-shape defaults (`virtualEth0`, `virtualToken0`, `curveSupply`, `lpTranche`, `graduationEth`).
   - **Admin owner** is the deployer EOA initially → transferred to a Safe/Ownable2Step admin in §2 (admin ≠ treasury; admin cannot touch live curves or LPFeeVault, §6.6).
5. **Deploy `Router`** (immutable; forwards `msg.sender` as `trader`, §12.15/X-3).
6. **Wire** Router + Migrator addresses into the Factory config (owner-settable).
7. **Canary create + buy** (in-script): create one token, execute the initial buy, assert the V3 pool was pre-initialized at the graduation `sqrtPriceX96` (pre-seeded-pool defense, §12.28). Revert the whole deploy if the canary fails.
8. **Verify all six contracts on Blockscout** (`forge verify-contract` against robinhoodchain.blockscout.com, MIT, exact pin + `cancun`). Repo stays public.
9. **Codegen:** `Deploy.s.sol` emits deploy artifacts → `packages/shared/src/addresses.ts` (generated, never hand-edited) consumed by indexer config + web `lib/addresses.ts`.

**Record after deploy:** factory deploy block → `START_BLOCK` (env-inventory §1); all six addresses → `addresses.ts`.

### Beta caps — NEEDS-USER (O-10, gate 7)

`perTokenEthCap` and `globalEthCap` are **mandatory** at the capped-beta deploy (capped beta is not optional — §10 gate 7). Values are ops/risk numbers set **with hoodpad-security before the mainnet beta deploy** (O-10, §13). They are owner-settable Factory config, not immutable — retunable during the beta.

```
perTokenEthCap = <NEEDS-USER — O-10, hoodpad-security>
globalEthCap   = <NEEDS-USER — O-10, hoodpad-security>
```

Caps are enforced in Factory config and are part of the kill-switch surface (`pauseCreates` / `pauseBuys` only — **sells are never pausable**, §6.5). Testnet placeholders are fine; mainnet values are a NEEDS-USER gate on this step.

---

## 2. Treasury Safe + admin handover (Ownable2Step)

Treasury = **Gnosis Safe**, never a bespoke multisig (§6.6). Two distinct roles, never conflated:
- **Treasury (Safe)** — receives trade fees (via permissionless `sweepFees()`, §12.25), graduation fees, WETH dust (§12.13), and LP trading fees (via `LPFeeVault.collect()`). Cannot pause anything.
- **Admin (Ownable2Step owner of `CurveFactory`)** — sets operational config + `pauseCreates`/`pauseBuys` + caps. **Cannot touch live curves or the LPFeeVault** (§6.6). May itself be a Safe or a dedicated Ownable2Step EOA/multisig-Safe.

### 2.1 Create the Safe — NEEDS-USER (O-6)

- [ ] Pull the **canonical Safe deployment** for chain 4663 from the official registry (github.com/safe-global/safe-deployments); if 4663 is absent, deploy the canonical Safe singletons/factory (never a bespoke multisig). This is the O-6 canonical-Safe check.
- [ ] Create the treasury Safe with the **signer set (M-of-N)** → **NEEDS-USER (O-6)**: who the signers are and the threshold are a human decision (architect + ops, §13). Deploy step 1 (LPFeeVault treasury constructor arg) blocks on this address.

```
Safe signers  = <NEEDS-USER — O-6: [addr1, addr2, …], M-of-N threshold>
Safe address  = <derived after creation — becomes the treasury constructor arg + Factory `treasury`>
```

- [ ] Populate `ADMIN_ALLOWLIST` (env-inventory §2) from the admin signer set once decided (OI-A8 follows O-6).

### 2.2 Ownership handover choreography (Ownable2Step)

`CurveFactory` is `Ownable2Step` (OZ v5). Handover is a two-step accept, so a fat-fingered address cannot brick ownership:

1. Deployer EOA (current owner) calls `transferOwnership(newAdmin)` where `newAdmin` = the admin Safe/owner (NEEDS-USER, from §2.1). This only *nominates*.
2. `newAdmin` calls `acceptOwnership()` from the Safe (a Safe tx requiring M-of-N). Ownership transfers only on accept.
3. Assert `owner() == newAdmin` and the deployer EOA has zero remaining authority.

The LPFeeVault has **no owner** and nothing to hand over (§6.3/§6.6). The Migrator is immutable and unowned. Post-graduation there is **zero pause authority of any kind** (§6.5).

> **Safe-rotation trap (G5-INFO-A, §12.61 / H.5).** A later treasury rotation via `CurveFactory.setTreasury` redirects **curve trade + graduation fees** immediately, but `LPFeeVault.treasury` is **immutable** — ongoing LP `collect()` fees keep flowing to the ORIGINAL treasury until a **new factory/vault version**. Rotating the Safe is therefore NOT a complete live-config change; LP-fee redirection needs a planned factory redeploy. By design (§6.3/§6.6 minimalism — no privileged withdraw path); recorded so ops does not treat a rotation as finished.

---

## 3. Off-chain hosting bring-up

**Hosting reality (2026-07-12; the former Komodo runbook is retired — §12.45 disposition, spec §12.45):** the backend runs from the **compose stacks** and the web app on **Cloudflare Workers**; there is no Komodo anymore.

- **(a) Backend → compose stack** (`docker-compose.testnet.yml` / `docker-compose.mainnet.yml`; stack details in `docker.md`, production container images + gate-7 monitoring configs in `prod-images.md`): Postgres+`pg_trgm`, Redis, Ponder Node container, Hono/Bun API + Bun WS fanout co-located with Redis for the <500ms budget (§8). The stack is exposed publicly via a **Cloudflare Tunnel** (`cloudflared` service in each compose file — no inbound ports). Secrets are stack-managed from `env-inventory.md` (P-1).
- **(b) Web → Cloudflare Workers** via OpenNext (`@opennextjs/cloudflare`, `nodejs_compat`; spec §12.45). OG rendering was relocated web→API (§12.53), so the Worker ships no raster dependency. `apps/web/wrangler.jsonc` + `open-next.config.ts` + the `deploy:cf` scripts (web.md "Deploy target"); per-env resolution in `environments.md`; custom domains attach once DNS is on Cloudflare (§3.1).

### 3.1 DNS / CDN / R2

- [ ] R2 bucket `robbed-assets` (account `0b1b0b8753489a11d35ee922961f6b72`, §12.45) — pre-created; confirm the API write credentials and the public CDN base (`R2_PUBLIC_BASE_URL` / `NEXT_PUBLIC_R2_PUBLIC_BASE_URL`, env-inventory §2/§3).
- [ ] Domains are **DECIDED (§12.49):** `robbed.fun` (mainnet) / `testnet.robbed.fun` (testnet). **DNS cutover DONE (2026-07-12):** both are on Cloudflare (account `0b1b0b8753489a11d35ee922961f6b72`) and currently **served via Cloudflare Tunnel** from the compose stacks (`cloudflared` service in each compose file) — the "mainnet" tunnel fronts the 46630-interim stack until a real 4663 deploy exists. Worker custom-domain attach is now unblocked; the interim tunnel path vs a final Worker custom-domain is an ops choice (still a §13 brand residual for OG mark + wordmark, H.2). *(Spec §12.55's DNS bullet was updated 2026-07-12 to "DNS cutover DONE — tunnel-served" to match this state.)*
- [ ] Custom domain for the Workers frontend (`robbed-web`) + TLS/CDN route.
- [ ] Public TLS endpoints for the backend API + WS (`NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WS_URL`) via the Cloudflare Tunnel; wire the Workers build vars to these.
- [ ] `CORS_ALLOWED_ORIGINS` (API) set to the Workers web origin (env-inventory §2). **Gap closed 2026-07-12:** the API now reads it (`apps/api/src/mw/cors.ts`, api.md §6.1 — public `/v1` only, admin/internal never opened; prod boot fails when unset). No reverse-proxy CORS layer needed.

### 3.2 Monitoring bring-up (indexer.md §9.4, gate 7)

Configs landed at P-3: `docker/monitoring/prometheus.yml` + `docker/monitoring/rules/gate7.rules.yml` + `docker/monitoring/alertmanager.yml`, deployed via the `tools/deploy/komodo/compose.monitoring.yaml` overlay — see `docs/developers/runbooks/prod-images.md` §4 (threshold provenance + placeholders).

- [ ] Scrape the indexer `METRICS_PORT 9464` (in-Stack); wire alert rules for: `indexer_head_lag_seconds > 10s`, `ws_publish_to_head_ms p95 > 300ms`, `confirmation_safe_lag_blocks`/`finalized_lag_blocks` stall, `metadata_mismatch_total > 0`, invariant pagers (second `Graduated` for a token; `fee_collections.recipient != treasury`; trade `fee_eth > 2%` of leg), `eth_usd_snapshot_age_seconds > 5m`, `redis_publish_errors_total`.
- [ ] Gate-7 cluster-alert thresholds (§12.36): `perTokenPct 25` / `platformPct 10` / `windowHours 24` — advisory only; final tuning by hoodpad-security before beta.

---

## 4. Rollback procedures

Contracts are **immutable, no proxies** (§6) — there is no contract "rollback." The rollback surface is:

- **Kill-switch (config only):** `pauseCreates` and/or `pauseBuys` via the admin Safe. **Sells are never pausable** (§6.5) — do not attempt; there is no such flag. Curve `ReadyToGraduate` lock is deterministic (§12.12), not a pause.
- **Bad factory version → new factory:** an upgrade is a *new* factory deploy (§6). Point the indexer/UI at the new factory addresses (codegen re-run); the old factory's live curves keep functioning (sells always open, graduation permissionless).
- **Off-chain rollback:** the compose stack redeploys by git ref / image digest (`docker.md` prebuilt-image model for rollback-by-digest); Workers rolls back to a prior deployment/version. These never touch chain state.
- **Data rollback:** Ponder re-index from `START_BLOCK` on schema change (see the Ponder re-index runbook in the handoff register below). Indexer owns writes; API has read-only role on indexer tables, so an indexer rollback cannot corrupt API-owned moderation tables.

---

## 5. Post-deploy verification

- [ ] All six contracts Blockscout-verified (MIT, exact pin + `cancun`).
- [ ] Full lifecycle exercised on mainnet with a canary: create → trade → `graduate()` (permissionless) → `collect()` → `sweepFees()`. Assert at all three layers (on-chain state, indexed record, reconciled UI).
- [ ] Graduation pre-seeded-pool defense confirmed (pool initialized at graduation `sqrtPriceX96`; hostile-ratio mint impossible — gate-2 invariant 6).
- [ ] `owner() == admin Safe`; deployer EOA powerless; treasury == Safe; LPFeeVault unowned.
- [ ] Confirmation tiers (soft-confirmed → posted → finalized) surfaced in indexer + UI.
- [ ] Beta caps active and enforced (O-10 values); kill-switch (`pauseCreates`/`pauseBuys`) reachable from the admin Safe; sells demonstrably NOT pausable.

---
---

# M4 / M5 Handoff Register (plan item P-4)

**Everything intentionally left for launch.** This register is the consolidated list of what is *out of the Phase-A Goal* and enters at Phase B (M4/M5), only after Gate G-A passes with explicit user direction. Sources for every item exist today; nothing here is discovered-later. **Re-dated 2026-07-12 against real current state** — the previous snapshot was the 2026-07-11 M1 close-out.

## H.0 Current state + prioritized "what's left" (read this first)

**Where we actually are (2026-07-12):**
- **Testnet (chain 46630): DEPLOYED, all six contracts Blockscout-verified** (`contracts/deployments/46630.json`; O-5 pin `v0.8.35+commit.47b9dedd` + `cancun` proven on the testnet Blockscout). Off-chain testnet stack live via Cloudflare Tunnel (`testnet.robbed.fun`).
- **On-chain lifecycle PARTIALLY validated on a live chain:** creation, 6 trades (exact 1% fee, curve math, sells), and fee accrual to treasury (§12.25) — confirmed on-chain, **tx-hash record DELIVERED in `docs/developers/runbooks/testnet-lifecycle.md`** (token XROB on 46630; referenced by `testnet.md` §7). **A real `graduate()` has NEVER run on any live chain** (faucet-limited — `testnet-lifecycle.md` §3 records it as not-yet-exercised) — this is the single largest untested path (**B1**).
- **Mainnet (chain 4663): NOT deployed.** The registry's `4663.json` is now correctly a **`mode:"fork"` mainnet-fork artifact** — the §12.55 mislabel is **FIXED (B2 resolved)**. It carries an Anvil dev-account treasury (`0x7099…79C8`), which is precisely why it is `fork`, not `live`; the codegen fail-closes on any live+anvil-treasury artifact so a fork can never masquerade as mainnet. The "mainnet" compose stack still boots against 46630 as an interim because no real 4663 deploy exists; `robbed.fun` is on Cloudflare (tunnel-served interim) but points at that interim, not a real mainnet.

**BLOCKING before a real chain-4663 mainnet deploy (agent-owned, no user decision required to start):**

| ID | Item | Why blocking | Owner |
|---|---|---|---|
| **B1** | **Real graduation dry-run → funded-testnet graduation → mainnet canary.** `graduate()` + V3Migrator arb-back + `LPFeeVault.collect()` + `sweepFees()` end-to-end have never executed on a live chain. Sequence: (1) **fork-dry-run** on a mainnet-fork (deterministic, unlimited); (2) **funded-testnet graduation** (needs faucet top-ups past one drip — §12.52 gives 0.05 ETH/24h, GRADUATION_ETH ≈ 7.92 ETH, so multiple drips or a funded key); (3) **mainnet canary** in §1 step 7 + §5. Nothing else exercises the pre-seeded-pool defense (gate-2 invariant 6) against real chain state. | Largest untested path; graduation is single-fire, permissionless, and irreversible | robbed-contracts + robbed-security |
| ~~**B2**~~ **RESOLVED 2026-07-12** | **§12.55 fork-artifact `mode` labeling — DONE.** `Deploy.s.sol` `_selectMode(chainId, mainnetAffirmed)` defaults chain 4663 to `Mode.Fork` and emits `Mode.Live` only on an explicit `ROBBED_DEPLOY_ENV=="mainnet"` affirmation; `codegen-addresses.ts` fail-closes if any artifact is `mode:"live"` on a non-4663 chain OR carries a well-known Anvil dev-account treasury; `packages/shared/src/addresses.ts` now carries 4663 as `mode:"fork"` — no false live entry. The indexer's §12.55 chain-identity gate asserts `mode == "live"` for a canonical mainnet, so a fork cannot masquerade. **Accurate residual: mainnet still not deployed — but the artifact no longer lies.** | was: an artifact that lies about being live could pollute a real deploy/indexer wiring | robbed-contracts (DONE) |
| **B3** | **Economics re-derivation — gas-model DONE (§12.62); ETH-peg RE-LOCK at deploy.** DONE 2026-07-12 on a mainnet-fork (real §12.28 V3, gate-2 green 182 pass): gas-model fixed (`3M→1.5M` fork-measured `817,845` gas, cost-based `graduationFee` §12.26, `callerReward` 6.2× ≥ the §12.34 10×-gas floor) — **durable**. **RESIDUAL (a durable requirement, not a one-time task):** the ETH-pegged constants (`GRADUATION_ETH` / `VIRTUAL_ETH_0` / `CREATION_FEE` / `MAX_EARLY_BUY` / `CALLER_REWARD` / floor / tick) are a snapshot at `$1817.62115697` and MUST be **re-derived + re-locked against fresh sourced ETH/USD immediately before the mainnet deploy tx** (§0 / §1). Constants never inlined (§2). | Gas-model was a placeholder (now fixed); the ETH peg drifts continuously → must be current at the deploy tx | robbed-contracts + robbed-security |
| **B4** | **Mainnet Blockscout O-5 round-trip.** Verify pin `0.8.35` + `cancun` against `robinhoodchain.blockscout.com` (throwaway-contract check). Testnet Blockscout proved it; the mainnet verifier is a distinct instance and still owed. | The §0 precondition; a pin the mainnet verifier rejects fails every contract verification at deploy | robbed-contracts |

**Dependency RESOLVED — gate 6 → UM-2 Part-2 (2026-07-12, §12.61):** the gate-6 economic red-team ran on the live fork (block 7,964,424, real V3) and **UM-2 Part-2 is dispositioned (a)** — the grief is **uneconomic** (attacker cost ~0.10–0.20 ETH ≈ 1.3–2.5% of the 7.92-ETH curve, profit 0, non-permanent) and **third-party correctable AT A PROFIT** (a harmed holder restores the tick for ≈+0.025 ETH, then `graduate()` succeeds); never a hostile mint (gate-2 invariant 6, 384 lifecycles). Restated precisely: (a) holds in the **incentive** sense (uneconomic + self-correcting), not the literal "prohibitively expensive" cost sense. Sanctioned closure = (i) a permissionless atomic **correct-and-graduate** periphery/keeper path (NON-§12.12-touching) + (ii) gate-7 standing-corrector monitoring on `ReadyToGraduate`-stall — **neither needs user ratification**. The **only user residual is the OPTIONAL sells-reopening §12.12-touching hatch (variant c)** — recorded NEEDS-USER risk-tolerance, **NOT mandatory**; recommendation is to proceed with (a) without (c) unless the user opts in. Tuning: raise `MIGRATION_SLIPPAGE_BPS` to widen the freeze cost (calibration-safe); `TOLERANCE_TICKS` is BLOCKED (GradCalibrationGuard proves 101 ticks violates). See H.6.

**RECOMMENDED for a real-money launch (risk decisions, not mechanical gates):**
- **Gate 9 — external audit go/no-go.** Strongly recommended before real money; the explicit decision is NEEDS-USER (architect + user). The gate-5 adversarial-AI pass is DONE, but a **≥3-frontier-model panel + a paid external firm** roll up here. See H.1.
- ~~Gate 5 multi-model audit~~ **DONE** — adversarial-AI pass on the live fork; no fund-loss; info-only findings G5-INFO-A/B/C (§12.61). Residual (broader model panel + external firm) folds into gate 9.

**NEEDS-USER (§13 human/policy — the runbook is blocked on the value, not the choreography):** O-6 real M-of-N treasury Safe (the current treasury is an Anvil dev account, not a Safe); O-10 beta caps; OI-A7 moderation vendor + mandated-reporting flow; legal wrapper / ToS (**BLOCKING at Gate G-A**); web-6 WalletConnect projectId; brand residuals (OG mark + header wordmark). See **H.2**.

**Operational — partially done vs still owed (H.5):**
- **DONE:** Cloudflare Tunnels + compose stacks live (testnet + mainnet-interim); archive-RPC fallback landed (`apps/indexer/src/latestReader.ts` / `curveReader.ts` — deterministic event-block reads degrade gracefully on a non-archive node); §12.55 indexer chain-identity gate landed.
- **OWED:** provisioned **Alchemy mainnet archive RPC** (`robinhood-mainnet.g.alchemy.com`), **monitoring/alerting bring-up** (gate 7, §3.2), and the **incident runbooks (H.5 #6 + siblings)**.

**Spec fixes — APPLIED 2026-07-12** (after the frontend redesign released spec.md): (1) §12.36's organic-floor parenthetical corrected "≈ 7.92 ETH" → **"≈ 39.58 ETH"** (= 5 × `GRADUATION_ETH`; the wei value + `floorGraduationsEquiv = 5` were always right); (2) the §12.55 DNS-prerequisite bullet (+ its §13 residual echo) updated to **"DNS cutover DONE — on Cloudflare, tunnel-served"** to match H.0.

## H.1 Security gates 5–10 checklist (spec §10)

| Gate | What | Status (2026-07-12) | Owner |
|---|---|---|---|
| 1–4 | Contract invariants + fuzz/invariant + fork run + mutation adequacy | **DONE** — gate-3 fork run GREEN vs live 4663 (pinned block, independently reproduced); gate-4 calibration pin fail-closed in `Deploy.s.sol` + `GradCalibrationGuard.t.sol`; adequacy 0.800 (H.6). Re-opens if a §12.32/§12.33 beta retune breaks the calibration bound. | robbed-contracts + robbed-security |
| 5 | Adversarial-AI audit of all six contracts | **DONE — adversarial-AI pass on the live fork (block 7,964,424); no fund-loss.** Deepest single-model audit; a **≥3-frontier-model panel + a paid external firm remain RECOMMENDED** and roll up into gate 9. Info-only findings G5-INFO-A/B/C recorded (H.5 ops + §2). (§12.61) | robbed-security |
| 6 | Economic red-team — parameterized vs observed §2.2 bot/farm patterns; includes the **UM-2 grief-lock economic proof** (M1-10 Part-2 residual) and the **V3Migrator arb-back kill-test follow-up** (M1-13: 5 enumerated adversarial tests + amount-min fork tests). Consumes the **B3** real-mainnet-gas economics. | **DONE on the live fork (block 7,964,424) — PASS on safety** (gate-2 invariants held over 384 lifecycles). **UM-2 Part-2 dispositioned (a)** (§12.61 / H.6). G6-1 multi-wallet bypass (acknowledged §6.5); **G6-2 (Medium) sandwich residual** → frontend 2% default slippage + deadline (shipped, `DEFAULT_SLIPPAGE_BPS=200`). | robbed-security + robbed-contracts |
| 7 | **Capped beta (MANDATORY)** — global + per-token caps (O-10), monitoring + alerting on invariant metrics, cluster-alert thresholds (§12.36), kill-switch = pause creates/buys only | **NEEDS-USER** on the O-10 cap values; metrics hooks exist (§3.2), alert **delivery** owed (H.5) | robbed-security + architect + USER |
| 8 | Public bug bounty — terms NEEDS-USER (§13) | **NEEDS-USER** — terms undecided | architect + ops + USER |
| 9 | External-review decision gate (explicit go/no-go on a paid external audit) | **RECOMMENDED for real money + NEEDS-USER** — decision pending | architect + USER |
| 10 | Known-risks / heuristic-metrics disclosure doc published — content sources exist (threat-model, §8.5 heuristics, single-RPC UM-4 disclosure) | content exists, **not published** | architect |

**All 10 gates required before caps lift (M5).** Capped beta is mandatory, not optional.

## H.2 §13 open items still pending at launch (re-derived from spec §13 as of 2026-07-12)

**Closed since register v1.0 (removed from the table):** OI-6 ETH/USD source — Chainlink CONFIRMED on 4663, proxy `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` with fail-closed startup assertions (§12.51); OI-8 `safe`/`finalized` tags — SUPPORTED on the official RPC, M2-3b L1-watermark fallback stays dormant/not funded (§12.48b); OI-11 confirmation materialization — sidecar `event_confirmations` table MANDATORY on ponder 0.16.8, direct-UPDATE rework in flight at robbed-indexer (§12.48c); web-10 large-value threshold = 1.0 ETH config (§12.47); testnet chain params — id 46630/RPC/WS/explorer (§12.49); **O-8 WETH-leg arb budget *definition* — formally CLOSED by architect ratification (spec §12.33 update, 2026-07-11):** the M1-10 Part-1 symmetric per-leg rule (`wethArbBudget = wethForMint × MIGRATION_SLIPPAGE_BPS / 10_000`; token leg mirrors it) IS the demanded definition, proven in gate-2 invariant 6 — the gate-6 griefing-cost quantification + UM-2 Part-2 residual remain caps-lift (M4) items, tracked via threat-model §8.1 / gate 6, not this row (ratified 2026-07-11; ledger retired 2026-07-12 — history: git).

Human decisions (NEEDS-USER):

| Item | §13 / §12 ref | Blocks | Owner |
|---|---|---|---|
| **Real M-of-N treasury Safe** (signer set + threshold) + admin SIWE allowlist. **Today the treasury is an Anvil dev account** (`0x7099…79C8` in the fork artifact, §12.55 / B2) — NOT a Safe. O-6 furnishes the canonical Gnosis Safe (never a bespoke multisig, §6.6); the LPFeeVault treasury constructor arg is immutable, so the Safe must exist before §1 step 2 | O-6 / OI-A8 | deploy §2 + admin auth + LPFeeVault treasury | architect + ops + USER |
| Beta cap values (`perTokenEthCap`/`globalEthCap`) | O-10 | gate-7 capped-beta deploy | robbed-security + USER |
| Moderation vendor (CSAM hash-match + NSFW classifier) + mandated-reporting legal flow | OI-A7 | prod moderation | architect + ops + USER |
| Bug bounty terms | §13 | gate 8 | architect + ops + USER |
| Legal wrapper / ToS jurisdiction (MiCA/JDG) — **BLOCKING at Gate G-A** | §13 / §14 | Phase B entry | USER (legal) |
| WalletConnect projectId | web-6 | WC/Robinhood Wallet connectors | USER |
| Branding residuals: name RESOLVED (`ROBBED_`/`robbed`, §12.46), domains DECIDED (`robbed.fun`/`testnet.robbed.fun`, §12.49). **DNS cutover now DONE** — `robbed.fun` + `testnet.robbed.fun` are on Cloudflare and served via Cloudflare Tunnel from the compose stacks (interim; the "mainnet" tunnel currently fronts the 46630-interim stack). Worker custom-domain attach is now unblocked. **Still open (NEEDS-USER):** OG brand mark + header wordmark styling | §13 / §12.49 | OG images; final Worker custom-domain vs tunnel choice | architect + USER |
| Organic-volume floor magnitude (`N` graduations-equiv/7d, Gate G-A.1; M0 default `N = 5`, `floorWei = 5 × GRADUATION_ETH ≈ 39.58 ETH`) | §12.36 / §14 | Gate G-A market call | architect + USER; recalibrate at M2 |

Mechanical §13 items still open (not human decisions, still pending at launch):

| Item | Ref | When | Owner |
|---|---|---|---|
| Compiler pin `0.8.35` + `cancun` on the **TESTNET** Blockscout — **DONE** (`v0.8.35+commit.47b9dedd` / `cancun`, all six verified, `contracts/deployments/46630.json`) | O-5 / §12.44 / §12.52 | closed (Phase T) | robbed-contracts |
| Compiler pin `0.8.35` + `cancun` on the **MAINNET** `robinhoodchain.blockscout.com` verifier — **STILL OWED (B4)**: distinct verifier instance; throwaway-contract round-trip before first mainnet deploy | O-5 / §12.44 | before first mainnet deploy | robbed-contracts |
| ~~Robinhood testnet **faucet URL**~~ — **CLOSED 2026-07-11 (§12.52):** `faucet.testnet.chain.robinhood.com` (0.05 ETH + 5 of each stock token / 24h; Chainlink + QuickNode fallbacks) — see `docs/developers/runbooks/testnet.md` §3. **Caveat (B1):** one drip covers many deploys but **not** a full graduation (`GRADUATION_ETH ≈ 7.92 ETH`), which is why a live-chain graduation is still untested | §13 → §12.52 | closed (faucet); graduation funding open (B1) | robbed-contracts |
| Weekly hood.fun traction snapshot (tokens/day, graduations, visible volume) — Gate G-A input; indexer job M2-14 exists, needs a configured source (`COMPETITOR_SNAPSHOT_INTERVAL_MS`, env-inventory §1) or manual/Dune | §13 / §8.5.3 | ongoing until G-A | robbed-indexer + architect |

## H.3 Beta-cap process (gate 7)

1. robbed-security proposes `perTokenEthCap` / `globalEthCap` from risk appetite + M2 organic-volume series + the **B3** real-mainnet-gas economics; USER ratifies (O-10, §13).
2. Deploy with caps ACTIVE in Factory config (owner-settable — retunable during the beta without redeploy).
3. Monitoring/alerting live (H.1 gate 7): invariant metrics + cluster-alert thresholds (§12.36).
4. Kill-switch drills: confirm `pauseCreates`/`pauseBuys` from the admin Safe; confirm sells are **not** pausable.
5. Ratchet caps upward only as gates hold and metrics stay clean → M5 caps lift once **all 10** gates pass.

## H.4 Anti-sniper decaying + size-based redesign (§12.27) — DEFERRED to pre-caps-lift

- v1 ships the ratified fixed `block.timestamp` window + per-tx `maxEarlyBuyWei` cap (§12.18 mechanism; values §12.32: `windowSeconds = 8`, `maxEarlyBuyWei = 0.197915 ETH`).
- **Redesign (roadmap, pre-caps-lift):** replace the fixed cliff with a **decaying + size-based early-buy fee** — a fee that scales with buy size and decays over time — to blunt multi-wallet bypass (acknowledged in §2.2/§6.5) without a hard cliff. This is a *new curve version* (immutable contracts, §6), not an upgrade of live curves. Owner: hoodpad-contracts + hoodpad-security. Trigger: before M5 caps lift; the M1 mechanism is unchanged until then (§12.27).

## H.5 Bucket-6 pre-M4 operations runbooks (sources exist today — author before M4)

Each is a standalone ops runbook to author before the capped beta. Sources listed are already in-repo.

**Status (2026-07-12):** the *infrastructure* under several of these is partly built — Cloudflare Tunnels + compose stacks are **live** (testnet + mainnet-interim), the **archive-RPC fallback landed** (`apps/indexer/src/latestReader.ts` / `curveReader.ts`: a pruned/non-archive node degrades gracefully instead of silently missing event-block immutables), and the §12.55 chain-identity gate is in. **Still OWED before M4:** a provisioned **Alchemy mainnet archive RPC** (`robinhood-mainnet.g.alchemy.com`, the #1 second-RPC enhancement), **monitoring/alerting bring-up** (§3.2 configs landed at P-3; *deployment + delivery* owed), and the **incident runbook (#6)**. The runbook *documents* below are still unwritten.

**Gate-5/6 informational findings (ops notes — recorded 2026-07-12, §12.61; none is a fund-loss bug):**
- **G5-INFO-A — treasury-rotation split-brain (feeds the keeper + incident runbooks #5/#6, and §2).** `CurveFactory.treasury` is owner-settable (`setTreasury`), but `LPFeeVault.treasury` is **immutable** (§6.6). Rotating the Safe redirects **curve trade + graduation fees** immediately, but **ongoing LP `collect()` fees keep flowing to the OLD treasury until a new factory/vault version**. By design (the LPFeeVault has no privileged/withdraw path, §6.3/§6.6) — but an operational trap: **a Safe rotation ⇒ plan a new factory version**, never a live-config fix.
- **G5-INFO-B —** `setAntiSniper` / `setCaps` are unbounded but **buy-side only** (never touch sells §6.5); ops note, not a sells-pause path.
- **G5-INFO-C —** the graduation calibration margin is sharp (≈0.005%) but **guarded** — `MIGRATION_SLIPPAGE_BPS` is the safe freeze-cost dial; `TOLERANCE_TICKS` is BLOCKED (`GradCalibrationGuard` proves 101 ticks violates the fail-closed bound in `Deploy.s.sol`; UM-2 tuning is slippage-bps only).
- **G6-2 (Medium) — sandwich residual (frontend obligation, already shipped).** A zero-slippage victim on a thin early curve can lose up to **~17%**, bounded by the victim's own slippage. The trade UI ships a sane default slippage + deadline: **`DEFAULT_SLIPPAGE_BPS = 200` (2%)** is the shared floor for the trade widget + launch initial-buy preview, with a non-zero floor and a client-recomputed `deadline`. **2% is the recorded default floor** (retunable in the capped beta).

| # | Runbook | What it covers | Sources |
|---|---|---|---|
| 1 | **RPC failover** | Single-RPC is accepted for v1 (UM-4) with gate-10 disclosure; a **second RPC** is the pre-caps-lift enhancement. Runbook: primary→secondary WS/HTTP switchover for indexer sync + confirmation tracker + ETH/USD poller, health signals, and the manual/automatic cutover. | threat-model §8.1 (UM-4); indexer.md §2/§5.1; spec §11 |
| 2 | **Ponder schema-migration re-index** | Strategy for schema changes that force a re-index: cold start from `START_BLOCK` (publishes suppressed during backfill — no Redis replay storm), blue/green table swap, cutover, and how the API's read-only role tolerates it. | indexer.md §9.3; §7.3 |
| 3 | **Redis seq-reset heal stampede** | On a Redis seq/counter reset, clients REST-heal on reconnect/seq-gap (no WS replay buffer, §12.12/OI-12). Runbook: throttle/jitter the heal so a mass reconnect does not stampede the API; confirmation watermark re-broadcast (§12.20). | indexer.md §8; api.md §3; spec §12.20/§12.23 |
| 4 | **Lost-publish gap signal + poll cadence** | Detect a dropped Redis publish (indexer head advanced but no WS fanout): gap-signal metric + a low-cadence reconcile poll so the UI self-heals; ties to `ws_publish_to_head_ms` + `redis_publish_errors_total` alerts. | indexer.md §9.4; §8 |
| 5 | **graduate/collect cron + stuck-graduation alert** | `graduate()` and `LPFeeVault.collect()` are permissionless; a keeper cron calls them when a curve hits `ReadyToGraduate` / when fees accrue. Alert when a curve is `ReadyToGraduate` beyond a threshold (stuck graduation — ties to the UM-2 grief-lock residual, M1-10 Part-2). The keeper is convenience, not required for correctness (anyone can call). | contracts.md §3.4/§3.5; §12.12; §12.34 caller reward; threat-model §8.1 (UM-2) |
| 6 | **Incident runbook** | On-call flow for the invariant pagers (H.1 gate-7 metrics): second `Graduated`, `fee_collections.recipient != treasury`, `fee_eth > 2%`, solvency spot-check breach, batch-poster/finality stall. Decision tree → kill-switch (`pauseCreates`/`pauseBuys` only, never sells) → comms. | indexer.md §9.4; threat-model §4; spec §6.5 |

## H.6 Caps-lift residuals from the M1 close-out (recorded 2026-07-11, M1-15 register)

Folded in so nothing recorded this week is rediscovered at M4:

| Residual | What | Trigger / owner |
|---|---|---|
| ~~**14 fork-gated mutation survivors**~~ **DISCHARGED 2026-07-12** | Gate-3 fork run GREEN vs live 4663 (2/2, pinned block 7,210,863; independently reproduced by robbed-security). All 14 re-dispositioned **DID (local-calibration; fork-confirmed unmutated-min liveness)** — 0 env-gated remain; adequacy stays 0.800 (dispositions, not kills). The equivalence is **calibration-contingent** and now PINNED fail-closed: `1.0001^TOLERANCE_TICKS × (1 − MIGRATION_SLIPPAGE_BPS/10⁴) ≤ 1` asserted in `Deploy.s.sol` `_consistencyChecks` + `test/unit/GradCalibrationGuard.t.sol`; a §12.32/§12.33 beta retune past the bound fails the deploy and re-opens gate 4 (`contracts/reports/mutation/README.md` §Calibration contingency). | closed (security re-gate PASS 2026-07-12) |
| **UM-2 Part-2 hatch** — **DISPOSITIONED (a) RATIFIED 2026-07-12 (§12.61); CLOSED except optional (c)** | Gate 6 (live fork, block 7,964,424) quantified it: freezing `graduate()` costs the attacker **~0.10–0.20 ETH (1.3–2.5% of the 7.92-ETH curve), profit 0, non-permanent, third-party correctable AT A PROFIT** (a harmed holder restores the tick for ≈+0.025 ETH → next `graduate()` succeeds — refutes the "no corrector incentive" worry); never a hostile mint (gate-2 invariant 6). **Disposition (a) RATIFIED in the INCENTIVE sense** (uneconomic + self-correcting), not the literal "prohibitively expensive" cost sense. **Closed via two conditions, NEITHER user-gated:** (i) a permissionless atomic **correct-and-graduate** periphery/keeper path (NON-§12.12-touching; both ops already permissionless → composable) + (ii) gate-7 standing-corrector monitoring on `ReadyToGraduate`-stall (H.5 #5). **ONLY residual = OPTIONAL variant (c)** — the sells-reopening §12.12-touching hatch — recorded **NEEDS-USER risk-tolerance, NOT mandatory**; recommendation: ship (a) without (c). Tuning: `MIGRATION_SLIPPAGE_BPS` widens the cost (calibration-safe); `TOLERANCE_TICKS` BLOCKED (GradCalibrationGuard: 101 ticks violates). | closed except optional (c) — robbed-contracts (periphery) + robbed-security (monitoring); USER only if (c) |
| ~~**`PORT-*` flow ratification**~~ **CLOSED 2026-07-11** *(row updated 2026-07-12 — was stale: "ratification pending")* | **PORT-1..8** authored (`apps/web/e2e/user-flows.md` §3b addendum + 8 waiver rows) and **RATIFIED by the architect the same day** (sign-off line in the `apps/web/e2e/user-flows.md` header; advisory-read semantics ratified — ruling folded into spec §12, ledger retired 2026-07-12). **44 flows = the I-5a `e2e:coverage` baseline.** Row retained for register completeness only — nothing pending, never was a launch item. | closed (was: robbed-architect, pre-I-5a) |

**Verify (P-4 leg):** this register leads with the H.0 prioritized "what's left" split (BLOCKING B1–B4 + the gate-6→UM-2 dependency + RECOMMENDED + NEEDS-USER + operational done/owed), then enumerates gates 1–10 (statuses as of 2026-07-12), the §13 open set re-derived as of 2026-07-12 (human + mechanical), the beta-cap process, the §12.27 anti-sniper redesign, each of the six Bucket-6 runbooks, and the H.6 caps-lift residuals; `/spec-check` clean on the final tree (G-10 — runs at Goal exit once Phase P fully lands). Two spec corrections were applied 2026-07-12 once the frontend redesign released spec.md (H.0: §12.36 "≈ 7.92 ETH" → "≈ 39.58 ETH"; §12.55 DNS bullet → "cutover DONE, tunnel-served").
