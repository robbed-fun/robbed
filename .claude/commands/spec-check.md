---
description: Review files/dirs (or the current repo diff) against docs/spec.md hard rules and CLAUDE.md; outputs a findings table with spec references and severity.
allowed-tools: Read, Grep, Glob, Bash
---

Review **$ARGUMENTS** for compliance with `docs/spec.md` (v1.1) and `CLAUDE.md`.

Scope resolution:
- If `$ARGUMENTS` names files or directories, review exactly those.
- If `$ARGUMENTS` is empty, review the current repo diff: `git diff HEAD` plus staged changes plus untracked files (`git status --porcelain`); if the working tree is clean, review the last commit (`git show`).

First read `CLAUDE.md` and `docs/spec.md` in full. Then check every in-scope file against the hard rules below. Check code, comments, copy strings, docs, and config — violations in copy or docs count the same as code.

## Rules to enforce (rule → spec ref)

1. `block.number` in any contract logic → §2, §6.5. Only `ArbSys(address(100)).arbBlockNumber()` or `block.timestamp`. (`grep -rn "block.number"` on Solidity scope; a mock/test-harness comment is the only tolerated hit.)
2. Compiler pragma anything other than the single exact pin (candidate `0.8.35` — no `^`, `>=`, ranges) in any `.sol` or `foundry.toml` → §6.7.
3. Any flag, modifier, or code path that can block curve sells; any pause flag other than `pauseCreates`/`pauseBuys`; any pause authority post-graduation → §6.5.
4. Caller-supplied fee amounts or `checkFee`-style validation instead of in-contract computation → §4.1, §6.5. Fee above the ≤2% hard cap → §6.4.
5. LP copy: any use of "burn"/"burned" for LP destiny; anything deviating from the exact sentence "LP principal permanently locked; trading fees claimable by treasury" → §5.2, §5.3, §6.3 (flips only if the documented V2 fallback is formally adopted).
6. Hardcoded market metrics — ETH/USD, TVL, volumes, mcap thresholds as inline literals without source+timestamp or live query → §2, §6.4.
7. Proxies/upgradeability patterns; mint/burn/owner/hooks/taxes/blacklist on LaunchToken; supply ≠ fixed 1B; missing `metadataHash` commitment → §6, §6.1, §8.3.
8. LPFeeVault with an owner, a withdraw, any external function beyond `collect(tokenId)` → fixed treasury, or significant growth past ~50 lines → §6.3, §6.6.
9. Bespoke multisig instead of Gnosis Safe; admin not Ownable2Step; admin able to touch live curves or the vault → §6.6.
10. Graduation deviating from Option B (V3 1% full-range, LP NFT → LPFeeVault) or missing the pre-seed defense (pool created+initialized at token creation; migrator arbs back / reverts, never hostile-mints) → §6.3, §12.1.
11. Missing slippage/deadline on trade entrypoints → §6.5.
12. Confirmation tiers (soft-confirmed / posted / finalized) absent where the spec requires them in indexer or UI → §2.1, §8.
13. Wrong or invented chain addresses (WETH must be `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`; v3 addresses must come from official registries, open item §13) → §2, CLAUDE.md.
14. License not MIT; OZ not v5 (SafeERC20/ReentrancyGuard/Ownable2Step) → §4.1, §6.6, CLAUDE.md.
15. Product claims of "real-time order book"/exchange semantics rather than soft-confirmed AMM → §1.
16. Missing `creator` / `creatorFeeBps` (=0) tracking in schema from day 1 → §7.
17. Any silently-decided open item from §13 (invented compiler-pin confirmation, v3 addresses, moderation vendor, bounty terms, curve constants) → §13.

## Output

A findings table, most severe first:

| # | File:Line | Finding | Spec ref | Severity |
|---|---|---|---|---|

Severity: **Critical** (funds at risk / hard-rule violation in contract logic) · **High** (hard-rule violation elsewhere: copy, config, schema) · **Medium** (spec deviation, not a hard rule) · **Low/Info** (drift, ambiguity worth flagging).

After the table: a one-line verdict (`CLEAN` or `N findings, worst: <severity>`), and a "Spec ambiguities" list for anything where the spec is silent or self-contradictory — recommend routing those to `robbed-architect` for §12/§13, do not resolve them here. Do not fix anything; this command only reports.
