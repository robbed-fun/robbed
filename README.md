# ROBBED_

**Launch, trade, and graduate memecoins on Robinhood Chain** — a pump.fun-style launchpad where sells can never be paused, graduation to Uniswap V3 is permissionless, and LP principal permanently locked; trading fees claimable by treasury.

**Live:** [robbed.fun](https://robbed.fun) · **Testnet:** [testnet.robbed.fun](https://testnet.robbed.fun) · **Explorer:** [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)

ROBBED_ is an **AMM with soft confirmations, not an order book** — trades are reflected in the UI at sequencer speed (~100ms) but settle on an Arbitrum Orbit L2, so confirmation is surfaced in explicit tiers (below). It wins on perceived speed, anti-rug transparency, and a tight four-page product.

## What it is

ROBBED_ runs on **Robinhood Chain** (chain ID 4663, an Arbitrum Orbit L2 — ETH gas, ~100ms blocks, single FCFS sequencer):

- **One-transaction token creation** — fixed 1B supply, ownerless ERC-20, metadata committed on-chain via `metadataHash`, optional atomic initial buy.
- **Bonding-curve trading** with soft-confirmed (~100ms) UX. Confirmation is tracked in three tiers — **soft-confirmed → posted-to-L1 → finalized**; the trade UI makes no finality claim on a fresh trade and escalates the stronger tiers for large trades (≥ 1.0 ETH notional).
- **Sells are always open.** No flag, pause, or code path can ever block a curve sell; the only pause switches are `pauseCreates`/`pauseBuys`, and no pause authority of any kind exists post-graduation. Trade fees accrue in-contract and are withdrawn by a permissionless `sweepFees()` — a hostile treasury cannot freeze trading.
- **Permissionless graduation** into a Uniswap V3 1% full-range position. The pool is created and initialized at token creation at the deterministic graduation price; the migrator arbs any polluted price back before minting (never a hostile-ratio mint). The LP NFT goes into an immutable `LPFeeVault` — no owner, no withdraw, sole function `collect()`.
- **Immutable contracts, no proxies.** One exact compiler pin, OpenZeppelin v5, treasury = Gnosis Safe, everything verified on Blockscout. MIT-licensed, repo public from day 1.

## Tokenomics

Every token is a fixed **1,000,000,000** supply, 18 decimals, minted once into its bonding curve, ownerless. The current live values below are the testnet economics lock (chain 46630, 2026-07-13); ETH-pegged values are deploy-time snapshots re-derived and re-locked before mainnet, and **no USD figure is ever stored on-chain**. Numbers are sourced from `tools/m0/out/constants.json` (the committed values are canonical).

| Slice / parameter | Value | Notes |
|---|---|---|
| Sold on the bonding curve | ~793.1M — 79.31% of supply (793100000000000000000000000 wei <!-- m0:curve.curveSupplyWei -->) | constant-product virtual-reserve curve |
| Reserved for graduation liquidity | ~206.9M — 20.69% of supply (206900000000000000000000000 wei <!-- m0:curve.lpTrancheWei -->) | minted into the V3 position at graduation |
| Graduation target (net-of-fee real reserves) | 5.749693 ETH (5749693301560943464 wei <!-- m0:curve.graduationEthWei -->) | flat ETH target, tick-aligned; not a USD-mcap derivation |
| Curve trade fee → treasury | 1% of the ETH side, both directions (100 bps <!-- m0:fees.tradeFeeBps -->) | accrued in-contract, swept by `sweepFees()` |
| Curve trade fee → creator | 0.5% of the ETH side, both directions (50 bps <!-- m0:fees.creatorFeeBps -->) | additive; total curve fee 1.5%, hard-capped at 2% (200 bps) in code |
| Creation fee | ~$1–2 equivalent flat — 0.000847 ETH (847000000000000 wei <!-- m0:fees.creationFeeWei -->) | spam resistance → treasury |
| Graduation fee | small flat, cost-based (≈ migration gas + thin margin) — 0.000225 ETH (225000000000000 wei <!-- m0:fees.graduationFeeWei -->) | **not** a %-of-raise → treasury |
| Graduation caller reward | ~$5 equivalent flat — 0.002824 ETH (2824000000000000 wei <!-- m0:fees.callerRewardWei -->) | paid to whoever calls `graduate()` |
| Anti-sniper early window | 8 seconds (8 <!-- m0:antiSniper.windowSeconds -->) | per-tx buy cap of 0.143742 ETH (143742000000000000 wei <!-- m0:antiSniper.maxEarlyBuyWei -->), = 2.5% of the graduation target |
| Post-graduation venue | Uniswap V3, 1% fee tier (10000 <!-- m0:v3.feeTier -->) | full-range LP; principal permanently locked |

The graduation target is a **flat net-of-fee ETH raise** (set ETH-to-ETH against the incumbent's ~5.74 ETH graduation bar, a user-provided benchmark of 2026-07-13), not a USD market-cap figure — the goal is more/faster graduations. See the [decision record](docs/developers/design-decisions.md#curve-graduation--fee-mechanics).

## How you earn on fees

ROBBED_ pays out through three fee streams. Two of them are claimable, and one — the creator fee — is how the launchpad pays **you**.

- **Creator fee (the built-in way to earn as a creator).** Launch a token and you earn a cut of **every** curve trade on it — currently **0.5%** of the ETH side, symmetric on buys *and* sells, additive to the 1% treasury fee and hard-capped at 2% total in code. It accrues automatically inside the curve; a permissionless `sweepCreatorFees()` moves it into the pull-payment **`CreatorVault`**, and `CreatorVault.claim()` pays it out — but the ETH can **only ever** reach the creator address that earned it. Because it accrues in-contract and is never pushed on a trade path, a broken or hostile creator address can at worst revert its own claim; it can never freeze anyone's sell. **After graduation the creator keeps earning:** the graduated V3 pool's 1% trading fees are split 50/50 treasury/creator at `collect()` and the creator's half is routed to the `CreatorVault` — so a creator earns 0.5% of their token's volume on the curve *and* on Uniswap, one continuous rate with no discontinuity at graduation. On mainnet the creator rate is decided at **0.5%** and re-locked against fresh economics before deploy.
- **Treasury fee (protocol revenue).** The 1% curve trade fee accrues in-contract and is withdrawn to the treasury Gnosis Safe by the permissionless `sweepFees()` — anyone can trigger it, in any phase, and it never touches curve reserves or blocks a trade. Post-graduation the treasury takes its 50% half of the V3 pool's 1% fees via the vault.
- **The LP fee vault (permanent liquidity, claimable fees).** At graduation the raised ETH and the reserved token tranche become a full-range Uniswap V3 position whose ownership NFT is held forever by the immutable `LPFeeVault` — no owner, no withdraw, sole external function `collect()`. **LP principal permanently locked; trading fees claimable by treasury** — nobody, including the protocol, can ever pull the principal back out; only the accrued trading fees are claimable (split 50/50 treasury/creator in the creator-fee generation), never "burned".

**The graduation reward is not a reliable earning path for you.** `graduate()` is permissionless and pays a small flat reward, but a platform keeper bot auto-fires it within a block or two, so in normal operation the keeper collects it. The reliable way a user earns is by launching a token and collecting its creator fees. Full breakdown: [docs/users/fees.md](docs/users/fees.md).

Trading itself is **speculation, not yield** — no staking, no airdrop, no dividend; the price is set purely by trading and the curve math rounds a hair in the protocol's favor. Most launchpad tokens go to zero.

## Chain facts (chain ID 4663)

- **Type:** permissionless Arbitrum Orbit L2, optimistic rollup settling to Ethereum. Gas token ETH; ~100ms target block time; a single Robinhood-operated **FCFS sequencer — priority fees do not jump the queue** (sniping is a latency race, not a gas auction). Explorer: [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com).
- **`block.number` is forbidden in contract logic** — it returns an L1 estimate on Orbit. Block-based logic uses `ArbSys(address(100)).arbBlockNumber()` or `block.timestamp`.
- **WETH:** `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`.
- **Uniswap V3 (confirmed on 4663):** Factory `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`, NonfungiblePositionManager `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`, SwapRouter02 `0xcaf681a66d020601342297493863e78c959e5cb2`, QuoterV2 `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`. Deploy-time runtime assertions are mandatory (`feeAmountTickSpacing(10000)==200`, `NPM.factory()`, `NPM.WETH9()`) — a wrong address fails closed.
- **Chainlink ETH/USD** feed confirmed on 4663 (mainnet-only; testnet/local use an HTTP fallback with source + timestamp).

Market metrics (TVL, prices, ETH/USD, volumes) are **never hardcoded** in copy or code — they are cited with source + timestamp or queried live.

## Architecture

```
wallet ──txs──▶ Router ─▶ CurveFactory ─▶ LaunchToken + BondingCurve ─▶ V3Migrator ─▶ V3 pool + LPFeeVault ─▶ Treasury Safe / CreatorVault
                                                │ events
                                                ▼
                       Ponder indexer ─▶ Postgres (+pg_trgm) ─▶ Hono API (REST)
                                └──▶ Redis pub/sub ─▶ Bun WS fanout ─▶ Next.js frontend
```

Full system overview: [docs/developers/architecture.md](docs/developers/architecture.md).

## Deployments

**Robinhood Chain Testnet (chain ID 46630)** — redeployed with creator fees, canary-exercised, and Blockscout-verified 2026-07-13 at deploy block **89749950**. The canonical machine-readable record is [`contracts/deployments/46630.json`](contracts/deployments/46630.json); this table is a convenience view of it. (Adding creator fees changed the bytecode, so the immutable contracts were redeployed at new addresses.)

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

All contracts are Blockscout-verified: solc **0.8.35** + **cancun**, MIT. Testnet curve trade fee is **1.5%** — 1% treasury + 0.5% creator (a testnet-calibrated placeholder; mainnet re-locks against fresh economics).

Read the fine print:

- **Testnet only.** Nothing is deployed on mainnet (4663); a mainnet launch is an explicit go/no-go decision behind **Gate G-A** ([project framing](docs/developers/design-decisions.md#project-framing--gono-go-gates)), not a default next step.
- **The 1-of-1 dev-signer Safe is a testnet stand-in**, not the production treasury model — the mainnet Safe signer set (M-of-N) is a deliberately open decision ([O-6](docs/developers/design-decisions.md#open-items)).
- **Factory ownership handover is in flight:** the Ownable2Step `transferOwnership` to the Safe was initiated at deploy; it takes effect only when the Safe calls `acceptOwnership()`.

## Monorepo map

| Path | What | Stack |
|---|---|---|
| `contracts/` | LaunchToken, CurveFactory, BondingCurve, Router, V3Migrator, LPFeeVault, CreatorVault | Solidity + Foundry + OZ v5 |
| `apps/indexer` | Event indexing, candles, holder balances, confirmation watermarks | Ponder → Postgres + Redis |
| `apps/api` | REST + WS fanout, search, API-mediated uploads, moderation, OG images | Hono on Bun |
| `apps/keeper` | Auto-graduation keeper — standing caller of permissionless `graduate()` | Bun + viem |
| `apps/web` | Discover / Token Detail / Create / Portfolio | Next.js 16 + React 19, wagmi v2 + viem |
| `packages/shared` | Every cross-service type, schema, ABI, constant — defined once (Zod-first) | TypeScript |
| `tools/` | M0 parameter notebook, local stack, deploy tooling | Bun scripts |
| `docs/` | All project documentation — users, developers, runbooks, contributing, security | — |

Dependency management is **pnpm workspaces** (strict node_modules, `workspace:*`, catalogs); **Bun is the runtime and test runner**.

## Build & test quickstart

```bash
pnpm install                      # workspace deps (one lockfile: pnpm-lock.yaml)
cd contracts && forge build && forge test   # unit + fuzz + invariant suites
bun test                          # TS unit tests (run per package)
bun run validate                  # the full local CI mirror (scripts/validate.sh)
bun run dev:d                     # one-command local stack (anvil fork + services)
bun run e2e:coverage              # static user-flow coverage gate
```

Prerequisites: Bun ≥ 1.3, pnpm ≥ 10, Foundry (`foundryup`), Docker (for the local stack). See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the full workflow and the non-negotiable protocol rules.

## Documentation

- [docs/users/overview.md](docs/users/overview.md) — **new to ROBBED_? start here** — the token lifecycle in plain language, with [token-creation](docs/users/token-creation.md), [trading](docs/users/trading.md), [fees](docs/users/fees.md), and [graduation](docs/users/graduation.md)
- [docs/developers/](docs/developers) — technical reference: [architecture](docs/developers/architecture.md), [contracts](docs/developers/contracts.md), [indexer](docs/developers/indexer.md), [api](docs/developers/api.md), [web](docs/developers/web.md)
- [docs/developers/design-decisions.md](docs/developers/design-decisions.md) — the binding decision record, open items, and Gate-G-A framing
- [docs/developers/threat-model.md](docs/developers/threat-model.md) — design-time threat model
- [docs/developers/runbooks/](docs/developers/runbooks) — operational procedures for operators (docker, testnet, deploy, environments, keeper, treasury Safe)
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — contributor workflow, test tiers, hard rules
- [docs/SECURITY.md](docs/SECURITY.md) — security policy & vulnerability disclosure
- [docs/README.md](docs/README.md) — how this documentation is organized

## Security

See [docs/SECURITY.md](docs/SECURITY.md). The security program — 10 gates, with a hard-capped beta mandatory before caps lift — is specified in [docs/developers/threat-model.md](docs/developers/threat-model.md).

## License

[MIT](https://opensource.org/licenses/MIT). All contracts are verified on Blockscout at deploy.
