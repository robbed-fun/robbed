# ROBBED_ — M1 Consolidated Security Findings Register (M1-15)

**Deliverable:** M1-15 — final M1 security gate. Full-suite adversarial review of `contracts/src/**` (6 contracts + `libs/CurveMath.sol` + `errors/Errors.sol` + interfaces).
**Author:** hoodpad-security. **Date:** 2026-07-10. **Scope:** read-only on `contracts/`; findings route to hoodpad-contracts. Source of truth: the protocol spec (`docs/spec.md`) v1.1; threat model `docs/threat-model.md`.
**Reviewed tree (exact):** `BondingCurve.sol`, `CurveFactory.sol`, `Router.sol`, `V3Migrator.sol`, `LPFeeVault.sol`, `LaunchToken.sol`, `libs/CurveMath.sol`, `errors/Errors.sol`, `interfaces/**`.

## Verdict

**M1-15 "zero open High+" bar: MET.** Every Critical/High item is either **fixed-and-verified in the current tree** or **explicitly deferred to caps-lift (M4)** with recorded rationale, per the M-10-A precedent. The fresh adversarial pass (this item) produced **no new Critical/High/Medium findings**; two verified-safe design-reliance notes are recorded as Informational.

Two non-contract gate dependencies remain open but are **out of scope for this contract-findings register** (they are their own plan items, tracked separately, and neither is a demonstrated contract fund-loss bug):
- **M1-12** (gate-3 fork tests vs live chain) — `[ ]` not yet run (blocked on `ROBINHOOD_RPC_URL`). Blocks caps-lift, not M1-15.
- **M1-13 migrator arb-back mutation adequacy** (0.585) — 5 enumerated kill-tests are a **pre-caps-lift** assurance follow-up; the on-chain arb-back logic is proven correct by the M1-10 gate + gate-2 invariant 6 (384 griefed lifecycles, 0 hostile mints).

### Counts

| Severity | Fixed+verified | Deferred→caps-lift | Dispositioned (ack/FP/by-construction) | Open (unresolved) |
|---|---|---|---|---|
| Critical | 1 (UM-1) | 0 | 0 | **0** |
| High | 2 (M-10-A Part-1, cross-entrypoint reentrancy T-3) | 1 (M-10-A Part-2 / UM-2 residual) | 0 | **0** |
| Medium | 0 | 0 | 1 (migrator mutation adequacy — assurance gap, pre-caps-lift) | **0** |
| Low | 2 (factory F-3, F-4) | 0 | 1 (UM-9 CREATE2 squat) | **0** |
| Informational | — | — | 9 (see table) + 2 fresh-pass notes | **0** |

**Open High+ = 0.** Nothing routes back to hoodpad-contracts as a blocking M1 contract fix.

---

## Register — consolidated prior findings

Status legend: **FIXED** (change verified in current tree) · **DEFERRED** (to caps-lift/M4 with rationale) · **DISPOSITIONED** (acknowledged / false-positive / safe-by-construction) · **CLOSED** (test-adequacy obligation met).

