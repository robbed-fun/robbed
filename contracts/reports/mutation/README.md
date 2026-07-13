# Gate-4 mutation testing — CurveMath + V3Migrator arb-back (M1-13) + §12.63 creator-fee split & cap

Tool: `universalmutator 1.14.1` (sanctioned Gambit equivalent — gambit not on PATH, recorded in the
M1 adversarial review, 2026-07-10; history in git). Mutants under `mutants/`, campaign logs under `logs/`, kill
commands `run_curvemath_tests.sh` / `run_migrator_tests.sh` / `run_bondingcurve_fees_tests.sh` /
`run_bondingcurve_fees_survivors.sh` / `run_factory_cap_tests.sh`, scores in `scores.tsv`. The §12.63
creator-fee re-run (robbed-security gate-2 re-open, finding F-3) is documented in its own section below.

## Status

| Target | Valid mutants | Killed | Survivors | Score | Standing |
|---|---|---|---|---|---|
| `CurveMath.sol` | 64 | 58 | 6 (all provably equivalent) | 0.906 | **PASS** (58/58 killable killed) |
| `V3Migrator.sol` (arb-back region) — original campaign 2026-07-10 | 200 | 117 | 83 | 0.585 | superseded ↓ |
| `V3Migrator.sol` (arb-back region) — **M1-13 follow-up rerun 2026-07-11** | 200 | **160** | **40** (16 E, 5 DID, 5 UG, 14 FORK) | **0.800** | superseded ↓ (FORK leg discharged) |
| `V3Migrator.sol` (arb-back region) — **M1-12 fork-run discharge 2026-07-12** | 200 | **160** | **40** (16 E, **19 DID**, 5 UG, **0 FORK**) | **0.800** | **CLOSED** — gate-3 fork suite green + per-mutant fork-slice rerun; 0 env-gated survivors remain (see "M1-12 fork-run discharge" below) |

Adequacy accounting for the rerun: the original 117 kills stand (their killing suites are
unchanged); each of the 83 original survivors was re-executed against the new kill suite
(`forge test --match-path test/unit/MigratorArbBackKill.t.sol`, mutant copied over
`src/V3Migrator.sol`, non-zero exit = killed). Per-mutant results:
`logs/migrator_killed.m113_followup.txt` (43) / `logs/migrator_notkilled.m113_followup.txt` (40).
`run_migrator_tests.sh` now includes the kill suite, so any future full campaign reproduces
≥ 0.800 directly.

## M1-13 follow-up kill-tests (`test/unit/MigratorArbBackKill.t.sol`)

The five enumerated adversarial kill-tests from the M1-13 residual
(plan item M1-13 / the M1 review row "migrator arb-back mutation adequacy").
All revert expectations use the exact `ArbBudgetExceeded()` selector — in the unmutated migrator
that error exists at a single site (`_arbStep`, `budget == 0`), reachable on a leg-over-budget
scenario only on the SECOND loop iteration after a full-budget exact-input spend (v3-core: exact
input is fully consumed unless the price limit — the exact target — is hit; a zero-amount swap
reverts `'AS'` in the pool). Mutants therefore surface as `'AS'`, `Panic(0x11)`,
`PoolPriceUnrecoverable`, NPM `'Price slippage check'`, or an inverted success/failure.

