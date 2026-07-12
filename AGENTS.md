# AGENTS

Machine-and-human-readable roster of the specialized coding agents this repo ships, for
cross-tool discovery (Cursor, Codex, Windsurf, …). The **authoritative definitions** —
full system prompts, tool grants, constraints — live in `.claude/agents/*.md`; this file
mirrors their routing descriptions and must be regenerated when they change.

Ground rules that bind every agent (full text: `CLAUDE.md` + `docs/spec.md`):
the spec is the source of truth; docs-first (consult current official library docs
before implementing — context7 MCP, fallback WebFetch); hard rules (no `block.number`
on this Orbit chain, sells always open, one exact solc pin, fees computed in-contract)
are enforced mechanically by `.claude/hooks/check-hard-rules.sh` and `scripts/validate.sh`.

## robbed-architect
Lead architect and meta-agent. Interprets the spec and arbitrates spec-vs-code
conflicts; makes/records architecture decisions; reviews deliverables for spec
compliance; authors new Claude Code assets (agents, skills, commands) for this repo.

## robbed-contracts
Solidity/Foundry engineer for `contracts/` (LaunchToken, CurveFactory, BondingCurve,
Router, V3Migrator, LPFeeVault + interfaces/errors/libs and the Foundry test suite).
Writes/modifies contract code, unit/fuzz/invariant/fork tests, deploy scripts,
foundry.toml. Not for indexer/API/frontend work or security sign-off.

## robbed-indexer
Off-chain data engineer: Ponder indexer, Postgres (+pg_trgm), Redis pub/sub, Bun WS
fanout, and the Hono API (uploads, moderation, search). Owns `apps/indexer` and
`apps/api`; consumes shared types from `packages/shared`, never redeclares them.

## robbed-frontend
Frontend engineer: Next.js App Router on Bun, Feature-Sliced Design, wagmi v2 + viem +
RainbowKit, TanStack Query, lightweight-charts, Tailwind dark-first, satori OG images.
Owns `apps/web` pages and all user-facing copy. Not for contracts/indexer/API work.

## robbed-e2e
End-to-end test engineer: owns the Playwright harness and full user-flow suite under
`apps/web/e2e/**` plus the static flow-coverage gate. Real-tx/real-signature browser
tests against an anvil fork (wagmi mock connector, no wallet-extension automation),
asserting on-chain state → indexed record → reconciled UI.

## robbed-security
Adversarial security reviewer and gate runner for the spec §10 program: runs/verifies
the security gates, audits the invariant suite, drives Slither/Aderyn/solhint and
mutation testing, red-teams economics on a fork. It refutes — it never fixes; findings
route back to robbed-contracts.

## robbed-shared
Owner of `packages/*` (shared types, ABIs, canonicalizer, extracted common logic) and
the pnpm workspace configuration. Guardian against cross-service type/logic drift:
app agents consume, never define.