| ID | Origin | Severity | Status | Contract | Disposition rationale (verified against current tree) | Ref |
|---|---|---|---|---|---|---|
| **UM-1** treasury-set sell-freeze | threat-model / M1-8,M1-9 | Critical | **FIXED** | BondingCurve | Pull-payment fee escrow: `accruedFees` accumulates on buy+sell; **no trade path calls `treasury`**. Verified: `treasury` is read in exactly ONE place, `sweepFees()` (BondingCurve.sol:268); `buy`/`sell` make zero treasury calls (grep confirmed). A hostile/reverting treasury reverts only `sweepFees()` (retriable), never a sell. Gate-2 pause-matrix + reverting-treasury solvency drain green. | spec §6.5, §12.25; TM §D, UM-1 |
| **UM-2 / M-10-A Part-1** token-leg arb budget asymmetry freezes graduation | M1-10 gate (PoC) | High | **FIXED** | V3Migrator | Prior: token-leg arb floor was full `LP_TOKEN_TRANCHE`, but the curve forwards ≈ exactly that at graduation → budget≈dust → token-overpriced pool reverted `ArbBudgetExceeded`, freezing curve in `ReadyToGraduate` (both dirs locked, §12.12) cheaply/sustainably. Fixed: symmetric slippage-bounded floor `lpTranche·(1−slippageBps)` mirroring the WETH leg (V3Migrator.sol:308). Verified in code + re-gate (126/0/2; PoC now graduates; reverting the floor reproduces the freeze = genuine regression; liveness invariant + 198 directed token-leg cycles). | spec §6.3.2, §12.11, §12.12; TM UM-2, M-10-A |
| **UM-2 / M-10-A Part-2** residual grief beyond ~slippage-recoverable range | M1-10 gate | High | **DEFERRED → caps-lift (M4)** | V3Migrator | Mispricing BEYOND the `MIGRATION_SLIPPAGE_BPS`-recoverable band still reverts `graduate()` (→ `PoolPriceUnrecoverable`/`ArbBudgetExceeded`), leaving the curve `ReadyToGraduate` and **permissionlessly retriable** (never a hostile mint — gate-2 inv 6 proves no-hostile-mint at all fills). 3 recorded dispositions carried to M4: (a) gate-6 cost proof [attacker locks ≳0.08 ETH to freeze 8.08 ETH; non-permanent; third-party-correctable; zero attacker profit]; (b) non-§12.12-touching escape hatch [timeout → widen tolerance/iterations or corrector-assisted retry — leaves the two-way lock intact, likely-preferred]; (c) §12.12-touching hatch [reopens sells — USER decision]. Escalated to hoodpad-architect; NOT decided here. | spec §6.3.2, §12.12; TM UM-2, R6, M-10-A |
| **Cross-entrypoint reentrancy** (T-3, refund/caller-reward → `graduate()`/`sweepFees()`) | threat-model §8.1 / M1-8 | High | **FIXED** | BondingCurve, Router | All four externals (`buy`/`sell`/`sweepFees`/`graduate`) `nonReentrant` on OZ v5 storage-based single-lock guard + strict CEI (state written before every external call). Verified: docs-first confirmed OZ v5 lock is one shared per-contract lock → re-entry of ANY guarded fn reverts. `graduate` reads `accruedFees` only after the (guarded) caller-reward send, so a re-entrant `sweepFees` cannot skew `ethForMigrator`. Router `nonReentrant` on all 4 entrypoints. Gate-2 invariant 7 green. | spec §5.4; TM §8.1 |
| **TM-T1** reverting-treasury locks graduation (grad-fee/dust leg) | M1-10 gate | High→resolved | **FIXED** | V3Migrator | Graduation fee + WETH dust paid to treasury as **WETH via `IERC20.transfer`** (no recipient callback), never native `call` (V3Migrator.sol:246,425). Only native send in the flow is CALLER_REWARD to `graduate()`'s caller — rejection reverts only THAT attempt; anyone may retry. | spec §6.3; TM TM-T1, UM-1/UM-2 |
| **TM-T2** arb-back cannibalises mint floor / hostile mint | M1-10 gate | High→resolved | **FIXED** | V3Migrator | Symmetric per-leg budgets (`MIGRATION_SLIPPAGE_BPS`) + independent `amount0Min`/`amount1Min` = pre-arb tranche·(1−slippage) re-enforce parity on BOTH sides at mint (defense-in-depth). Swap is price-limited to `targetSqrt` — docs-confirmed V3 `sqrtPriceLimitX96` bounds price (no overshoot). Off-target → revert, never mint. | spec §6.3.2, §12.11; TM TM-T2 |
| **UM-9** CREATE2 curve-address squatting | M1-7 gate | Low | **DISPOSITIONED (acknowledged)** | CurveFactory | Salt = `keccak256(creator, tokenCounter)`; deployer address baked into CREATE2 preimage (only THIS factory can deploy at the target) + global monotonic `tokenCounter` → no collision, uniqueness holds. Residual: predictable counter lets an attacker pre-occupy a specific creator's next address → **DoS-of-create only** (no fund path). Accepted, threat-model §8.1. | TM UM-9, §8.1 |
| **M1-6/CurveMath F1** zero-output mutant survives | M1-6 gate | Info (test-adequacy) | **CLOSED** | libs/CurveMath | M1-13: positivity/monotonicity assertions added to `testFuzz_Buy/Sell`; injected zero-output mutant now killed. universalmutator 1.14.1: 58/58 killable killed. | M1-13 |
| **M1-6/CurveMath F2** Ceil→Floor outside mutator reach | M1-6 gate | Info (test-adequacy) | **CLOSED** | libs/CurveMath | M1-13: independent ceil-reference / rounding-direction hand-mutant test added; Ceil→Floor killed. | M1-13 |
| **M1-6/CurveMath F3** raise fuzz runs + reference-equality | M1-6 gate | Info (test-adequacy) | **CLOSED** | libs/CurveMath | M1-13: runs → 20k + independent reference-equality check. Suite 130/0/2. 6 provably-equivalent survivors dispositioned. | M1-13 |
| **M1-7/M1-8 F-3** constructor graduation-fundability assert | M1-7,M1-8 gate | Low | **FIXED** | CurveFactory | Constructor reverts `GraduationUnfundable` when `maxCallerReward + maxGraduationFee >= graduationEth` (CurveFactory.sol:193; Errors.sol:57). Guarantees graduation reachable for every admissible future owner-set value (checks immutable CEILINGS, not current values). | spec §12.11 |
| **M1-7 F-4** wrong error name on metadataUri check | M1-7 gate | Low | **FIXED** | CurveFactory | Distinct `InvalidMetadataUri` error added + used (CurveFactory.sol:285; Errors.sol:50), separate from `ZeroMetadataHash` (integrity commitment vs event pointer). | contracts.md §2.2 |
| **M1-5 F4** LaunchToken constructor doesn't guard `metadataHash != 0` | M1-5 gate | Info | **DISPOSITIONED (by-construction)** | LaunchToken, CurveFactory | LaunchToken stores verbatim/immutably; the non-zero guard is LOAD-BEARING at the factory (`ZeroMetadataHash`, CurveFactory.sol:281, sole create path via `onlyRouter`). No direct-deploy path exists (token deployed only inside `createToken`). Guard placement acceptable + verified present. | spec §8.3 |
| **M1-7 F-5** FactoryConfig struct shape → architect ratification | M1-7 gate | Info | **DISPOSITIONED** | CurveFactory | View-only aggregation struct (`config()`); no economic effect. Ratified by architect. | contracts.md §2.2 |
| **M1-8 F-1** frozen IBondingCurve NatSpec stale ("fee→treasury") | M1-8 gate | Info (docs) | **FIXED** | interfaces/IBondingCurve | Interface NatSpec now documents pull-payment escrow + `sweepFees()` explicitly (IBondingCurve.sol:6–15). Applied at M1-9. | spec §12.25 |
| **M1-8/M1-11 F-2** pin `evm_version` | M1-8,M1-11 gate | Info (toolchain) | **RESOLVED** | foundry.toml | Pinned `cancun` (OZ v5.5 `Bytes.sol` uses `mcopy` via mandatory ERC20Permit→ECDSA→Strings→Bytes chain → pre-Cancun fails to compile). ArbOS ≥32 supports MCOPY; Blockscout lists cancun. contracts.md §7.1 "do not assume Cancun" amendment → architect. | spec §6.7, contracts.md §7.1 |
| **M1-1 F-1** MockV3Factory.feeAmountTickSpacing fee-arg-sensitive | M1-1 gate | Info (test-infra) | **DISPOSITIONED (routed)** | test infra | Harden mock so a `V3_FEE_TIER` mutation cannot survive. Test-infra only; deploy-time real assertion `factory.feeAmountTickSpacing(10000)==200` present. Routed hoodpad-contracts. | spec §12.28 |
| **M1-1 F-2** Deploy.s.sol keep absolute WETH `require` | M1-1 gate | Low | **FIXED (M1-14)** | script/Deploy.s.sol | Absolute `require(weth == 0x0Bd7…AD73)` retained (V3Assertions binds WETH only relatively). Verified landed at M1-14. | CLAUDE.md chain facts |
| **M1-9 I-1** validate curve before `permit()` in sellWithPermit | M1-9 gate | Info | **DISPOSITIONED (acknowledged, optional)** | Router | `permit()` is best-effort try/catch; `_sell` → `_curveOf` reverts `UnknownToken` for an unregistered token regardless, so a bad token cannot reach a fund path. Optional hardening; no fund impact. | contracts.md §2.4 |
| **M1-13 migrator arb-back mutation adequacy** (0.585; 83 survivors dispositioned) | M1-13 gate | Medium (assurance gap) | **CLOSED (local half, 2026-07-11) → residual rides M1-12** | V3Migrator | On-chain logic proven correct (M1-10 gate + gate-2 inv 6). Local kill-tests landed (`test/unit/MigratorArbBackKill.t.sol`: budget-boundary, both token orderings, 2-iter WETH spend, exact-tolerance-tick, M-10-A floor freeze-regression); 83-survivor rerun → 43 killed, **adequacy 0.800**, remaining 40 dispositioned (16 E / 5 DID / 5 UG / 14 fork-gated). Evidence: `contracts/reports/mutation/README.md`, `scores.tsv`, rerun logs. Residual: 14 amount-min-floor survivors on the env-gated gate-3 fork run (M1-12). Not a demonstrated bug. | contracts.md §6 gate 4 |

