#!/usr/bin/env bash
# hoodpad hard-rule enforcement (CLAUDE.md / launchpad-spec.md).
# PostToolUse hook for Write|Edit|MultiEdit: greps the just-written file for
# spec violations. Exit 2 blocks the result and feeds the message back to the
# agent; exit 0 passes. High-precision rules only — anything fuzzy belongs in
# /spec-check or review, not here.

set -u
input=$(cat)

if command -v jq >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
else
  file=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
fi
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

# Docs, spec, and .claude assets discuss the rules — never enforce on them.
case "$file" in
  */launchpad-spec.md|*/CLAUDE.md|*/docs/*|*/.claude/*|*README*|*.lock|*/lib/*) exit 0 ;;
esac

fail=0
err() { echo "SPEC VIOLATION: $1" >&2; fail=1; }

case "$file" in
  *.sol)
    # Mocks/test harnesses are the one tolerated home for block.number (spec §2 note)
    case "$file" in
      */test/*|*Mock*) : ;;
      *)
        if grep -qE '\bblock\.number\b' "$file"; then
          err "block.number in $file — forbidden on Orbit (spec §2, §6.5). Use ArbSys(address(100)).arbBlockNumber() or block.timestamp."
        fi
        ;;
    esac
    if grep -qE 'pragma solidity\s*(\^|>|<|~)' "$file"; then
      err "pragma version range in $file — exact single pin required (spec §6.7), e.g. 'pragma solidity 0.8.35;'"
    fi
    if grep -qE 'SPDX-License-Identifier:\s*UNLICENSED' "$file"; then
      err "UNLICENSED in $file — repo is MIT (spec §4.1, §6.7)"
    fi
    if grep -qiE '\bpause(d)?Sell|sellsPaused|whenSellsNotPaused' "$file"; then
      err "sell-pause pattern in $file — sells can never be pausable (spec §6.5, §12.12)"
    fi
    ;;
esac

# User-facing / shared code: LP copy and positioning language (spec §1, §5.2/§5.3, §12.14)
case "$file" in
  */apps/web/*|*/packages/shared/*)
    if grep -qiE '(LP|liquidity)[^.]{0,60}burn|burn[^.]{0,60}\b(LP|liquidity)\b' "$file"; then
      err "'burned' used in LP context in $file — canonical copy is 'LP principal permanently locked; trading fees claimable by treasury.' (spec §12.14)"
    fi
    if grep -qiE 'order[- ]?book' "$file"; then
      err "order-book claim in $file — product is an AMM with soft confirmations, never an order book (spec §1)"
    fi
    ;;
esac

[ "$fail" -ne 0 ] && exit 2
exit 0
