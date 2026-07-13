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

Full system overview: [docs/developers/architecture.md](docs/developers/architecture.md). Normative protocol spec: [docs/spec.md](docs/spec.md).

## Deployments

**Robinhood Chain Testnet (chain ID 46630)** — redeployed with creator fees, canary-exercised, and Blockscout-verified 2026-07-13 at deploy block **89749950**. The canonical machine-readable record is [`contracts/deployments/46630.json`](contracts/deployments/46630.json); this table is a convenience view of it. (This supersedes the earlier 2026-07-12 deployment; adding creator fees changed the bytecode, so immutable contracts were redeployed at new addresses.)

| Contract | Address (testnet explorer) |
|---|---|
| CurveFactory | [`0x7355BD34Bc12002F2bDc79A4791463d7d6D2529a`](https://explorer.testnet.chain.robinhood.com/address/0x7355BD34Bc12002F2bDc79A4791463d7d6D2529a) |
| Router | [`0x6480534B6992419535554451BBDe79B898011BA8`](https://explorer.testnet.chain.robinhood.com/address/0x6480534B6992419535554451BBDe79B898011BA8) |
| CreatorVault | [`0xE032467128A87e353b69AeDf8e97B0AA9d528eBB`](https://explorer.testnet.chain.robinhood.com/address/0xE032467128A87e353b69AeDf8e97B0AA9d528eBB) — creator-fee pull-payment escrow |
| V3Migrator | [`0x4Bc86C3fdBABbFEF82094A772bA0194e980A5567`](https://explorer.testnet.chain.robinhood.com/address/0x4Bc86C3fdBABbFEF82094A772bA0194e980A5567) |
| LPFeeVault | [`0x3B4dD3B5741EDcE6e08CE2BcbE3106035A3E8e75`](https://explorer.testnet.chain.robinhood.com/address/0x3B4dD3B5741EDcE6e08CE2BcbE3106035A3E8e75) |
| LaunchToken (canary) | [`0xFF6e101f6Ddf202F513A8f7255c61c3BAd806AB2`](https://explorer.testnet.chain.robinhood.com/address/0xFF6e101f6Ddf202F513A8f7255c61c3BAd806AB2) |
| BondingCurve (canary) | [`0x7cd37Dc905C89D970F2E6952D721F49cba284aC7`](https://explorer.testnet.chain.robinhood.com/address/0x7cd37Dc905C89D970F2E6952D721F49cba284aC7) |
| Treasury Safe | [`0x4ae5b5Ae7D2edd7A2d43054246D6aaAcAAFC1000`](https://explorer.testnet.chain.robinhood.com/address/0x4ae5b5Ae7D2edd7A2d43054246D6aaAcAAFC1000) — canonical Safe v1.4.1, 1-of-1 dev signer (**testnet only**) |

All contracts are Blockscout-verified: solc **0.8.35** + **cancun**, MIT. Testnet trade fee is **1.5%** — 1% treasury + 0.5% creator (a testnet-calibrated placeholder; mainnet re-locks against fresh economics).

Read the fine print:

- **Testnet only.** Nothing is deployed on mainnet (4663); a mainnet launch is an explicit go/no-go decision behind the spec's Gate G-A (§14), not a default next step.
- **The 1-of-1 dev-signer Safe is a testnet stand-in**, not the production treasury model — the mainnet Safe signer set (M-of-N) is a deliberately open decision (O-6).
- **Factory ownership handover is in flight:** the Ownable2Step `transferOwnership` to the Safe was initiated at deploy; it takes effect only when the Safe calls `acceptOwnership()` (testnet lifecycle run, T-4).

## Monorepo map

| Path | What | Stack |
|---|---|---|
| `contracts/` | LaunchToken, CurveFactory, BondingCurve, Router, V3Migrator, LPFeeVault | Solidity + Foundry + OZ v5 |
| `apps/indexer` | Event indexing, candles, holder balances, confirmation watermarks | Ponder → Postgres + Redis |
| `apps/api` | REST + WS fanout, search, API-mediated uploads, moderation | Hono on Bun |
| `apps/web` | Discover / Token Detail / Create / Portfolio | Next.js 16 + React 19, wagmi v2 + viem |
| `packages/shared` | Every cross-service type, schema, ABI, constant — defined once (Zod-first) | TypeScript |
| `tools/` | M0 parameter notebook, local stack, deploy tooling | Bun scripts |
| `docs/` | All project documentation — spec, users, developers, runbooks, contributing, security | — |

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

Prerequisites: Bun ≥ 1.3, pnpm ≥ 10, Foundry (`foundryup`), Docker (for the local stack). See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the full workflow and the non-negotiable protocol rules.

## Documentation

- [docs/users/overview.md](docs/users/overview.md) — **new to ROBBED_? start here** — the token lifecycle in plain language, with [token-creation](docs/users/token-creation.md), [trading](docs/users/trading.md), [fees](docs/users/fees.md), and [graduation](docs/users/graduation.md)
- [docs/spec.md](docs/spec.md) — the protocol specification (single source of truth)
- [docs/developers/](docs/developers) — technical reference: [architecture](docs/developers/architecture.md), [contracts](docs/developers/contracts.md), [indexer](docs/developers/indexer.md), [api](docs/developers/api.md), [web](docs/developers/web.md)
- [docs/developers/threat-model.md](docs/developers/threat-model.md) — design-time threat model
- [docs/developers/runbooks/](docs/developers/runbooks) — operational procedures for operators (docker, testnet, deploy, environments)
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — contributor workflow, test tiers, hard rules
- [docs/SECURITY.md](docs/SECURITY.md) — security policy & vulnerability disclosure
- [docs/README.md](docs/README.md) — how this documentation is organized

## Security

See [docs/SECURITY.md](docs/SECURITY.md). The security program (10 gates, capped beta mandatory before caps lift) is specified in [docs/spec.md](docs/spec.md) §10.

## License

[MIT](https://opensource.org/licenses/MIT). All contracts are verified on Blockscout at deploy.