---

## Fresh adversarial pass (M1-15) — attack matrix

Every lens below was executed against the current tree. **All refuted.** No new Critical/High/Medium.

| Attack class | Target | Attempt | Result — why it fails |
|---|---|---|---|
| Sell-freeze by any state combo | BondingCurve.sell / Router.sell | Find a flag/state/treasury path that blocks a sell | **REFUTED.** `sell` reads no factory pause flag; `treasury` read only in `sweepFees` (grep-verified, 1 site). `recordEthDelta(negative)` never reverts (CurveFactory.sol:330-336, `>=`-guarded unchecked). Caps enforced only on ETH-increasing deltas. Sells unfreezable by construction. |
| Curve insolvency (pay > held) | BondingCurve.sell | Craft a fill order so `ethOutGross > _realEthReserves` | **REFUTED.** `k` non-decreasing (CurveMath Ceil-on-retained ≡ floor-on-payout) ⇒ gross owed for any circulating amount ≤ real reserves; buy-side `tokensOut>realTok` clamp only raises k. Solvency `balance ≥ realEthReserves + accruedFees` holds through both fee legs (hand-checked for clamp + normal paths). Gate-2: 128k-call drain, 0 reverts. |
| Fee off-by-one / rounding extraction | BondingCurve buy clamp | Exploit `fee = acceptedEthGross − net` on the graduation clamp | **REFUTED.** Proved `acceptedEthGross = ceil(net·1e4/(1e4−bps)) ≤ grossIn` (⇒ `refund ≥ 0`) and `fee ≥ 0` for all `grossIn>0`, `bps≤200`. `treasuryReceipts + accruedFees == Σ fees` to the wei (gate-2 exact-fee inv). Rounding always favors the curve. |
| Graduation double-fire | BondingCurve.graduate | Re-enter or re-call graduate | **REFUTED.** Terminal `phase=Graduated` + zeroed reserves written before any external call; re-entry hits `nonReentrant`; re-call hits `NotReady`. Single-fire by construction. Reachable via §12.11 exact-landing clamp. |
| Post-grad residual value | BondingCurve | Extract value after graduation | **REFUTED.** `graduate` forwards `balance − accruedFees` to migrator; curve left holding exactly `accruedFees`, drained to 0 by permissionless `sweepFees` → zero value. Post-grad donations are inert (receive() no-op, not swept, not extractable) — griefer burns own funds. |
| Hostile-ratio V3 mint | V3Migrator.migrate | Donate/sync/swap the pre-seeded pool then force graduation | **REFUTED.** `migrate` never trusts `slot0`: bounded arb-back price-limited to `targetSqrt` (docs-confirmed no-overshoot), hard tolerance assert before mint, dual `amountXMin` parity floors. Off-target/over-budget → revert (retriable), never mint. Zero-liquidity griefed pool: arb snaps price to limit at ~0 cost. Gate-2 inv 6: 384 griefed lifecycles, 0 hostile mints. |
| Swap-callback theft | V3Migrator.uniswapV3SwapCallback | Invoke callback from a hostile pool to drain migrator | **REFUTED.** Callback authorises `msg.sender == _activePool`; `_activePool` = canonical `v3Factory.getPool(...)` result, non-zero only mid-arb. A pool only callbacks the address that called `pool.swap` (the migrator), so no external swap can reach it; pays only the deltas for the migrator's own swap. |
| Reentrancy via ETH sends | buy refund / graduate caller-reward | Malicious `refundTo`/caller re-enters | **REFUTED.** CEI everywhere; OZ v5 single storage lock (docs-confirmed) blocks re-entry of any guarded fn cross-entrypoint; LaunchToken is plain ERC20 (no transfer hooks) so `safeTransfer` to `recipient` cannot re-enter. |
| Caller-supplied fees | Router, BondingCurve | Pass an attacker-chosen fee | **REFUTED.** No function accepts a fee argument; all fees computed in-contract from immutable `TRADE_FEE_BPS` / `GRADUATION_FEE`. (§4.1 hard rule holds.) |
| `block.number` / L1-estimate logic | all | Any height-opcode dependence | **REFUTED.** Grep: zero `block.number`. Anti-sniper + deadlines use `block.timestamp`; L2 height would use `ArbSys` (none needed). |
| Proxy / upgrade / admin reach into live curves | CurveFactory (Ownable2Step) | Owner mutates a live curve's economics/supply/vault | **REFUTED.** No proxy/delegatecall/initializer/Pausable (grep). Curve economics snapshotted immutable at creation; owner setters affect only FUTURE curves + live `treasury`/pauses/caps — none can block a sell or touch the vault (no owner). LPFeeVault: no owner, sole external fn `collect(tokenId)` → immutable treasury. |
| Direct curve/vault access | BondingCurve, LPFeeVault | Bypass Router; grief the vault | **REFUTED.** `buy`/`sell` are `onlyRouter`; `recordEthDelta` `onlyCurve`; migrator `migrate` `onlyCurve`, `initializePool` `onlyFactory`; vault `onERC721Received` only from the NPM. `collect` permissionless in gas-payer, fixed in destination. |