| # | Enumerated kill-test | Test(s) | Pins | Survivors killed |
|---|---|---|---|---|
| 1 | budget-boundary (per-leg budget exactly at/over the boundary) | `test_budgetBoundary_tokenLeg_overBudget_revertsArbBudgetExceeded` (band > 2× token budget → iter-2 exact revert, curve retriable), `test_budgetBoundary_wethLeg_withinBudget_graduates` (cost ≈ 0.03 ETH: ≫ mutated tiny budgets, < real 1% budget) | token floor `lpTranche·(1−bps)` (L308) + live-balance budget (L310); WETH budget `wethForMint·bps/1e4` (L269) lower side | 110 111 112 113 114 115 119 120 121 129 130 · 27 28 29 34 |
| 2 | token>WETH address ordering (mirror of every directed cycle) | whole suite instantiated as `MigratorArbBackKillToken0Test` + `MigratorArbBackKillToken1Test` (MockWETH9 runtime `vm.etch`ed at `type(uint160).max` / `0x1001` to force the sort order); `test_ordering_cleanGraduation_mintsExactlyAtTarget`, `test_ordering_tokenLegRecoverable_graduates` | both `TARGET_TICK_TOKEN0/1` + `SQRT_PRICE_TOKEN0/1_X96` selections, final-check lower bound, `inputAsset` leg classification in both orders | 6 7 19 (token0 clean path) · 97 (token0 token-leg) · 99/100 (leg compare, one per ordering, via test 3) |
| 3 | 2-iteration WETH-leg spend | `test_wethLeg_secondIteration_budgetExhausted_revertsExactly_thenRetriable` (band needs ≈ 2 ETH ≫ 0.0808 budget → iteration 1 consumes the whole budget, iteration 2 provably entered and reverts exactly; then a third-party corrective swap and the SAME curve graduates — §12.12 retriability) | cumulative `wethArbSpent` accounting (L320), TM-T2 remaining-budget recomputation (L312), `budget == 0` guard (L314), loop iteration structure (L272–275), `wethArbBudget` formula upper side (L269) | 31 32 33 55 99 100 104 107 142 143 150 151 152 154 157 158 163 166 |
| 4 | exact-tolerance-tick boundary | `test_toleranceBoundary_exactUpper/exactLower_graduates_withoutArb` (price set to bit-exact `getSqrtRatioAtTick(target±100)`; graduation succeeds AND the final tick is asserted UNCHANGED — the arb must not run at the inclusive boundary), `test_toleranceBoundary_justBeyondUpper/Lower_arbRunsBackToExactTarget` (at ±101 the arb must run and, being price-limited, land exactly on target) | `_withinTolerance` inclusivity (L282), final-check boundary comparators (L255), O-8 `TOLERANCE_TICKS = 100` (§12.33) | 71 74 · 9 10 14 15 |
| 5 | per-leg budget asymmetry regression (M-10-A) | `MigratorM10AFloorRegressionTest::test_M10A_regression_preFixTokenFloor_freezesGraduation` — migrator deployed with `migrationSlippageBps = 0`, making `tokenArbFloor == LP_TOKEN_TRANCHE` byte-for-byte the PRE-FIX floor; the same recoverable token-leg grief the live config graduates then freezes in `ReadyToGraduate` with exactly `ArbBudgetExceeded` | that `MIGRATION_SLIPPAGE_BPS > 0` in the symmetric floor is load-bearing for graduation liveness; EXTENDS (not duplicates) the M1-10 re-gate liveness: directed `test_M10A_*` units + `ghost_tokenLegLivenessGraduations` afterInvariant in `invariant/PoolGriefingNoHostileMint.t.sol` | (hand-mutant class: any tranche-anchored token floor; no numbered survivor — the numbered floor mutants fall under #1) |

Note on "fails just beyond" (kill-test 4): a genuine graduation *failure* at exactly ±101 ticks is
economically unconstructible against an (initially) liquidity-free pool — the arb recovers a
1-tick error for free, and pinning a 1-tick move beyond the 1% budget would need ≈ thousands of
ETH of attacker liquidity inside one tick. The boundary pair therefore pins the inclusive/exclusive
edge via exact final-tick assertions, and genuine budget-bounded failure beyond the recoverable
range is pinned by kill-tests 1 and 3 (exact `ArbBudgetExceeded` + retriability).

## M1-12 fork-run discharge (2026-07-12)

The gate-3 fork suite ran GREEN against live Robinhood Chain mainnet (chain ID 4663, asserted via
`cast chain-id`; RPC `https://rpc.mainnet.chain.robinhood.com` from docs.robinhood.com/chain/connecting;
pinned fork block 7,210,863):
`FOUNDRY_PROFILE=fork forge test` → `2 passed, 0 failed, 0 skipped` (`test_fork_arbSysSmoke`,
`test_fork_fullLifecycle` — full create → trade → graduate → collect against the real §12.28 V3
factory/NPM and real WETH `0x0Bd7…AD73`).

The 14 FORK-dispositioned survivors were then re-executed per-mutant against the fork suite
(mutant copied over `src/V3Migrator.sol`, `FOUNDRY_PROFILE=fork forge test`, non-zero exit =
killed): **all 14 survived the clean fork lifecycle.** This is the expected — indeed the only
possible — outcome: every one of the 14 *weakens* `tokenMin`/`wethMin` (the strengthening
variants were already killed locally by the clean-mint paths), and a weakened minimum cannot bite
on a clean, unpolluted mint. A scenario that kills them would need a hostile-ratio mint that slips
past the arb-back loop and the L255 final tolerance check — both pinned unmutated by the local
kill suite (kill-tests 1–4) and the `PoolGriefingNoHostileMint` invariant. The original
"killable only against real-pool mint flows at scale" phrasing was optimistic; the honest final
disposition is **DID (local-calibration; fork-confirmed unmutated-min liveness)** — the fork run
proved the UNMUTATED mins' liveness against the real pool math, NOT the per-mutant equivalence
(the per-mutant fork survivals were tautological, as conceded above); the equivalence half is a
LOCAL calibration argument, pinned by the contingency guard below:

1. **Liveness (real-pool half, previously unprovable locally):** the green fork lifecycle proves
   the UNMUTATED mins accept the real-NPM mint at the deterministic graduation ratio — the mins
   are not too tight against real v3 pool math.
2. **Safety (local half, already pinned):** the mins' bite is unreachable while the pinned
   arb-back loop + final tolerance check stand; they remain the spec-mandated §6.3.2
   "amount-mins enforced" last line before mint (hard requirement — presence, not mutation
   adequacy of a redundant net, is what the spec demands).

0 env-gated survivors remain; the M1-13 rider on M1-12 is discharged.

### Calibration contingency (2026-07-12 — the 14×DID row is CONTINGENT on this relation)

The DID equivalence of the 14 L362/L363 min-weakening mutants holds ONLY while

```
1.0001^TOLERANCE_TICKS × (1 − MIGRATION_SLIPPAGE_BPS/10000) ≤ 1
```

i.e. the amount-min floor `(1 − s)` covers the worst amount skew the ±`TOLERANCE_TICKS`
final-price band (V3Migrator L255) admits. Past the bound the UNMUTATED mins CAN bite in reachable
states — weakening them becomes observable (equivalence gone, **gate 4 re-opens for these rows**)
and, independently, graduation gains a §12.12 liveness hazard (NPM amount-min revert AFTER the
L255 tolerance check passed). Current §12.33 calibration: `1.0001^100 × 0.99 = 0.99994917 ≤ 1`,
margin ≈ 0.00508% — and the bound is SHARP: `TOLERANCE_TICKS = 101` at 100 bps already violates it
(zero upward retune headroom).

Both parameters are beta-retunable (§12.32/§12.33), so the relation is PINNED by two fail-closed
guards (2026-07-12, robbed-security findings on the mutation-disposition review):

- `test/unit/GradCalibrationGuard.t.sol` — asserts the relation for the `TestConstants` M0 mirror
  (failure message names these gate-4 rows), proves the predicate catches the violating
  calibrations (200 and 101 ticks @ 100 bps; 50 and 0 bps @ 100 ticks) via literal-pinned
  negative cases, and proves the deploy-side assert below via a bad-calibration fixture.
- `script/Deploy.s.sol::_consistencyChecks` — reverts `MinFloorToleranceBandViolated(toleranceTicks,
  migrationSlippageBps)` pre-broadcast, so a retuned `constants.json` past the bound fails the
  deploy closed (script-side only; no production bytecode change). Math is 1e18 fixed point
  (round-UP square-and-multiply — pass ⇒ the true relation holds; no floats, no vendored TickMath).

A future retune past the bound RE-OPENS gate 4 for these 14 rows: re-derive the disposition (and
re-balance the min formulas / tolerance) before the retune ships.

## Remaining 40 survivors — dispositions (0 undispositioned, 0 env-gated)

Legend: **E** = provably equivalent in all reachable states; **DID** = defense-in-depth redundancy
(the mutated check's bite is unreachable while the code it backs up is unmutated — kept per spec
§6.3.2 "hard-assert before mint"); **UG** = unreachable guard (input domain orders of magnitude
below the guarded bound); ~~**FORK**~~ = *(retired 2026-07-12)* was: assigned to the env-gated
gate-3 fork run (M1-12) — discharged as **DID (local-calibration; fork-confirmed unmutated-min
liveness)** above.

| Line | Mutants | Disposition | Reasoning |
|---|---|---|---|
| L255 final tolerance check weakened/removed | 18 20 23 25 26 | DID | The check re-asserts what `_arbToTarget` already guarantees (price-limited swaps cannot overshoot; off-target exits revert in `_arbStep`). Its bite is unreachable unless the loop is ALSO broken — the loop itself is now pinned by kill-tests 1/3/4. Kept as the spec-mandated last line before mint. |
| L272 loop bound form | 37 39 41 42 | E | Any iteration bound ≥ 2 is behaviorally identical: iteration ≥ 2 either breaks on tolerance or reverts on a zero budget (exact-input swaps fully consume the leg budget or reach target — no third outcome), so 7/8/9 iterations and `<`/`!=` are indistinguishable. Iteration-2 entry itself is pinned by kill-test 3. |
| L274 `continue` after the arb step | 56 | E | `continue` as the last statement of a `for` body is a no-op. |
| L289 `curSqrt >= targetSqrt` | 93 | E | `curSqrt == targetSqrt` inside `_arbStep` is unreachable: at the target price the tick equals the target tick, so `_withinTolerance` breaks the loop first. |
| L310 token budget compare/else | 123 126 128 | E | 123: `bal % floor ≡ bal − floor` whenever `floor ≤ bal < 2·floor`, always true here (`bal ≈ tranche + dust`, `floor = 0.99·tranche`). 126: `>=` vs `>` differs only at `bal == floor`, where both yield 0. 128: `bal < floor` unreachable (token-leg swaps draw down at most to the floor; the loop never flips legs). |
| L312 WETH remaining-budget form | 133 139 141 | E | Spend can never exceed the budget (each step's exact input IS the remaining budget), so the only boundary is `spent == budget`, where the `>` gate already yields 0 for every variant (`+`, `>=`, `!=` included). Verified empirically: 133 survives the over-budget scenario because iteration 2 still reverts `ArbBudgetExceeded` identically. |
| L314 `budget <= 0` | 147 | E | `<= 0 ≡ == 0` on `uint256`. |
| L320 spend accumulator inflations | 161 162 164 | E | 161/162 make `wethArbSpent` LARGER → iteration-2 budget is 0 exactly as in the original (same revert). 164: `before % after ≡ before − after` while a step spends < half the WETH balance — the budget is 1% of it. (Deflating variants 157/158/163/166 ARE killable and are killed by kill-test 3.) |
| L362/L363 `tokenMin`/`wethMin` weakened | 169 170 171 172 173 174 178 181 182 183 184 185 186 190 | DID (local-calibration; fork-confirmed unmutated-min liveness — 2026-07-12) | Weakened amount-mins only bite when the mint would ACCEPT a below-parity deposit that the (pinned) arb-back loop failed to prevent. Discharged by the M1-12 fork run (see "M1-12 fork-run discharge" above): green real-pool lifecycle proves the unmutated mins pass the real NPM at the graduation ratio (liveness); per-mutant fork-slice rerun confirms all 14 survive the clean lifecycle (weakened mins cannot bite on a clean mint — their safety bite is unreachable while the pinned loop + L255 check stand). Kept per spec §6.3.2 amount-mins mandate. **CONTINGENT** on `1.0001^TOLERANCE_TICKS × (1 − MIGRATION_SLIPPAGE_BPS/1e4) ≤ 1` (see "Calibration contingency" above; pinned by `test/unit/GradCalibrationGuard.t.sol` + `Deploy._consistencyChecks`) — a §12.32/§12.33 retune past the bound re-opens gate 4 for this row. |
| L467 `_toInt256` guard | 192 193 196 197 199 | UG | Guard bites only for `x` near `2^255`; arb budgets are curve inventory (≤ ~1e27) — free insurance, unreachable domain. |

## §12.63 creator-fee re-run (robbed-security gate-2 re-open, finding F-3) — 2026-07-13

Two new campaigns cover the Phase-2 creator-fee surface: the BondingCurve **two-leg fee split**
(treasury + creator computation + the proportional graduation-clamp residual split in
`buy`/`sell`/`quoteBuy`/`quoteSell` + the F-1 clamp guard + the two accrual sinks —
`bondingcurve_fees_lines.txt`) and the CurveFactory **additive ≤2% cap** (constructor +
`setTradeFeeBps`/`setCreatorFeeBps` — `factory_cap_lines.txt`). Kill scripts:
`run_bondingcurve_fees_tests.sh` (fast unit tier), `run_bondingcurve_fees_survivors.sh` (fuzz tier),
`run_factory_cap_tests.sh`.

| Target | Valid | Killed | Survivors | Score | Standing |
|---|---|---|---|---|---|
| `BondingCurve.sol` (fee-split) unit tier | 490 | 454 | 36 | 0.926 | tier 1 |
| `BondingCurve.sol` (fee-split) + fuzz-survivor rerun + 2 kill-tests | 490 | **475** | **15 (all provably equivalent)** | **0.969** | **PASS** (475/475 killable killed) |
| `CurveFactory.sol` (additive cap) | 96 | **96** | **0** | **1.000** | **PASS** |

Two real survivors were found and killed with deterministic unit tests (added to
`test/unit/CreatorFee.t.sol`, so future campaigns reproduce the higher score):

- **quoteBuy clamp creator-residual mis-split** (mutant 398: `totBps >= 0 ? 0` on the L400 split,
  the tiny-residual fuzz clamps left equivalent) → `test_clampSplit_nonZeroCreatorLeg_exact` drives a
  ~10× graduation overshoot with a LARGE non-zero clamp residual and asserts `quoteBuy`'s returned
  treasury fee + both accrual legs are the exact proportional split.
- **quoteBuy creator-leg mis-netting** (mutant 301: `net = gross − fee + creatorFee`, invisible at
  cBps=0, wrong at cBps>0) → `test_quoteBuy_tokensOutParity_withCreatorLeg` asserts quoted tokensOut
  equals the tokens an actual buy delivers.
- **CurveFactory `!= cap`** (mutant 40: `setTradeFeeBps` used `!=` not `>`, passing the boundary
  test) → a sub-cap success assertion (`setTradeFeeBps(50)` with a 100-bps creator leg must apply,
  not revert) in `test_cap_setTradeFeeBps_enforcedWithCreatorLeg`.

The fuzz tier (`run_bondingcurve_fees_survivors.sh`: `CreatorFeeInvariants` cBps=50 + `FeeExactness`
cBps=0, wei-exact both-leg accrual) kills **20 of the 36** unit-survivors deterministically (default
256 invariant runs — the kill count is stable at ≥256 runs; fewer runs kill fewer, so the kill script
does NOT lower `FOUNDRY_INVARIANT_RUNS`).

### Remaining 15 fee-split survivors — all E (provably equivalent, 0 undispositioned)

| Line | Mutants | Disp. | Reasoning |
|---|---|---|---|
| L221 / L398 F-1 clamp `acceptedEthGross > grossIn` → `>=` | 61 349 | E | At `acceptedEthGross == grossIn` the clamp `acceptedEthGross = grossIn` is a no-op, so `>=` and `>` are behaviorally identical. |
| L227 / L400 clamp-split div-by-zero guard `totBps == 0` mutated | 110 113 114 115 118 119 397 400 401 402 405 406 | E | The `totBps == 0` branch is defensive — it avoids a `/totBps` div-by-zero when BOTH legs are 0. Under EVERY fee-bearing config `totBps ≥ tradeFeeBps ≥ 100`, so the branch is never taken and the else (`(totalFee·cBps)/totBps`) always runs; the `== 0/1`, `<= 0`, `< 0`, `? 1` variants all agree with the original on the reachable domain. (The degenerate both-fees-0 config yields `totalFee == 0`, so even there no creator fee is lost.) Guard kept as defensive-only. |
| L399 quoteBuy `totalFee = acceptedEthGross − net` → `%` | 371 | E | `acceptedEthGross % net ≡ acceptedEthGross − net` whenever `net ≤ acceptedEthGross < 2·net`, always true for a fee-clamp (`totalFee` is ≤ ~1.5% of `net` ≪ `net`). |

## Reproduction

```bash
# §12.63 fee-split + cap campaigns (universalmutator 1.14.1; run from contracts/):
#   mutate src/BondingCurve.sol solidity --lines reports/mutation/bondingcurve_fees_lines.txt \
#     --mutantDir reports/mutation/mutants/bondingcurve_fees --noCheck
#   analyze_mutants src/BondingCurve.sol reports/mutation/run_bondingcurve_fees_tests.sh \
#     --mutantDir reports/mutation/mutants/bondingcurve_fees --seed 1      # unit tier (0.926)
#   analyze_mutants src/BondingCurve.sol reports/mutation/run_bondingcurve_fees_survivors.sh \
#     --mutantDir reports/mutation/mutants/bondingcurve_fees --fromFile <unit-survivors> --seed 1
#   mutate src/CurveFactory.sol solidity --lines reports/mutation/factory_cap_lines.txt \
#     --mutantDir reports/mutation/mutants/factory_cap --noCheck
#   analyze_mutants src/CurveFactory.sol reports/mutation/run_factory_cap_tests.sh \
#     --mutantDir reports/mutation/mutants/factory_cap --seed 1            # 96/96

# ── prior M1-13 campaigns ──
# full campaign (universalmutator):
#   mutate src/V3Migrator.sol --lines reports/mutation/migrator_arbback_lines.txt ...
#   analyze_mutants src/V3Migrator.sol reports/mutation/run_migrator_tests.sh ...
# follow-up survivor rerun (what produced the 0.800 row):
cd contracts
for m in $(cat reports/mutation/logs/migrator_notkilled.txt); do
  cp reports/mutation/mutants/migrator/$m src/V3Migrator.sol
  forge test --match-path 'test/unit/MigratorArbBackKill.t.sol' >/dev/null 2>&1 \
    && echo "$m SURVIVED" || echo "$m KILLED"
done
git checkout -- src/V3Migrator.sol

# M1-12 fork-slice rerun of the 14 (ex-)FORK survivors (what produced the 2026-07-12 row;
# requires network access to the live 4663 RPC — block-pinned, so repeats hit the RPC cache):
for m in 169 170 171 172 173 174 178 181 182 183 184 185 186 190; do
  cp reports/mutation/mutants/migrator/V3Migrator.mutant.$m.sol src/V3Migrator.sol
  ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com FOUNDRY_PROFILE=fork \
    forge test >/dev/null 2>&1 && echo "$m SURVIVED" || echo "$m KILLED"
done
git checkout -- src/V3Migrator.sol
# 2026-07-12 result: all 14 SURVIVED (expected — see "M1-12 fork-run discharge").
```
