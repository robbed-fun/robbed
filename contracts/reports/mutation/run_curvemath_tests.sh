#!/usr/bin/env bash
# Gate-4 (M1-13) test command for `analyze_mutants` against src/libs/CurveMath.sol mutants.
# Exit non-zero => mutant KILLED (a test failed). Exit zero => mutant SURVIVED.
# The direct CurveMath fuzz suite is the mutation-adequacy target (F1/F2/F3). A fixed fuzz seed
# makes the campaign reproducible; 20000 runs on the F1/F2 tests densely exercise the kill inputs.
set -o pipefail
export PATH="$HOME/.foundry/bin:$PATH"
export FOUNDRY_FUZZ_SEED=0x4d312d3133 # "M1-13"
cd /Users/aleksander-yusypenko/Documents/repos/launch/contracts || exit 2
forge test --match-path "test/fuzz/CurveMath.t.sol" >/dev/null 2>&1