### Verified-safe design-reliance notes (Informational — no action required)

- **N-1 (Info) — `_stagedParams` transient-staging is reentrancy-safe.** `curveParameters()` returns `_stagedParams`, non-zero only within `_deployCurve` (staged→read-back-by-curve-constructor→`delete`, all synchronous). The sole `createToken` caller is `onlyRouter` and `Router.createToken` is `nonReentrant`, so no second create can observe/clobber a foreign staging; the post-staging external call (`migrator.initializePool`, trusted Uniswap NPM path) cannot re-enter `createToken`. Outside creation the view returns a zeroed struct (harmless). **Verified safe.**
- **N-2 (Info) — `globalCurveEth` floor-clamp can only under-count, never over-count.** `recordEthDelta` floors the global cap accumulator at 0 on negative deltas (defensive). Since each curve's contribution is tracked symmetrically (+net / −ethOutGross / −gradEth exactly mirror `realEthReserves`), the floor is never reached in practice; if it ever were, it would make the beta cap MORE permissive (never block a sell, never insolvency). Gate-2 global-cap invariant (128k calls) exercised without drift. **Verified safe.**

---

## Hard-rule / by-construction compliance (spot-checked this pass)

| Rule | Result | Evidence |
|---|---|---|
| No `block.number` | PASS | grep: 0 hits |
| Single exact compiler pin `0.8.35` | PASS | grep: all 6 + libs pin `0.8.35`, no ranges |
| No proxy/upgradeable/delegatecall/initializer | PASS | grep: 0 hits (only doc word "Proxy to curve.quoteBuy") |
| No `Pausable` | PASS | grep: 0 hits; only `pauseCreates`/`pauseBuys` bools; no `pauseSells` |
| Sells always open (treasury read once) | PASS | `treasury` read only in `BondingCurve.sweepFees` (l.268); buy/sell make no treasury call |
| Fees in-contract, never caller-supplied | PASS | no fee params on any external |
| Immutable/no-owner LPFeeVault, `collect` only | PASS | LPFeeVault: no owner/withdraw/setter; sole state-mutating fn `collect(tokenId)` → immutable `treasury` |
| Ownable2Step owner cannot reach live curves/vault | PASS | economics immutable per-curve; setters affect future curves + live treasury/pause/caps only |
| OZ v5 SafeERC20 / ReentrancyGuard / Ownable2Step | PASS | SafeERC20 in Curve/Router/Migrator; storage `ReentrancyGuard` on Curve+Router; `Ownable2Step` on Factory |
| `tx.origin` never for authorization | PASS | single use = event-only provenance (V3Migrator.sol:441), explicitly not auth |

