# Runbook — Mainnet-Prep Deploy (contracts + Safe handover + hosting)

**Status:** v1.0, 2026-07-10. Authored by hoodpad-architect + hoodpad-contracts (implementation-plan **P-2**; the M4/M5 handoff register at the bottom is **P-4**). This is a **prepared, not executed** runbook — the Goal is "production-ready, not production-launched" (spec §14 Phase A). Nothing here runs until Gate G-A passes and the user directs a mainnet launch (Phase B / M4).

> **This runbook does not decide human/policy items.** Every step marked **NEEDS-USER** is a placeholder for a decision outside the Goal (§13). The runbook makes the *choreography* executable; the *values* are furnished by the user/ops/security before Phase B.

> **Docs-first rule (mandatory every iteration).** Before executing any step, consult current official docs (context7 MCP → fallback WebFetch):
> - Foundry `forge script` / verification — https://book.getfoundry.sh
> - Safe deployments + Safe{Wallet} — https://docs.safe.global · https://github.com/safe-global/safe-deployments
> - Robinhood Blockscout verifier — https://robinhoodchain.blockscout.com
> - OpenZeppelin Ownable2Step — https://docs.openzeppelin.com/contracts/5.x/api/access
> - Komodo + Cloudflare Workers/OpenNext — see `deploy-komodo-cloudflare.md` doc-link header
>
> Docs beat assumptions; the spec beats docs (flag the conflict).

## 0. Preconditions (must all be green before starting)

- [ ] Gate G-A passed with **explicit user direction** to launch (spec §14; NEEDS-USER) — this runbook is not entered otherwise.
- [ ] Security gates 1–4 green (M1) + gates 5–8 green (M4) — see the M4/M5 handoff register below.
- [ ] `docs/runbooks/env-inventory.md` (P-1) filled with real prod values, including all NEEDS-USER items.
- [ ] Compiler pin + `cancun` target **confirmed against the Robinhood Blockscout verifier** (O-5 / §12.44) — throwaway-contract verify. If `0.8.35`/`cancun` unsupported, the architect records the corrected pin in §12 first; **never silently diverge**.
- [ ] Robinhood **mainnet** chain params (chain id 4663, RPC, Blockscout URL) pulled from official Robinhood docs — never invented; deploy fails if unset (§13).
- [ ] `tools/m0/out/constants.json` reviewed; beta-cap values populated (below, NEEDS-USER).

---

## 1. Contract deploy (order per contracts.md §7.2)

Executed with `script/Deploy.s.sol` (M1-14) against the mainnet RPC. The script is the source of truth for order + assertions; this section narrates it and marks the NEEDS-USER inputs.

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

---

## 3. Off-chain hosting bring-up — see `deploy-komodo-cloudflare.md`

Hosting is fully specified in **`docs/runbooks/deploy-komodo-cloudflare.md`** (spec §12.45). Do **not** duplicate it here — cross-reference:

- **Indexer + API + WS → Komodo Stack** (Postgres+`pg_trgm`, Redis, Ponder Node container, Hono/Bun API + Bun WS fanout co-located with Redis for the <500ms budget). Follow **Part A** (A.5 Dockerfiles, A.6 deploy sequence). Secrets are Komodo-managed from `env-inventory.md` (P-1).
- **Web → Cloudflare Workers** via OpenNext (`@opennextjs/cloudflare`, `nodejs_compat`), OG on the WASM raster backend (native `@resvg/resvg-js` removed for this target). Follow **Part B** (B.2 `wrangler.jsonc`, B.6 OG→WASM, B.7 deploy sequence).

### 3.1 DNS / CDN / R2

- [ ] R2 bucket `robbed-assets` (account `0b1b0b8753489a11d35ee922961f6b72`, §12.45) — pre-created; confirm the API write credentials and the public CDN base (`R2_PUBLIC_BASE_URL` / `NEXT_PUBLIC_R2_PUBLIC_BASE_URL`, env-inventory §2/§3).
- [ ] Custom domain for the Workers frontend (`robbed-web`) + TLS/CDN route (deploy-komodo-cloudflare.md B.7 step 5).
- [ ] Public TLS endpoints for the Komodo API + WS (`NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WS_URL`) behind a reverse proxy/CDN; wire the Workers build vars to these (A.6 step 6).
- [ ] `CORS_ALLOWED_ORIGINS` (API) set to the Workers web origin (env-inventory §2).

### 3.2 Monitoring bring-up (indexer.md §9.4, gate 7)

