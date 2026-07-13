#!/usr/bin/env bash
# Gate-4 (§12.63 re-run, finding F-3) test command for `analyze_mutants` against the NEW
# CurveFactory ADDITIVE ≤2% cap lines (factory_cap_lines.txt): the constructor assertion
# `tradeFeeBps + creatorFeeBps ≤ MAX_TRADE_FEE_BPS` and the two setter re-assertions
# (setTradeFeeBps / setCreatorFeeBps). Exit non-zero => mutant KILLED (a test failed).
#
# Kill suite (asserts the boundary == 200 accepted and > 200 reverted, constructor + both setters):
#   - unit/CreatorFee — cap boundary (200 accepted / 201 reverts), setter-cap with a live creator leg
#   - unit/Factory    — fee-cap ceilings + config surface
set -o pipefail
export PATH="$HOME/.foundry/bin:$PATH"
export FOUNDRY_FUZZ_SEED=0x31322e3633 # "12.63"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 2
forge test --match-path "test/{unit/CreatorFee,unit/Factory}.t.sol" >/dev/null 2>&1