## Docs-first sources consulted this pass

- Uniswap v3-core `IUniswapV3PoolActions` natspec (raw GitHub): `sqrtPriceLimitX96` bounds price (cannot cross after swap); positive `amountSpecified` = exact input; caller pays owed input in callback — validates V3Migrator arb-back "never overshoot" + callback design.
- OpenZeppelin Contracts v5.x (docs.openzeppelin.com/context7): `ReentrancyGuard` = single per-contract storage lock; re-entry of any `nonReentrant` fn reverts (distinct from `ReentrancyGuardTransient`) — validates cross-entrypoint reentrancy resolution.
- spec §6.5, §12.11–§12.13, §12.25, §12.28; `docs/threat-model.md` (UM-1/UM-2/UM-9, TM-T1/TM-T2, §8.1); M1-1..M1-14 gate evidence (plan-item IDs; the execution tracker was retired 2026-07-12 — history in git).

---

## M1-15 independent re-verification (2026-07-11, robbed-security)

A second, from-scratch adversarial pass re-derived every claim above against the *current* tree (no reliance on the 2026-07-10 evidence). **Result: register CONFIRMED — no new Critical/High/Medium/Low findings; nothing downgraded. Open High+ = 0.** All six contracts + `libs/CurveMath.sol` + `errors/Errors.sol` + interfaces were re-read line-by-line.

