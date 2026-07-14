---
paths:
  - "contracts/**"
---

# Solidity hard rules — Robinhood Chain (Arbitrum Orbit)

Violations are bugs, not style. Owning design doc: `docs/developers/contracts.md` (Orbit chain semantics: `docs/developers/architecture.md`). Write-time enforcement: `.claude/hooks/check-hard-rules.sh`; also validate.sh stage 1 and CI.

- **Never `block.number`** in contract logic — on Orbit chains it returns an L1 estimate. Use `ArbSys(address(100)).arbBlockNumber()` or `block.timestamp`. Mocks/test harnesses are the one tolerated home.
- **One exact compiler pin** (`pragma solidity 0.8.35;`) — no `^`, `>=`, or ranges anywhere in the Foundry workspace.
- **Sells are always open.** No flag, pause, or code path may ever block curve sells; the only pause flags are `pauseCreates`/`pauseBuys`; zero pause authority post-graduation. Two carve-outs are *not* pauses: the deterministic `ReadyToGraduate` two-way lock pending permissionless `graduate()`, and — critically — **trade fees never push ETH to the treasury**: the 1% fee accrues in-contract and is withdrawn by a permissionless, non-phase-gated `sweepFees()`, so a hostile/reverting treasury cannot freeze sells.
- **Fees computed in-contract** — never caller-supplied fee amounts.
- **Immutable contracts, no proxies.** Upgrade = new factory version.
- **OZ v5 throughout**: SafeERC20, ReentrancyGuard, Ownable2Step. Treasury = Gnosis Safe, never a bespoke multisig.
- **LPFeeVault**: no owner, no withdraw, sole external fn `collect(tokenId)` → fixed treasury; keep it ~50 lines.
- **MIT license everywhere**; all contracts verified on Blockscout at deploy; repo public.
