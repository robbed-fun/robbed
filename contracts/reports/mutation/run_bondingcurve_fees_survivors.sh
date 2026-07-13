#!/usr/bin/env bash
# Gate-4 (§12.63 re-run, F-3) SURVIVOR re-run for the BondingCurve fee-split campaign: the wei-exact
# FUZZ suites, which catch arithmetic mutants the unit tests leave equivalent-under-tested-inputs.
# Exit non-zero => mutant KILLED. Run only against unit-survivors (analyze_mutants --fromFile).
set -o pipefail
export PATH="$HOME/.foundry/bin:$PATH"
export FOUNDRY_FUZZ_SEED=0x31322e3633 # "12.63"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 2
forge test \
  --match-path "test/{invariant/CreatorFeeInvariants,invariant/FeeExactness,unit/CreatorFee,unit/BondingCurve}.t.sol" \
  >/dev/null 2>&1
