---
description: Review files/dirs (or the current repo diff) against the project's hard rules in README.md + docs/developers/** and CLAUDE.md; outputs a findings table with doc references and severity.
allowed-tools: Read, Grep, Glob, Bash
---

Review **$ARGUMENTS** for compliance with the project's authority docs — `README.md`, the design docs under `docs/developers/**`, and `CLAUDE.md`.

Scope resolution:
- If `$ARGUMENTS` names files or directories, review exactly those.
- If `$ARGUMENTS` is empty, review the current repo diff: `git diff HEAD` plus staged changes plus untracked files (`git status --porcelain`); if the working tree is clean, review the last commit (`git show`).

First read `CLAUDE.md`, `README.md`, and the relevant design docs under `docs/developers/**` (`contracts.md`, `web.md`, `indexer.md`, `api.md`, `architecture.md`, `threat-model.md`) in full. Then check every in-scope file against the hard rules below. Check code, comments, copy strings, docs, and config — violations in copy or docs count the same as code.

## Rules to enforce (rule → docs ref)

1. `block.number` in any contract logic → `docs/developers/architecture.md` (Orbit chain semantics), `docs/developers/contracts.md`. Only `ArbSys(address(100)).arbBlockNumber()` or `block.timestamp`. (`grep -rn "block.number"` on Solidity scope; a mock/test-harness comment is the only tolerated hit.)
2. Compiler pragma anything other than the single exact pin (candidate `0.8.35` — no `^`, `>=`, ranges) in any `.sol` or `foundry.toml` → `docs/developers/contracts.md`.
3. Any flag, modifier, or code path that can block curve sells; any pause flag other than `pauseCreates`/`pauseBuys`; any pause authority post-graduation → `docs/developers/contracts.md`.
4. Caller-supplied fee amounts or `checkFee`-style validation instead of in-contract computation → `docs/developers/contracts.md`. Fee above the ≤2% hard cap → `docs/developers/contracts.md`.
5. LP copy: any use of "burn"/"burned" for LP destiny; anything deviating from the exact sentence "LP principal permanently locked; trading fees claimable by treasury" → `docs/developers/web.md`, `docs/developers/contracts.md` (flips only if the documented V2 fallback is formally adopted).
6. Hardcoded market metrics — ETH/USD, TVL, volumes, mcap thresholds as inline literals without source+timestamp or live query → `docs/developers/architecture.md`, and the always-on `no-market-metrics` rule.
7. Proxies/upgradeability patterns; mint/burn/owner/hooks/taxes/blacklist on LaunchToken; supply ≠ fixed 1B; missing `metadataHash` commitment → `docs/developers/contracts.md`.
8. LPFeeVault with an owner, a withdraw, any external function beyond `collect(tokenId)` → fixed treasury, or significant growth past ~50 lines → `docs/developers/contracts.md`.
9. Bespoke multisig instead of Gnosis Safe; admin not Ownable2Step; admin able to touch live curves or the vault → `docs/developers/contracts.md`.
10. Graduation deviating from Option B (V3 1% full-range, LP NFT → LPFeeVault) or missing the pre-seed defense (pool created+initialized at token creation; migrator arbs back / reverts, never hostile-mints) → `docs/developers/contracts.md`.
11. Missing slippage/deadline on trade entrypoints → `docs/developers/contracts.md`.
12. Confirmation tiers (soft-confirmed / posted / finalized) absent where the docs require them in indexer or UI → `docs/developers/architecture.md`, `docs/developers/indexer.md`.
13. Wrong or invented chain addresses (WETH must be `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`; the Uniswap v3 addresses must match the confirmed canonical set in `CLAUDE.md`, never invented) → `CLAUDE.md` chain facts, `docs/developers/architecture.md`.
14. License not MIT; OZ not v5 (SafeERC20/ReentrancyGuard/Ownable2Step) → `docs/developers/contracts.md`, `CLAUDE.md`.
15. Product claims of "real-time order book"/exchange semantics rather than soft-confirmed AMM → `README.md`.
16. Missing `creator` / `creatorFeeBps` (=0) tracking in schema from day 1 → `docs/developers/contracts.md`, `docs/developers/indexer.md`.
17. Any decision made silently instead of being recorded (compiler-pin confirmation, moderation vendor, bounty terms, curve constants) → the design decisions log in `docs/developers/`.

## Output

A findings table, most severe first:

| # | File:Line | Finding | Docs ref | Severity |
|---|---|---|---|---|

Severity: **Critical** (funds at risk / hard-rule violation in contract logic) · **High** (hard-rule violation elsewhere: copy, config, schema) · **Medium** (docs deviation, not a hard rule) · **Low/Info** (drift, ambiguity worth flagging).

After the table: a one-line verdict (`CLEAN` or `N findings, worst: <severity>`), and a "Docs ambiguities" list for anything where the authority docs are silent or self-contradictory — recommend routing those to `robbed-architect` to record in the design decisions log in `docs/developers/`, do not resolve them here. Do not fix anything; this command only reports.
