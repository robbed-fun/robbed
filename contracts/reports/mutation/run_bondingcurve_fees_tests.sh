#!/usr/bin/env bash
# Gate-4 (§12.63 re-run, finding F-3) test command for `analyze_mutants` against the NEW
# BondingCurve two-leg fee-split lines (bondingcurve_fees_lines.txt): the treasury+creator ETH-leg
# computation and the proportional clamp-residual split in buy/sell/quoteBuy/quoteSell, plus the
# two accrual sinks. Exit non-zero => mutant KILLED (a test failed).
#
# PRIMARY kill suite = fast unit tests that assert EXACT fee values on both legs (kills arithmetic
# mutants precisely without the per-mutant cost of the fuzz campaigns):
#   - unit/CreatorFee   — two-leg split (cBps=50), clamp/F-1 boundary, hostile-creator accrual
#   - unit/BondingCurve — treasury leg + net-into-reserves at cBps=0 (byte-identical baseline)
# SURVIVORS are then re-run through the wei-exact fuzz suites (invariant/CreatorFeeInvariants cBps=50 +
# invariant/FeeExactness cBps=0) via run_bondingcurve_fees_survivors.sh — same two-tier pattern as the
# V3Migrator arb-back campaign. Fixed fuzz seed for reproducibility.
set -o pipefail
export PATH="$HOME/.foundry/bin:$PATH"
export FOUNDRY_FUZZ_SEED=0x31322e3633 # "12.63"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 2
forge test --match-path "test/{unit/CreatorFee,unit/BondingCurve}.t.sol" >/dev/null 2>&1