### Static + dynamic gate evidence (verbatim, this run)

| Check | Command | Result |
|---|---|---|
| Hard rule: no `block.number` | `grep -rn "block.number" src/` | 0 hits |
| Hard rule: single pin | `grep -rhn "pragma solidity" src/ \| sort -u` | one line: `pragma solidity 0.8.35;` |
| Hard rule: no proxy/delegatecall/initializer/Pausable | grep | 0 (only doc word "Proxy to curve.quoteBuy") |
| Hard rule: `tx.origin` | grep | 1 site, `V3Migrator.sol:441`, event-only provenance (not auth) |
| Hard rule: treasury off trade path | `grep treasury src/BondingCurve.sol` | read only in `sweepFees()` (l.268); buy/sell make no treasury call |
| Hard rule: no sell pause | grep | only `pauseCreates`/`pauseBuys`; no `pauseSells` anywhere |
| `forge fmt --check` | `forge fmt --check` | clean (no diff) |
| solhint | `solhint 'src/**/*.sol'` | 0 errors, 285 warnings — all NatSpec/import-path on vendored `interfaces/external/**` (dispositioned M1-11) |
| Slither | `slither contracts --config-file contracts/slither.config.json` | **exit 0**; all surfaced findings within the 40 content-hash-triaged entries in `slither.db.json` (dispositions in `slither.triage.json`); detectors kept live |
| Foundry full suite | `forge test` | **130 passed, 0 failed, 2 skipped** |
| Gate-2 invariant: k non-decreasing | `KNonDecreasingInvariant` | PASS — 256 runs, 128000 calls, 0 reverts |
| Gate-2 invariant: curve solvency | `CurveSolvencyInvariant` | PASS — 128000 calls, 0 reverts |
| Gate-2 invariant: exact fee accounting | `FeeExactnessInvariant` | PASS — 128000 calls, 0 reverts |
| Gate-2 invariant: graduation single-fire + reachable | `GraduationSingleFireInvariant` | PASS — 128000 calls, 0 reverts |
| Gate-2 invariant: post-grad zero value | `PostGraduationZeroValueInvariant` | PASS — 128000 calls, 0 reverts |
| Gate-2 invariant: no extraction beyond fair value | `NoValueExtractionInvariant` | PASS — 128000 calls, 0 reverts |
| Gate-2 invariant: no hostile-ratio V3 mint | `PoolGriefingNoHostileMintInvariant` | PASS — 48 runs, 384 calls, 0 reverts |
| Targeted: hostile-treasury solvency | `test_solvencyHolds_underHostileTreasury` | PASS |
| Targeted: reverting-treasury graduate (TM-T1) | `test_TMT1_revertingTreasury_graduateSucceeds` | PASS |
| Targeted: pause-matrix sells w/ reverting treasury | `test_pauseMatrix_sellsSucceed_withRevertingTreasury` | PASS |
| Gate-3 fork lifecycle + ArbSys smoke | `test_fork_fullLifecycle`, `test_fork_arbSysSmoke` | **SKIPPED** (env-gated on `ROBINHOOD_RPC_URL`; M1-12, blocks caps-lift not M1-15) |