- [ ] Scrape the indexer `METRICS_PORT 9464` (in-Stack); wire alert rules for: `indexer_head_lag_seconds > 10s`, `ws_publish_to_head_ms p95 > 300ms`, `confirmation_safe_lag_blocks`/`finalized_lag_blocks` stall, `metadata_mismatch_total > 0`, invariant pagers (second `Graduated` for a token; `fee_collections.recipient != treasury`; trade `fee_eth > 2%` of leg), `eth_usd_snapshot_age_seconds > 5m`, `redis_publish_errors_total`.
- [ ] Gate-7 cluster-alert thresholds (§12.36): `perTokenPct 25` / `platformPct 10` / `windowHours 24` — advisory only; final tuning by hoodpad-security before beta.

---

## 4. Rollback procedures

Contracts are **immutable, no proxies** (§6) — there is no contract "rollback." The rollback surface is:

- **Kill-switch (config only):** `pauseCreates` and/or `pauseBuys` via the admin Safe. **Sells are never pausable** (§6.5) — do not attempt; there is no such flag. Curve `ReadyToGraduate` lock is deterministic (§12.12), not a pause.
- **Bad factory version → new factory:** an upgrade is a *new* factory deploy (§6). Point the indexer/UI at the new factory addresses (codegen re-run); the old factory's live curves keep functioning (sells always open, graduation permissionless).
- **Off-chain rollback:** Komodo redeploys by git ref / image digest (deploy-komodo-cloudflare.md A.4 prebuilt-image model for rollback-by-digest); Workers rolls back to a prior deployment/version. These never touch chain state.
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

# M4 / M5 Handoff Register (implementation-plan P-4)

**Everything intentionally left for launch.** This register is the consolidated list of what is *out of the Phase-A Goal* and enters at Phase B (M4/M5), only after Gate G-A passes with explicit user direction. Sources for every item exist today; nothing here is discovered-later.

## H.1 Security gates 5–10 checklist (spec §10)

| Gate | What | Status entering M4 | Owner |
|---|---|---|---|
| 5 | Multi-model LLM audit of all six contracts | not started (out of Goal) | hoodpad-security |
| 6 | Economic red-team — parameterized vs observed §2.2 bot/farm patterns; includes the **UM-2 grief-lock economic proof** (M1-10 Part-2 residual: attacker locks ≳0.08 ETH to freeze 8.08 ETH, non-permanent, third-party-correctable, zero profit) and the **V3Migrator arb-back kill-test follow-up** (M1-13: 5 enumerated adversarial tests + amount-min fork tests) | inputs exist (M1 findings) | hoodpad-security + hoodpad-contracts |
| 7 | **Capped beta (MANDATORY)** — global + per-token caps (O-10), monitoring + alerting on invariant metrics, cluster-alert thresholds (§12.36), kill-switch = pause creates/buys only | caps NEEDS-USER (O-10) | hoodpad-security + architect |
| 8 | Public bug bounty — terms NEEDS-USER (§13) | terms undecided | architect + ops |
| 9 | External-review decision gate (explicit go/no-go on a paid external audit) | decision pending | architect + user |
| 10 | Known-risks / heuristic-metrics disclosure doc published — content sources exist (threat-model, §8.5 heuristics, single-RPC UM-4 disclosure) | content exists, not published | architect |

**All 10 gates required before caps lift (M5).** Capped beta is mandatory, not optional.

## H.2 §13 human decisions still open at launch (NEEDS-USER)

| Item | §13 / §12 ref | Blocks | Owner |
|---|---|---|---|
| Safe signer set (M-of-N, who) + admin SIWE allowlist | O-6 / OI-A8 | deploy §2 + admin auth | architect + ops + USER |
| Beta cap values (`perTokenEthCap`/`globalEthCap`) | O-10 | gate-7 capped-beta deploy | hoodpad-security + USER |
| Moderation vendor (CSAM hash-match + NSFW classifier) + mandated-reporting legal flow | OI-A7 | prod moderation | architect + ops + USER |
| Bug bounty terms | §13 | gate 8 | architect + USER |
| Legal wrapper / ToS jurisdiction (MiCA/JDG) — **BLOCKING at Gate G-A** | §13 / §14 | Phase B entry | USER (legal) |
| WalletConnect projectId | web-6 | WC/Robinhood Wallet connectors | USER |
| Domain + final logo/brand-mark (name RESOLVED `ROBBED_`/`robbed`, §12.46) | §13 | branding | architect + USER |
| Organic-volume floor magnitude (`N` graduations-equiv/7d, Gate G-A.1) | §12.36 / §14 | Gate G-A market call | architect + USER; recalibrate at M2 |
| ETH/USD Chainlink-vs-fallback selection (verification env-gated, needs live 4663 RPC) | OI-6 / §12.48a | prod price source | hoodpad-indexer |
| `safe`/`finalized` RPC tag support (verification env-gated, needs live 4663 RPC) | OI-8 / §12.48b | confirmation source vs L1-watermark fallback | hoodpad-indexer |

