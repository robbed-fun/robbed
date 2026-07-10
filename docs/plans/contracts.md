# Per-Service Plan — Smart Contracts

**Owner:** hoodpad-contracts · **Driving doc:** docs/services/contracts.md · **Generated:** 2026-07-10

> **Authority:** `docs/implementation-plan.md` is the single `/goal` checkbox authority. This file is DETAIL keyed to its item IDs (`⇐ M1-x`). It never contradicts the master plan or a spec §12 decision; added granularity here is sub-tasks under a master item, never a new commitment. If this plan and the master ever disagree, the master wins and this file is corrected. See [README](README.md).

> **Docs-first (every task):** before touching any library, consult the current canonical docs via context7 (`resolve-library-id`) or the fallback URL — never code from memory. The libraries this service touches and their authoritative sources are pinned in §Decisions below. Docs beat assumptions; the spec beats docs (flag the conflict, don't silently resolve).

## Current on-disk state (freeze snapshot — verify, don't recreate)

The initial commit already froze some artifacts. This changes the *starting point* of several items, not their master IDs.

| Master | On disk now | Remaining work |
|---|---|---|
| M1-1 | `constants.json.external` present but **`v3Factory`/`positionManager`/`treasurySafe` = `0x000…000`, and `swapRouter02`/`quoterV2` keys absent** | populate the four §12.28 addresses + add the two missing keys + runtime assertions (NOT started) |
| M1-2 | `foundry.toml` pins `solc = "0.8.35"` with a header comment claiming verifier-config confirmation (2026-07-09) | throwaway-contract verification + GUID recorded in `docs/runbooks/toolchain.md` (the master's actual closure) |
| M1-3 | `src/interfaces/*` (6 first-party + 6 external, 710 lines incl. `errors/Errors.sol`) filled and non-stub | `events.json` codegen → `packages/shared` (NOT on disk); confirm interfaces compile against impls |
| M1-4 | 7 invariant files + `handlers/CurveHandler.sol` + `handlers/PoolGriefHandler.sol` + `mocks/MockArbSys.sol` (+ `MockArbSys.t.sol`, `fork/Lifecycle.t.sol` skeletons) | `test/fuzz/` is **empty** (`.gitkeep` only); **no `MockWETH9`** mock; skeletons not yet compiling against real impls |
| M0 | `tools/m0/out/constants.json` + `constants.ts` + `Constants.sol.txt` present | consumed by M1-1 (external.*) and M1-14 (loader); schema drift above must close first |

Everything under `src/` is interfaces/errors/libs scaffolding only — **no implementation contract exists yet** (`LaunchToken`, `CurveFactory`, `BondingCurve`, `Router`, `V3Migrator`, `LPFeeVault`, `libs/CurveMath` all NOT started).

## Build order (dependency graph)

```
M1-1 wire V3 addrs ─┐
M1-2 pin verify ────┤
M1-3 interfaces ────┼─► M1-5 LaunchToken ─► M1-6 CurveMath ─► M1-7 Factory ─► M1-8 BondingCurve ─► M1-10 Migrator+Vault
M1-4 test skeletons ┘   (fixed 1B, ownerless)  (pure math)     (CREATE2, config)   (escrow, trader,      (arb-back, pool init,
                                                                    │              two-way lock)          ⏱ TIMEBOX gate)
                                                                    │                    │
                                                                    │                    ▼
                                                                    │              M1-9 Router
                                                                    │              (pause-free sell)
                                                                    │                    │
   gates: M1-11 static ── M1-12 fork ── M1-13 mutation ────────────┴────────────────────┴─► M1-14 deploy ─► M1-15 security review
```

Note: M1-9 (Router) depends on M1-8 (curve) only; M1-10 (Migrator) depends on M1-8 **and** M1-1 (V3 addresses). Gates 1/3/4 depend on the full impl set through M1-10. Cross-phase legs (I-2/I-4/I-5a, T-1/T-3/T-4) come after M1-14.

## Task table

| Seq | ⇐ Master | Task | Files | Proven by | Depends on |
|---|---|---|---|---|---|
| 1 | M1-1 | Wire confirmed §12.28 V3 addresses into `constants.json.external.*` (currently zeroed; add `swapRouter02`/`quoterV2` keys) + deploy-time runtime assertions | `tools/m0/out/constants.json`, `script/` assertion helper | `external.*` == §12.28 addrs; M1-14 canary asserts `feeAmountTickSpacing(10000)==200`, `NPM.factory()`, `NPM.WETH9()` | M0 done |
| 2 | M1-2 | Throwaway-contract verification of `solc 0.8.35` on robinhoodchain.blockscout.com → GUID in toolchain.md → architect records final pin in §12 (pin already on disk; this closes the *evidence* leg) | `docs/runbooks/toolchain.md`, `foundry.toml` | GUID noted; `grep -E '^\s*solc\s*=\s*"0\.8\.[0-9]+"' foundry.toml` = 1 line | — |
| 3 | M1-3 | **Interfaces + errors** (on disk — confirm current, compile against impls) **+ `events.json` codegen (NOT on disk)** | `src/interfaces/*`, `src/errors/Errors.sol`, codegen → `packages/shared/events.json` | `forge build` green; `grep -q metadataUri packages/shared/events.json` | — |
| 4 | M1-4 | **Gate-2 skeletons BEFORE impl** — 7 invariant rows present; **add the empty `test/fuzz/` skeletons + `MockWETH9`**; confirm all compile skipped | `test/invariant/*`, `test/fuzz/*` (new), `test/mocks/MockArbSys.sol` (on disk), `test/mocks/MockWETH9.sol` (new) | `forge build` green; one file per invariant row; fuzz dir non-empty | M1-3 |
| 5 | M1-5 | `LaunchToken` — fixed 1B, ownerless, immutable `metadataHash`, **no `burn` fn**, OZ v5 ERC20+ERC20Permit | `src/LaunchToken.sol`, `test/unit/LaunchToken.t.sol` | `forge test --match-path 'test/unit/LaunchToken*'` | M1-3 |
| 6 | M1-6 | `libs/CurveMath` — pure buy/sell, rounding **always favors curve**; vendored `TickMath`/`FullMath` 0.8 ports (upstream commit in header) | `src/libs/CurveMath.sol`, `src/libs/TickMath.sol`, `src/libs/FullMath.sol`, `test/fuzz/CurveMath.t.sol` | fuzz: `k` non-decreasing; ∀(state,amt) post-k ≥ pre-k | M1-3 |
| 7 | M1-7 | `CurveFactory` — CREATE2 staging (constant init-code hash), config snapshot vs live-read split, hard caps, one-time `setRouter`/`setMigrator`, **granular pauses (no `pauseSells`)** | `src/CurveFactory.sol`, `test/unit/Factory.t.sol` | `forge test --match-path '*Factory*'`; grep proves no sell-pause; `recordEthDelta(−)` floor-at-zero never reverts | M1-5, M1-6 |
| 8 | **M1-8** | `BondingCurve` — **§12.25 pull-payment escrow (`accruedFees` + permissionless non-phase-gated `sweepFees()`, NO treasury call on any trade path)**, `trader` plumbing (X-3), §12.11 net-of-fee graduation clamp, §12.12 two-way `ReadyToGraduate` lock, `graduate()` withholds `accruedFees` + `recordEthDelta(−realEth)` (X-12), §12.18 timestamp anti-sniper, donation sweep. Enable invariants 1–5,7. All trade fns + `graduate()` + `sweepFees()` `nonReentrant` + CEI | `src/BondingCurve.sol`, `test/invariant/*`, `test/unit/Curve*.t.sol` | `forge test '*Curve*' 'test/invariant/*'` incl. **reverting-treasury solvency-drain** + cross-entrypoint reentrancy | M1-7 |
| 9 | M1-9 | `Router` — create/buy/sell/sellWithPermit, **deadline+slippage on every trade path incl. atomic create-buy**, forwards `msg.sender` as `trader`, **provably pause-free sell path** (zero pause reads, grep-verifiable) | `src/Router.sol`, `test/unit/Router.t.sol` | `forge test '*Router*'` incl. **pause-matrix: sells succeed under `pauseCreates=pauseBuys=true` AND with reverting treasury** (§12.25/UM-1) | M1-8 |
| 10 | **M1-10** | `V3Migrator` + `LPFeeVault` — pool init at create, **arb-back defense** (bounded loop, own swap callback), full-range mint→vault, §12.13 dust split (token→`0xdEaD`, WETH→treasury); vault ~50 lines collect-only, no owner/withdraw. Enable invariant 6 (pool-griefing campaign) | `src/V3Migrator.sol`, `src/LPFeeVault.sol`, `test/invariant/PoolGriefingNoHostileMint.t.sol` | `forge test '*Migrator*' '*Vault*' '*Grief*'` | M1-8, M1-1 |
| 11 | M1-11 | **Gate 1** — Slither triage (zero unexplained), Aderyn, solhint, `forge fmt --check`, CI greps (`block.number`, `\^0\.8`, `>=0\.8`, `Pausable`, `checkFee`) | `contracts/slither.triage.json`, `.solhint.json`, `slither.config.json` | `slither … --triage-database` exit 0; CI contracts+slither green | M1-10 |
| 12 | M1-12 | **Gate 3** — fork lifecycle vs real V3/NPM/WETH + real-ArbSys smoke; needs `[profile.fork]` | `foundry.toml` (`[profile.fork]`), `test/fork/Lifecycle.t.sol` (skeleton on disk) | `FOUNDRY_PROFILE=fork forge test` green (`ROBINHOOD_RPC_URL` set) | M1-10 |
| 13 | M1-13 | **Gate 4** — mutation on `CurveMath` **+ migrator arb-back + vendored `TickMath`/`FullMath`** (UM-10) | `contracts/reports/mutation/` | report present, zero undispositioned survivors | M1-6, M1-10 |
| 14 | M1-14 | `script/Deploy.s.sol` — constants loader, consistency + V3 assertions, deploy order 1–8, canary; **emit deploy artifacts → shared codegen (`addresses` + ABIs)** | `script/Deploy.s.sol`, generated `packages/shared` addresses | `anvil` + `forge script … --broadcast` exit 0; codegen consumable by indexer+web | M1-1, M1-10 |
| 15 | M1-15 | (**hoodpad-security**) adversarial review of `contracts/src/`; findings register, no open High+ | `docs/security/findings-m1.md` | register shows zero open High+ | M1-14 |

### Cross-phase contracts legs

| ⇐ Master | Task | Proven by |
|---|---|---|
| I-2 | `tools/localstack/chain.ts` — anvil (fork when `ROBINHOOD_RPC_URL` set = real V3/WETH; else local V3 core/periphery bytecode + `MockWETH9`), run `Deploy.s.sol`, re-emit codegen | script exit 0; addresses file imported by indexer+web |
| I-4 | Seed **chain leg** — ≥3 demo tokens via real launch path (upload→metadata→`Router.createToken`), one driven to `GRADUATION_ETH` → `graduate()` → V3 swaps → `collect()` | G-2 |
| I-5a | E2E **chain helpers** — anvil time-warp (`evm_increaseTime`/`evm_mine`) for anti-sniper window + graduation, under `tools/localstack/` (never in `apps/web`) | harness boots vs stack |
| T-1 | Testnet constants refresh (`derive` + testnet `external.*`; if V3 registry absent on testnet, escalate to architect — do not improvise) | `derive --reuse-snapshot` exit 0 |
| T-3 | Deploy + Blockscout-verify all six + canary on testnet; `tools/deployments/testnet.json` (addresses + GUIDs) | G-7 |
| T-4 | Lifecycle exercise (create→trade→clamp→graduate arb-back path→V3 swap→collect), tx hashes → `docs/runbooks/testnet-lifecycle.md` | G-8 first half |

## ⏱ M1 HARD TIMEBOX checkpoint (gate at day 5 of M1, after Seq 10 / M1-10)

Per spec §11 (v1.2) — **pre-made decision, do not re-litigate.** If M1-10's gate-2 **invariant 6** (arb-back vs pool griefing) is **not green by end of week 1 of M1**, switch to **V2 + LP burn (spec §6.3) the same day.** Eyes-open cost of the fallback:

- **(a)** flips LP copy from the canonical §12.14 sentence to **"LP burned forever"** across CLAUDE.md / `packages/shared` `constants.ts` / web copy-lint (the *only* sanctioned flip — `/spec-check` rule 5);
- **(b)** removes post-grad fee revenue — **`LPFeeVault` + `collect` + V3 `Collect` indexing + the `/fees` dashboard are descoped**;
- **(c)** **§12.28 (V3 confirmed on 4663) means V3 availability is NOT a trigger — only migrator gate-failure is**;
- **(d)** the **§12.25 curve-fee escrow is unaffected** (curve-side), so day-1 fee capture under bot-dominant flow survives either path.

On trigger: hoodpad-architect records the flip in §12 the same day and re-points docs; hoodpad-contracts/-indexer/-frontend descope the V3-graduation legs. **Verify (day-5 gate):** M1-10 invariant 6 green, **OR** the fallback decision is recorded in §12 + LP copy flipped.

## Decide-it-yourself decisions (research → decide → record → prove → implement)

These are engineering-approach calls hoodpad-contracts **owns** (per threat-model §8.1). IDs `TM-T1/TM-T2/TM-T3` are **threat-model finding numbers** — distinct from master Phase-T item IDs (T-1/T-3/T-4). Each is a sub-task of the cited master item; **escalate to §12 only if the chosen mechanism would change a stated product guarantee** (flagged inline).

| # | Decision | Sub-task of | Research source (docs-first) | Proving test |
|---|---|---|---|---|
| **TM-T1** | **UM-2 grief-lock escape hatch** — bounded-retry shape + whether a permissionless escape is mandatory. Prefer the pull-payment analog for the graduation-fee leg (accrue instead of push) so a reverting treasury can't lock `graduate()` — this changes **no** guarantee, contracts owns it outright. **⚠ Escalate:** any hatch that *re-opens sells during `ReadyToGraduate`* mutates the §12.12 two-way-lock guarantee → flag to architect/§12, do not implement unilaterally. | M1-8 (curve state machine) + M1-10 (cost analysis) | Uniswap v3 pool-manipulation precedent; own gate-6 griefing-cost model (attacker min-spend to sustain lock vs `GRADUATION_ETH`) | fuzz: griefer cannot make `graduate()` unreachable within the cost bound, **OR** the (guarantee-preserving) escape/pull-fee path releases curve ETH; graduation-fee push replaced by pull → reverting-treasury `graduate()` still succeeds |
| **TM-T2** | **O-8 WETH-leg arb budget** — spec's "inventory above mint requirement" is well-defined for the **token** leg but undefined for **WETH** (mint consumes *all* WETH). Define it: draw the WETH arb against raised WETH bounded by a `MIGRATION_SLIPPAGE_BPS` value-skew cap (arb+mint are one atomic op), or a dedicated `maxWethArbBps` immutable. | M1-10 (arb-back) + M0 (numbers) | Uniswap v3-periphery mint / `LiquidityAmounts` math (context7 `/uniswap/v3-periphery`); §12.11 $69k parity | invariant 6: value-skew at mint ≤ tolerance for **both** under- and over-priced pools; arb-back never spends below the LP-mint floor; $69k parity holds (gate-6 quantified) |
| **TM-T3** | **Reentrancy strategy** — `nonReentrant` placement across `buy`/`sell`/`sellWithPermit`/`graduate()`/`sweepFees()` + CEI; ETH sends via checked low-level `call`; where the guard sits on the Router (external) vs curve (internal-trust) boundary. | M1-8, M1-9 | OZ v5 `ReentrancyGuard` (transient-storage-based in v5) + `Address.sendValue`/`functionCallWithValue` — context7 `/websites/openzeppelin_contracts_5_x`, fallback https://docs.openzeppelin.com/contracts/5.x/ | cross-entrypoint reentrancy unit: a refund/ETH-receive callback re-entering `graduate()` **or** `sweepFees()` mid-buy reverts; `Reverter` recipient reverts only its own trade, no shared state poisoned |
| — | Storage packing / error taxonomy | all | Solidity docs (https://docs.soliditylang.org) | `forge build --sizes`; gas snapshots |

## Definition of done

- Gates 1–4 green (G-3 locally); `forge build` + `forge test` green on the single pinned `solc 0.8.35`; `FOUNDRY_PROFILE=fork forge test` green.
- Every §12 obligation implemented **and** proven by a named test: 12.25 escrow (+ reverting-treasury sell + solvency drain), 12.11 net-of-fee clamp, 12.12 two-way lock, 12.13 dust split, 12.18 timestamp anti-sniper.
- The reverting-treasury sell test passes (sells unfreezable **by construction** — sell path reads no pause flag and calls no treasury).
- All three TM decisions recorded (chosen option + citation) in contracts.md and proven by their test; any §12.12-touching escape hatch escalated, not self-decided.
- Deploy script emits the shared `addresses` + ABI codegen consumable by indexer + web; M1-15 register shows zero open High+.
- Self-check greps clean before report: `block.number`, `\^0\.8`/`>=0\.8`, `Pausable`/`pauseSells`, `checkFee`/caller-supplied fee params.
