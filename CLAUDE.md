# ROBBED_ — Pump.fun-style launchpad on Robinhood Chain

Source of truth: `README.md` + the developer docs under `docs/developers/**` (and the user docs under `docs/users/**`). When code and docs disagree, the docs win; when the docs are silent or self-contradictory, never self-resolve — ask, or record the decision in the design decisions log in `docs/developers/`. Contributor process (PR flow, test tiers, validate.sh): `docs/CONTRIBUTING.md`.

This file is the map. Depth lives beside the code: **every workspace below has its own `CLAUDE.md`** (loaded when you work in that subtree), and policy lives in **`.claude/rules/`** — `spec-authority` + `no-market-metrics` are always on; `solidity-orbit` (contracts), `lp-copy` (web/shared/docs), `anti-drift` (apps/packages), and `docs-placement` (any `*.md`) load with the files they govern. Rule violations are bugs, not style — write-time enforcement is in `.claude/hooks/` (hard-rule grep + forge fmt on write, secret/destructive-command guard, touched-workspace typecheck on stop). Never create plans/trackers/status/progress md files anywhere (docs-placement rule; doc-check enforces).

## Map

| Path | What it is | Owner agent |
|---|---|---|
| `contracts/` | Solidity + Foundry + OZ v5 — LaunchToken, CurveFactory, BondingCurve, Router, V3Migrator, LPFeeVault, CreatorVault | robbed-contracts |
| `apps/web/` | Next.js 16 + React 19 App Router (FSD), wagmi v2 + viem + RainbowKit, Tailwind dark-first | robbed-frontend |
| `apps/web/e2e/` | Playwright user-flow suite on an anvil fork — real txs, wagmi mock connector | robbed-e2e |
| `apps/indexer/` | Ponder → Postgres (+pg_trgm) + Redis pub/sub → Bun WS fanout | robbed-indexer |
| `apps/api/` | Hono on Bun — API-mediated R2 uploads, moderation, search | robbed-indexer |
| `apps/keeper/` | Auto-graduation keeper — standing caller of permissionless `graduate()` | robbed-keeper |
| `packages/shared/` | THE home of cross-service types/schemas/ABIs (Zod-first) + workspace config | robbed-shared |
| `tools/` | m0 parameter notebook, deploy/Safe tooling, localstack, OG | robbed-architect |

Cross-cutting agents: **robbed-architect** (docs interpretation, decision arbitration, authoring `.claude/` assets — agents/skills/commands go through it) and **robbed-security** (security-gate sign-off; adversarial — it refutes, never fixes).

Monorepo: **pnpm workspaces** (one `pnpm-lock.yaml`, `workspace:*` internal deps, catalogs for shared lib versions); **Bun stays the runtime and test runner** (see `docs/developers/architecture.md`).

## Golden commands

- `bun run validate` — the local CI mirror (also the pre-commit hook); `bun run validate:full` adds the slow stages
- `bun run dev:d` / `dev:down` / `dev:logs` — local compose stack; `dev:testnet:*` / `dev:mainnet:*` for the other stacks; the `/stacks-up` skill brings up and probes all three
- Per-tier tests: `cd contracts && forge test` · `bun test` (per package) · `cd apps/web && bun run test` · `bun run e2e` + `bun run e2e:coverage` · `bun scripts/doc-check.ts`

## Chain facts (chain ID 4663)

- Gas token ETH; ~100ms blocks; single FCFS sequencer — priority fees do not jump the queue. Explorer: robinhoodchain.blockscout.com.
- WETH: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- Uniswap v2 Factory `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f`, v2 Router02 `0x89e5db8b5aa49aa85ac63f691524311aeb649eba`
- **Uniswap v3 confirmed on 4663** (decision recorded in the design decisions log in `docs/developers/`) — Factory `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`, NonfungiblePositionManager `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`, SwapRouter02 `0xcaf681a66d020601342297493863e78c959e5cb2`, QuoterV2 `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`. Trade fee stays 1%.
- Confirmation tiers everywhere in UX: soft-confirmed → posted-to-L1 → finalized (see `docs/developers/architecture.md`).

## Milestones & gates

M0 parameter notebook → M1 contracts + gates 1–4 → M2 indexer/API → M3 frontend → M4 gates 5–8 → M5 caps lift. All 10 security gates (documented in `docs/developers/threat-model.md`) are required before caps lift. Portfolio/creator-fees/4337 are Phase 2 — but schema tracks `creator` per token and `creatorFeeBps` (hardcoded 0) from day 1.

## MCP (`.mcp.json`, committed)

- **context7** — current library docs (the docs-first rule).
- **postgres** — Postgres MCP Pro in `--access-mode=restricted` (read-only) against the dev compose DB (host port 4432); override the URL via `ROBBED_DATABASE_URI`. Inspect real schema through it; writes go through migrations/code only. Needs `uv` installed; secrets never go in `.mcp.json`.