## H.3 Beta-cap process (gate 7)

1. hoodpad-security proposes `perTokenEthCap` / `globalEthCap` from risk appetite + M2 organic-volume series; USER ratifies (O-10, §13).
2. Deploy with caps ACTIVE in Factory config (owner-settable — retunable during the beta without redeploy).
3. Monitoring/alerting live (H.1 gate 7): invariant metrics + cluster-alert thresholds (§12.36).
4. Kill-switch drills: confirm `pauseCreates`/`pauseBuys` from the admin Safe; confirm sells are **not** pausable.
5. Ratchet caps upward only as gates hold and metrics stay clean → M5 caps lift once **all 10** gates pass.

## H.4 Anti-sniper decaying + size-based redesign (§12.27) — DEFERRED to pre-caps-lift

- v1 ships the ratified fixed `block.timestamp` window + per-tx `maxEarlyBuyWei` cap (§12.18 mechanism; values §12.32: `windowSeconds = 8`, `maxEarlyBuyWei = 0.201922 ETH`).
- **Redesign (roadmap, pre-caps-lift):** replace the fixed cliff with a **decaying + size-based early-buy fee** — a fee that scales with buy size and decays over time — to blunt multi-wallet bypass (acknowledged in §2.2/§6.5) without a hard cliff. This is a *new curve version* (immutable contracts, §6), not an upgrade of live curves. Owner: hoodpad-contracts + hoodpad-security. Trigger: before M5 caps lift; the M1 mechanism is unchanged until then (§12.27).

## H.5 Bucket-6 pre-M4 operations runbooks (sources exist today — author before M4)

Each is a standalone ops runbook to author before the capped beta. Sources listed are already in-repo.

| # | Runbook | What it covers | Sources |
|---|---|---|---|
| 1 | **RPC failover** | Single-RPC is accepted for v1 (UM-4) with gate-10 disclosure; a **second RPC** is the pre-caps-lift enhancement. Runbook: primary→secondary WS/HTTP switchover for indexer sync + confirmation tracker + ETH/USD poller, health signals, and the manual/automatic cutover. | threat-model §8.1 (UM-4); indexer.md §2/§5.1; spec §11 |
| 2 | **Ponder schema-migration re-index** | Strategy for schema changes that force a re-index: cold start from `START_BLOCK` (publishes suppressed during backfill — no Redis replay storm), blue/green table swap, cutover, and how the API's read-only role tolerates it. | indexer.md §9.3; §7.3 |
| 3 | **Redis seq-reset heal stampede** | On a Redis seq/counter reset, clients REST-heal on reconnect/seq-gap (no WS replay buffer, §12.12/OI-12). Runbook: throttle/jitter the heal so a mass reconnect does not stampede the API; confirmation watermark re-broadcast (§12.20). | indexer.md §8; api.md §3; spec §12.20/§12.23 |
| 4 | **Lost-publish gap signal + poll cadence** | Detect a dropped Redis publish (indexer head advanced but no WS fanout): gap-signal metric + a low-cadence reconcile poll so the UI self-heals; ties to `ws_publish_to_head_ms` + `redis_publish_errors_total` alerts. | indexer.md §9.4; §8 |
| 5 | **graduate/collect cron + stuck-graduation alert** | `graduate()` and `LPFeeVault.collect()` are permissionless; a keeper cron calls them when a curve hits `ReadyToGraduate` / when fees accrue. Alert when a curve is `ReadyToGraduate` beyond a threshold (stuck graduation — ties to the UM-2 grief-lock residual, M1-10 Part-2). The keeper is convenience, not required for correctness (anyone can call). | contracts.md §3.4/§3.5; §12.12; §12.34 caller reward; threat-model §8.1 (UM-2) |
| 6 | **Incident runbook** | On-call flow for the invariant pagers (H.1 gate-7 metrics): second `Graduated`, `fee_collections.recipient != treasury`, `fee_eth > 2%`, solvency spot-check breach, batch-poster/finality stall. Decision tree → kill-switch (`pauseCreates`/`pauseBuys` only, never sells) → comms. | indexer.md §9.4; threat-model §4; spec §6.5 |

**Verify (P-4 leg):** this register enumerates gates 5–10, the §13 human decisions, the beta-cap process, the §12.27 anti-sniper redesign, and each of the six Bucket-6 runbooks; `/spec-check` clean on the final tree (G-10).
