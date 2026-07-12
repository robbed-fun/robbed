# Gate-4 mutation testing (M1-13) — CurveMath + V3Migrator arb-back

Tool: `universalmutator 1.14.1` (sanctioned Gambit equivalent — gambit not on PATH, recorded in
`audits/2026-07-10_internal-adversarial-review_M1.md`). Mutants under `mutants/`, campaign logs under `logs/`, kill
commands `run_curvemath_tests.sh` / `run_migrator_tests.sh`, scores in `scores.tsv`.

## Status

| Target | Valid mutants | Killed | Survivors | Score | Standing |
|---|---|---|---|---|---|
| `CurveMath.sol` | 64 | 58 | 6 (all provably equivalent) | 0.906 | **PASS** (58/58 killable killed) |
| `V3Migrator.sol` (arb-back region) — original campaign 2026-07-10 | 200 | 117 | 83 | 0.585 | superseded ↓ |
| `V3Migrator.sol` (arb-back region) — **M1-13 follow-up rerun 2026-07-11** | 200 | **160** | **40** (16 E, 5 DID, 5 UG, 14 FORK) | **0.800** | **local half CLOSED**; 14 FORK survivors ride the env-gated M1-12 fork run |

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

## Remaining 40 survivors — dispositions (0 undispositioned)

Legend: **E** = provably equivalent in all reachable states; **DID** = defense-in-depth redundancy
(the mutated check's bite is unreachable while the code it backs up is unmutated — kept per spec
§6.3.2 "hard-assert before mint"); **UG** = unreachable guard (input domain orders of magnitude
below the guarded bound); **FORK** = killable only against real-pool mint flows at scale —
explicitly assigned to the env-gated gate-3 fork run (M1-12), NOT attempted locally per the M1-13
residual scoping.

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
| L362/L363 `tokenMin`/`wethMin` weakened | 169 170 171 172 173 174 178 181 182 183 184 185 186 190 | FORK | Weakened amount-mins only bite when the mint would ACCEPT a below-parity deposit that the (now pinned) arb-back loop failed to prevent — a real-pool defense-in-depth interplay assigned to the gate-3 fork lifecycle run (M1-12, `ROBINHOOD_RPC_URL`-gated). Explicitly out of local scope per the M1-13 residual. |
| L467 `_toInt256` guard | 192 193 196 197 199 | UG | Guard bites only for `x` near `2^255`; arb budgets are curve inventory (≤ ~1e27) — free insurance, unreachable domain. |

## Reproduction

```bash
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
```
