# Security Policy

ROBBED_ is a public-funds launchpad. Security reports are taken seriously and handled with priority.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

- Preferred channel: a **private GitHub security advisory** on this repository (Security → Report a vulnerability).
- Direct contact: *to be published before mainnet deployment* (tracked as part of the pre-launch security program).

Include: affected contract/component, a reproduction (tx sequence, PoC test, or request trace), and your assessment of impact. You will receive an acknowledgment, and a disposition (fixed / acknowledged / not-a-bug with reasoning) is recorded for every report — reports are never silently dropped.

## Scope

- `contracts/` — LaunchToken, CurveFactory, BondingCurve, Router, V3Migrator, LPFeeVault, CreatorVault (highest severity: anything that blocks curve sells, extracts ETH beyond fair curve value, breaks graduation single-fire, or moves LP principal).
- `apps/indexer`, `apps/api`, `apps/web`, `apps/keeper` — data integrity (confirmation-tier honesty, metadata-hash verification), upload pipeline, authentication, and graduation-liveness.

The design-time threat model — adversaries, attack trees, and the mitigation-verifying gates — is [threat-model.md](developers/threat-model.md); the invariants are proven by the Foundry suites under `contracts/test/`.

## The security program (10 gates)

Assurance rests on a layered gate program, all ten required before protocol caps lift; the capped beta is mandatory, not optional:

1. **Static analysis** — Slither (zero unexplained), Aderyn, solhint, CI-enforced `forge fmt` + custom hard-rule greps.
2. **Foundry unit + fuzz + invariants** — `k` non-decreasing; curve solvency (`balance ≥ realEthReserves + accruedFees [+ accruedCreatorFees]`); exact fee accounting; graduation single-fire and reachable; post-grad curve holds zero value; a pre-seeded/donated/swapped V3 pool can never force a hostile-ratio mint; no actor sequence extracts ETH beyond fair curve value.
3. **Fork tests on the live chain** — full lifecycle against the real V3 factory/NPM and real WETH.
4. **Mutation testing** on the curve + migrator math (the suite must kill mutants).
5. **Multi-model LLM audit** — ≥3 frontier models, adversarial prompts, per-contract + system pass, written findings register.
6. **Economic red-team on a fork** — sniper/sandwich/wash sims under FCFS, parameterized against the observed on-chain bot cohorts.
7. **Capped beta (mandatory)** — mainnet launch with a global TVL cap + per-token caps enforced in factory config, invariant-metric monitoring/alerting (incl. funding-cluster alerts), kill-switch limited to pause creates/buys only.
8. **Public bug bounty live before caps lift** — repo public from day 1.
9. **Decision gate before caps lift** — an explicit, budgeted decision on commissioning a Sherlock/Code4rena-style contest or firm review, never deferred by default.
10. **Published known-risks doc** — no-firm-audit disclosure, single-sequencer dependency, soft-confirmation semantics, centralized listing moderation, and heuristic organic-activity estimates.

Gate execution status and the ratified findings dispositions (e.g. the graduation grief-lock UM-2 disposition, gate 5/6 outcomes) are recorded in [design-decisions.md](developers/design-decisions.md); the mainnet program runs only after **Gate G-A** passes.

## Patch policy

- Contracts are **immutable — no proxies, no upgrades**. A contract-level fix ships as a new factory version; existing curves keep running (sells can never be paused, and no pause authority exists post-graduation). Operational mitigations are limited to `pauseCreates`/`pauseBuys` on the current factory.
- Off-chain services (indexer/API/web/keeper) are patched and redeployed on the normal release path; critical fixes go out immediately.

## Bug bounty

A public bug bounty is **planned, not yet live** — the security program requires it to be live before protocol caps lift (gate 8). Terms (scope, rewards, platform) are not yet decided; this file will be updated when they are. Until then, use the disclosure channel above.

## Audits

There is **no external firm audit** to date (gate 10 disclosure): assurance rests on the layered gate program above, and the caps-lift decision gate (gate 9) explicitly reconsiders commissioning an external review. Individual gate reviews are recorded in the pull requests that close them (history in git), not as committed tracker files.
