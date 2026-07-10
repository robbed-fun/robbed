# ROBBED_

A Pump.fun-style token launchpad on **Robinhood Chain** (Arbitrum Orbit L2, chain ID 4663): one-transaction token creation, bonding-curve trading with soft-confirmed (~100ms block) UX and explicit confirmation tiers (soft-confirmed → posted-to-L1 → finalized), and permissionless graduation into a Uniswap V3 full-range position. LP principal permanently locked; trading fees claimable by treasury.

**Source of truth:** [`launchpad-spec.md`](launchpad-spec.md) (v1.1). Hard rules for contributors and agents: [`CLAUDE.md`](CLAUDE.md). Design docs index: [`docs/README.md`](docs/README.md).

## Repository map

| Path | What | Spec |
|---|---|---|
| `contracts/` | Solidity + Foundry: LaunchToken, CurveFactory, BondingCurve, Router, V3Migrator, LPFeeVault | §4.1, §6 |
| `apps/web/` | Next.js 15 frontend (Discover, Token Detail, Launch + Trust panel) | §5, §9 |
| `apps/indexer/` | Ponder → Postgres (+pg_trgm) + Redis pub/sub → Bun WS | §8 |
| `apps/api/` | Hono on Bun: API-mediated R2 uploads (§12.19), moderation, search | §8 |
| `packages/shared/` | Shared event/DB types and canonical constants | §8 |
| `tools/` | Milestone tooling (M0 parameter notebook → `tools/m0/constants.json`) | §11 M0 |
| `docs/` | Architecture, per-service designs, decision log | — |

## Milestones (spec §11)

| # | Milestone | Contents |
|---|---|---|
| 0 | Parameter notebook | curve constants from live ETH/USD; price/mcap plots; V3 tick math for graduation price |
| 1 | Contracts + gates 1–4 | incl. V3Migrator + LPFeeVault; Robinhood Chain testnet deploy |
| 2 | Indexer + API | Ponder, V3 events, candles, WS, confirmation states, search |
| 3 | Frontend | 3 pages + Trust panel vs testnet |
| 4 | Gates 5–8 | LLM register, red-team, capped beta, bounty |
| 5 | Caps lift | gate-9 decision executed; OG loop tuned |
| P2 | Portfolio · creator fees · 4337 | separate specs |

## Security posture

Security program per spec §10: all 10 gates must pass before beta caps lift; public bug bounty live before caps lift; **repo public from day 1**. All contracts verified on Blockscout at deploy.

## License

MIT.
