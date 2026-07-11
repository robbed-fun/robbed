#!/usr/bin/env bash
# Gate-4 (M1-13) test command for `analyze_mutants` against V3Migrator arb-back mutants.
# Exit non-zero => mutant KILLED. Runs the four suites that exercise the arb-back budget floors,
# tolerance check and price-limit: the Migrator unit suite (preseed griefing / TM-T2 / M10A), the
# M1-13 follow-up arb-back kill-tests (per-leg budget boundaries, both token/WETH orderings,
# 2-iteration WETH spend, exact-tolerance-tick boundary, M-10-A floor regression), the V3
# slot0/tick assertions, and the pool-griefing hostile-mint invariant. Fixed fuzz/invariant seed
# for reproducibility.
set -o pipefail
export PATH="$HOME/.foundry/bin:$PATH"
export FOUNDRY_FUZZ_SEED=0x4d312d3133 # "M1-13"
cd /Users/aleksander-yusypenko/Documents/repos/launch/contracts || exit 2
forge test \
  --match-path "test/{unit/Migrator,unit/MigratorArbBackKill,unit/V3Assertions,invariant/PoolGriefingNoHostileMint}.t.sol" \
  >/dev/null 2>&1
