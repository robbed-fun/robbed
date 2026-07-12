# ROBBED_

**Launch, trade, and graduate memecoins on Robinhood Chain** — a pump.fun-style launchpad where sells can never be paused, graduation to Uniswap V3 is permissionless, and LP principal permanently locked; trading fees claimable by treasury.

**Live:** [robbed.fun](https://robbed.fun) · **Testnet:** [testnet.robbed.fun](https://testnet.robbed.fun) · **Explorer:** [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)

## What it is

ROBBED_ runs on **Robinhood Chain** (chain ID 4663, an Arbitrum Orbit L2 — ETH gas, ~100ms blocks, single FCFS sequencer):

- **One-transaction token creation** — fixed 1B supply, ownerless ERC-20, metadata committed on-chain via `metadataHash`, optional atomic initial buy.
- **Bonding-curve trading** with soft-confirmed (~100ms) UX and explicit confirmation tiers surfaced everywhere: soft-confirmed → posted-to-L1 → finalized.
- **Sells are always open.** No flag, pause, or code path can ever block curve sells; the only pause switches are `pauseCreates`/`pauseBuys`, and no pause authority of any kind exists post-graduation. Trade fees accrue in-contract and are withdrawn by a permissionless `sweepFees()` — a hostile treasury cannot freeze trading.
- **Permissionless graduation** into a Uniswap V3 1% full-range position. The pool is created and initialized at token creation at the deterministic graduation price; the migrator arbs any polluted price back before minting (never a hostile-ratio mint). The LP NFT goes into an immutable `LPFeeVault` — no owner, no withdraw, sole function `collect()` paying accrued fees to the treasury Safe.
- **Immutable contracts, no proxies.** One exact compiler pin, OpenZeppelin v5, treasury = Gnosis Safe, everything verified on Blockscout. MIT-licensed, repo public from day 1.

## Architecture

```
wallet ──txs──▶ Router ─▶ CurveFactory ─▶ LaunchToken + BondingCurve ─▶ V3Migrator ─▶ V3 pool + LPFeeVault ─▶ Treasury Safe
                                                │ events
                                                ▼
                       Ponder indexer ─▶ Postgres (+pg_trgm) ─▶ Hono API (REST)
                                └──▶ Redis pub/sub ─▶ Bun WS fanout ─▶ Next.js frontend
```

Full system overview: [docs/architecture.md](docs/architecture.md). Normative protocol spec: [docs/spec.md](docs/spec.md).

## Monorepo map

| Path | What | Stack |
|---|---|---|
| `contracts/` | LaunchToken, CurveFactory, BondingCurve, Router, V3Migrator, LPFeeVault | Solidity + Foundry + OZ v5 |
| `apps/indexer` | Event indexing, candles, holder balances, confirmation watermarks | Ponder → Postgres + Redis |
| `apps/api` | REST + WS fanout, search, API-mediated uploads, moderation | Hono on Bun |
| `apps/web` | Discover / Token Detail / Create / Portfolio | Next.js 16 + React 19, wagmi v2 + viem |
| `packages/shared` | Every cross-service type, schema, ABI, constant — defined once (Zod-first) | TypeScript |
| `tools/` | M0 parameter notebook, local stack, deploy tooling | Bun scripts |
| `docs/` | Protocol documentation (spec, how-it-works, runbooks) | — |
| `audits/` | Security reviews and their findings | — |

Dependency management is **pnpm workspaces** (strict node_modules, `workspace:*`, catalogs); **Bun is the runtime and test runner**.

## Build & test quickstart

```bash
pnpm install                      # workspace deps (one lockfile: pnpm-lock.yaml)
cd contracts && forge build && forge test   # unit + fuzz + invariant suites
bun test                          # TS unit tests (run per package)
bun run validate                  # the full local CI mirror (scripts/validate.sh)
bun run dev:stack                 # one-command local stack (anvil fork + services)
bun run e2e:coverage              # static user-flow coverage gate
```

Prerequisites: Bun ≥ 1.3, pnpm ≥ 10, Foundry (`foundryup`), Docker (for the local stack). See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow and the non-negotiable protocol rules.

## Documentation

- [docs/spec.md](docs/spec.md) — the protocol specification (single source of truth)
- [docs/how-it-works/](docs/how-it-works) — per-component design docs: [contracts](docs/how-it-works/contracts.md), [indexer](docs/how-it-works/indexer.md), [api](docs/how-it-works/api.md), [web](docs/how-it-works/web.md)
- [docs/security-properties.md](docs/security-properties.md) — protocol invariants + the security-gate program
- [docs/threat-model.md](docs/threat-model.md) — design-time threat model
- [docs/runbooks/](docs/runbooks) — operational procedures (docker, testnet, deploy, environments)
- [audits/](audits) — security reviews ([SECURITY.md](SECURITY.md) for disclosure)
- [docs/README.md](docs/README.md) — how this documentation is organized

## Security

See [SECURITY.md](SECURITY.md). The security program (10 gates, capped beta mandatory before caps lift) is summarized in [docs/security-properties.md](docs/security-properties.md).

## License

[MIT](https://opensource.org/licenses/MIT). All contracts are verified on Blockscout at deploy.