Tool availability recorded honestly: `forge`/`slither`/`aderyn`/`solhint` on PATH; **`gambit` NOT on PATH** — gate-4 mutation was executed with `universalmutator 1.14.1` (reports under `contracts/reports/mutation/`), which is the sanctioned equivalent; not an M1-15 dependency.

### Adversarial re-derivations performed this pass (independent, not quoted)

- **Solvency (sell can never pay > held).** Re-derived that `_virtualEthReserves − _realEthReserves == VIRTUAL_ETH_0` is invariant (both move by identical deltas on every buy/sell/graduate), so `ethOutGross = _virtualEthReserves − ceil(k/(vT+tIn)) ≤ _realEthReserves` iff `ceil(k/(vT+tIn)) ≥ VIRTUAL_ETH_0`, which holds because `k` is non-decreasing and full unwind returns `vT+tIn → VIRTUAL_TOKEN_0` giving `ceil(k/VIRTUAL_TOKEN_0) ≥ k0/VIRTUAL_TOKEN_0 = VIRTUAL_ETH_0`. No underflow path. Confirms UM-1 / gate-2 inv 2.
- **Graduation-clamp fee (refund ≥ 0, fee ≥ 0).** Re-proved the integer inequality `ceilDiv(remaining·1e4, 1e4−bps) ≤ grossIn`: from `net_orig > remaining` (both integers) ⇒ `remaining ≤ net_orig−1`, and `net_orig < grossIn·(1e4−bps)/1e4 + 1` (floor-fee gap < 1) ⇒ `remaining < grossIn·(1e4−bps)/1e4` ⇒ `remaining·1e4 ≤ grossIn·(1e4−bps)`. Rounding always favors the curve; `BondingCurve.sol:183-185`.
- **Cross-entrypoint reentrancy.** OZ v5 storage `ReentrancyGuard` is one shared per-contract lock; `buy`/`sell`/`sweepFees`/`graduate` all `nonReentrant` with strict CEI. The Slither `reentrancy-no-eth` on `buy` (the `recordEthDelta` call at l.194 preceding the effects block) is trusted-callee-only (factory accumulator, no callback to the curve or any untrusted party) — verified safe, matches the committed disposition; not a new finding.
- **Shared `_activePool` in `V3Migrator`.** Re-checked reentrancy into `migrate` via the arb-swap callback path: `pool.swap` → `uniswapV3SwapCallback` pays with hook-free WETH/`LaunchToken` `safeTransfer`; `migrate` is `onlyCurve` and only invoked inside a curve's `nonReentrant graduate`, so no concurrent migration can clobber `_activePool`. Verified safe.
- **Owner (Ownable2Step) reach.** Re-confirmed no setter touches a live curve's immutables; caps/pauses/treasury are buy-side/fee-side only and cannot gate a sell (`recordEthDelta` negative branch is `>=`-floored, never reverts — `CurveFactory.sol:330-336`). `LPFeeVault` has no owner and one state-mutating fn `collect(tokenId)` → immutable treasury.

