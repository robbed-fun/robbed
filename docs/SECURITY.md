# Security Policy

ROBBED_ is a public-funds launchpad. Security reports are taken seriously and handled with priority.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

- Preferred channel: a **private GitHub security advisory** on this repository (Security → Report a vulnerability).
- Direct contact: *to be published before mainnet deployment* (tracked as part of the pre-launch security program).

Include: affected contract/component, a reproduction (tx sequence, PoC test, or request trace), and your assessment of impact. You will receive an acknowledgment, and a disposition (fixed / acknowledged / not-a-bug with reasoning) is recorded for every report — reports are never silently dropped.

## Scope

- `contracts/` — LaunchToken, CurveFactory, BondingCurve, Router, V3Migrator, LPFeeVault (highest severity: anything that blocks curve sells, extracts ETH beyond fair curve value, breaks graduation single-fire, or moves LP principal).
- `apps/indexer`, `apps/api`, `apps/web` — data integrity (confirmation-tier honesty, metadata-hash verification), upload pipeline, authentication.

The protocol's normative security properties and invariants are listed in [docs/security-properties.md](docs/security-properties.md); the design-time threat model is [docs/threat-model.md](docs/threat-model.md).

## Patch policy

- Contracts are **immutable — no proxies, no upgrades**. A contract-level fix ships as a new factory version; existing curves keep running (sells can never be paused, and no pause authority exists post-graduation). Operational mitigations are limited to `pauseCreates`/`pauseBuys` on the current factory.
- Off-chain services (indexer/API/web) are patched and redeployed on the normal release path; critical fixes go out immediately.

## Bug bounty

A public bug bounty is **planned, not yet live** — the security program requires it to be live before protocol caps lift (spec §10, gate 8). Terms (scope, rewards, platform) are not yet decided; this file will be updated when they are. Until then, use the disclosure channel above.

## Audits

Completed security reviews are indexed in [audits/README.md](audits/README.md). Note the program's own disclosure (spec §10, gate 10): as of today there is **no external firm audit**; assurance rests on the layered gate program (static analysis, fuzz/invariant suites, fork tests, mutation testing, multi-model audit, economic red-team, hard-capped beta) — and the caps-lift decision gate explicitly reconsiders commissioning an external review.