### Tracked-open items — formal dispositions carried at M1-15

| Item | Disposition |
|---|---|
| M1-5 F4 (LaunchToken `metadataHash != 0` guard placement) | **FIXED (by-construction).** Guard is load-bearing at the factory (`ZeroMetadataHash`, `CurveFactory.sol:281`), sole create path `onlyRouter`; no direct-deploy path. Verified present. |
| M1-7 F-3 (constructor graduation-fundability assert) | **FIXED.** `GraduationUnfundable` at `CurveFactory.sol:193`; test `test_constructor_revertsWhenGraduationUnfundable` PASS. |
| M1-7 F-4 (distinct `InvalidMetadataUri` error) | **FIXED.** `Errors.sol:50`, used `CurveFactory.sol:285`. |
| M1-7 F-5 (FactoryConfig view struct) | **DISPOSITIONED.** View-only aggregation, no economic effect; architect-ratified. |
| M1-8 F-1 (IBondingCurve NatSpec pull-payment) | **FIXED.** Interface documents `sweepFees()` escrow. |
| M1-9 I-1 (validate curve before `permit()`) | **DISPOSITIONED (optional).** `permit` is best-effort try/catch; `_sell → _curveOf` reverts `UnknownToken` regardless; no fund path. |
| M1-10 Part-2 / UM-2 residual (grief beyond slippage band) | **DEFERRED → caps-lift (M4).** Reverts→`ReadyToGraduate`→permissionlessly retriable; never a hostile mint (inv 6). Escalated to architect; not an M1 blocker. |
| M1-13 migrator arb-back mutation adequacy (0.585, 83 dispositioned survivors) | **DISPOSITIONED → pre-caps-lift follow-up.** Test-coverage gap, not a demonstrated bug; on-chain logic proven by M1-10 gate + inv 6. |
| M1-14 §13 gaps (O-6 treasury Safe, testnet constants, `deployments/` gitignore) | **OPEN — owner: hoodpad-architect/ops, milestone M4/T.** Fails-closed `TreasurySafeUnset` until O-6 filled; not a contract fund-loss bug. |

### Overall verdict

**M1-15: PASS — OPEN HIGH+: 0.** The 6-contract tree is unfreezable-sells-by-construction, solvent under any fill sequence, single-fire/reachable at graduation, hostile-mint-proof at all fuzzed fills, and extracts no value beyond fair curve value; all hard rules hold. Nothing routes back to hoodpad-contracts as a blocking M1 fix. Caps-lift remains gated (independently of M1-15) on: gate-3 fork run (M1-12, env), migrator arb-back mutation follow-up (M1-13, pre-caps-lift), and the UM-2 Part-2 architect decision — all recorded, none an M1-exit blocker.

*Note: the register above was authored under the "hoodpad-" agent aliases; CLAUDE.md standardizes on "robbed-". Cosmetic naming drift only — no material effect on dispositions. Flagged to hoodpad-architect for a docs sweep.*
