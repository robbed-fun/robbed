# ROBBED_ — System Architecture

**Status:** Current — describes the shipped / ratified state (post-redesign, creator-fee generation). Entry-point overview for the whole system. Root authority: the [root README](../../README.md) + these developer docs; hard rules distilled in `CLAUDE.md`; ratified cross-component rulings in [design-decisions.md](design-decisions.md); per-service designs in the sibling docs. When this overview disagrees with a service doc, the service doc wins for that service's internals.

ROBBED_ is a pump.fun-style token launchpad on **Robinhood Chain** (chain ID 4663, Arbitrum Orbit L2, ETH gas, ~100ms blocks, single FCFS sequencer). The product wins on **perceived speed**: bonding-curve tokens are tradeable in well under a second (sequencer inclusion — tracked internally as the `soft_confirmed` tier, but no longer surfaced as a user-facing chip), graduating to Uniswap V3 (1% tier) — "LP principal permanently locked; trading fees claimable by treasury" (the canonical LP sentence). Differentiators vs the incumbent: perceived speed, anti-rug transparency (Top Holders table + on-chain metadata commitment), and a tight **four-page** product — Discover `/`, Token Detail `/t/[address]`, Create `/create`, Portfolio `/portfolio`.

---

## 1. System context

```mermaid
flowchart LR
    subgraph chain["Robinhood Chain (4663)"]
        RTR[Router] --> CF[CurveFactory]
        CF -.deploys.-> LT[LaunchToken]
        CF -.deploys.-> BC[BondingCurve]
        BC --> MIG[V3Migrator]
        MIG --> POOL[Uniswap V3 pool 1%]
        MIG --> VAULT[LPFeeVault]
        VAULT --> SAFE[Treasury Safe]
        VAULT --> CV[CreatorVault]
    end

    WALLET[User wallet] -->|createToken / buy / sell| RTR
    WALLET -->|graduate permissionless| BC
    WALLET -->|collect permissionless| VAULT
    WALLET -.->|post-grad swaps| POOL

    subgraph offchain["Off-chain"]
        PONDER[Ponder indexer<br/>apps/indexer] --> PG[(Postgres + pg_trgm)]
        PONDER --> REDIS[(Redis pub/sub)]
        REDIS --> WS[Bun WS fanout<br/>apps/api/src/ws.ts]
        API[Hono API<br/>apps/api] --> PG
        API --> R2[(Cloudflare R2 + CDN)]
        API --> REDIS
        KEEPER[Auto-graduation keeper<br/>apps/keeper] --> PG
    end

    RPC[Alchemy RPC WS/HTTP] --> PONDER
    RPC -->|GraduationReady sub| KEEPER
    KEEPER -->|graduate permissionless| BC
    chain --- RPC

    subgraph fe["Frontend"]
        WEB[Next.js 16 + React 19 on Bun<br/>apps/web]
    end

    WEB -->|REST| API
    WEB -->|subscribe| WS
    WEB -->|live reads + txs via viem/wagmi| RPC
    WEB --> WALLET

    SHARED[packages/shared<br/>types · canonicalizer · channels · constants] -.imported by.-> PONDER
    SHARED -.-> API
    SHARED -.-> WEB
```

## 2. Services

Per-service prose is intentionally thin here — each service's internals are owned by its `developers/*.md`; this section keeps only the system-wide role + pointer.

### Contracts (`contracts/`) — [contracts.md](contracts.md)

Seven immutable Solidity contracts (no proxies, one exact compiler pin, OZ v5, MIT) — `LaunchToken`, `CurveFactory`, `BondingCurve`, `Router` (granular `pauseCreates`/`pauseBuys`; **sells can never be paused**), `V3Migrator`, `LPFeeVault`, `CreatorVault`. Drives M1 (security gates 1–4); the creator-fee generation lands at M4. See contracts.md for the per-contract design.

### Indexer (`apps/indexer`) — [indexer.md](indexer.md)

Ponder over the on-chain event families → Postgres (+`pg_trgm`): the single source of derived truth — venue-continuous candles, `Transfer`-sourced holder balances, confirmation-state watermarks (`soft_confirmed → posted_to_l1 → finalized`), metadata-hash verification, ETH/USD snapshots, creator-fee accrual — with a Redis publish per handler and zero hot-path reads. Drives M2. See indexer.md for the handlers + schema.

### API + WS (`apps/api`) — [api.md](api.md)

Hono on Bun, two processes: HTTP (read endpoints over indexer tables, `pg_trgm` search, API-mediated R2 image upload, server-side metadata canonicalization clients re-verify, moderation gating *listing only*, SIWE admin, per-token OG image rendering) and the Bun WS fanout (Redis → sockets). **No chain writes, ever.** Drives M2. See api.md for the endpoint + WS contracts.

### Keeper (`apps/keeper`) — [runbooks/keeper.md](runbooks/keeper.md)

Small Bun service that makes graduation **automatic** and keeps permissionless fee housekeeping moving. `graduate()` is permissionless with a caller reward that offsets its gas — the keeper is the standing caller so a curve does not sit locked in `ReadyToGraduate` waiting for an altruist. It watches the on-chain `GraduationReady` event over the same Alchemy WS RPC (a topic-filtered `eth_subscribe` across all curves — the authoritative, fewest-hops source) and fires `graduate(curve)` within ~1–2 blocks; a periodic Postgres sweep is the fallback that catches WS drops and downtime. Every attempt re-reads on-chain `phase()` before sending (idempotent — never two in-flight txs per curve; "already graduated by someone else" is a success); gas is `estimate × 2` capped at 30M (graduation mints a V3 position); a persistent revert while the curve stays `ready` is flagged as the donation-brick signature with a cooldown so it never hot-loops. The same service also reads `BondingCurve.accruedFees()` and calls permissionless `sweepFees()` to send treasury ETH-leg fees to the factory's live treasury Safe once a curve reaches 0.5 ETH or once per day for smaller nonzero balances. It holds **no privileged role** and adds **zero new authority** — a convenience/liveness aid, not a trust dependency. ON by default in dev/testnet; **profile-gated OFF on mainnet** until Gate G-A.

### Web (`apps/web`) — [web.md](web.md)

Next.js 16 + React 19 (exact majors, no ranges) App Router on Bun; **four pages** — Discover `/`, Token Detail `/t/[address]`, Create `/create`, Portfolio `/portfolio` (read-only, no new tx types). wagmi v2 + viem + RainbowKit (chain 4663), TanStack Query patched by one multiplexed WS, `lightweight-charts` venue-continuous candles, Top Holders table, optimistic trade lifecycle reconciled to indexed truth, dark-only. The token page keeps one minimal LP-copy line (copy-lint-enforced) — the standalone Trust panel / safety strip was retired. Drives M3. See web.md for the trade lifecycle and confirmation surfacing.

### Shared contracts (`packages/shared`)

Not a service — the interface layer all three consume (see section 4).

## 3. End-to-end data flows

### 3.1 Token launch

1. **Web:** creator fills the form; image → `POST /v1/uploads/image` (API sniffs, re-encodes, stores content-addressed on R2, returns `imageUrl` + `imageHash`).
2. **API:** `POST /v1/metadata` canonicalizes the metadata JSON (shared `canonicalizeMetadata`), keccak256-hashes it, stores `metadata/{hash}.json` on R2, returns `{ metadataHash, metadataUri }`. **Web re-computes the hash with the same shared function and refuses to sign on mismatch.**
3. **Wallet → Router:** one tx `createToken(name, symbol, metadataHash, metadataUri, minTokensOut, deadline){value: creationFee + initialBuy}`. Factory CREATE2-deploys token+curve, migrator pre-creates + initializes the V3 pool at the deterministic graduation price (pre-seed defense), optional atomic initial buy executes (anti-self-snipe; anti-sniper cap applies).
4. **Indexer:** `TokenCreated` handler writes the `tokens` row (creator + per-token `creator_fee_bps` snapshot from day 1), seeds metadata verification, publishes `launch` on `global:launches`; the verifier fetches the R2 JSON, canonicalizes, and compares hashes → metadata-verification verdict.
5. **Web:** the Create stepper advances on sequencer inclusion (<1s), redirects to `/t/[address]`, which renders from optimistic + WS data immediately.

### 3.2 Trade (pre-graduation)

1. **Web:** quote from on-chain `Router.quoteBuy/quoteSell`; user submits `Router.buy/sell` (slippage + deadline always). Sell path reads no pause flag anywhere.
2. **Curve:** both fee legs (treasury + creator) computed in-contract and **accrued** (never pushed to a recipient on the trade path — pull-payment, so neither a hostile treasury nor a hostile creator can freeze sells); graduation clamp on buys; emits `Trade(trader, …)` with **post-trade reserves + fee** — the indexer needs no RPC read.
3. **Indexer:** `trades` row (`venue='curve'`), token live-state update, balance upsert (via `Transfer`), candle upsert into all six intervals, Redis publish (`token:{addr}:trades`, `token:{addr}:candles:{interval}`, `global:trades`).
4. **WS → Web:** the optimistic row (rendered at tx-send, with **no** finality claim — the soft tier renders null since the "Soft-confirmed" chip was removed) reconciles to indexed truth by `txHash`; values are replaced, never dropped. The posted-to-L1 / finalized badges upgrade later via `global:confirmations` watermark broadcasts. Budget: event-to-browser <500ms.

### 3.3 Graduation

1. Final buy is clamped to land net reserves exactly on `GRADUATION_ETH` (excess refunded); curve enters `ReadyToGraduate` — both directions locked (deterministic state, not a pause; UI shows a two-sided "Graduating…" interstitial).
2. Anyone calls `graduate()` (caller reward) — in practice the **auto-graduation keeper** (`apps/keeper`) fires it within ~1–2 blocks of `GraduationReady`, but the path stays fully permissionless (any caller wins the reward). Migrator: graduation fee → treasury; wraps ETH; reads `slot0`; **arbs a polluted pool back to the target tick from curve inventory** (bounded; reverts `PoolPriceUnrecoverable` rather than hostile-mint — curve stays retriable); mints the full-range V3 position **to LPFeeVault** and registers `tokenId → creator`; token dust → `0xdEaD`, WETH dust → treasury; emits `Graduated`.
3. **Indexer:** `graduations` row; token flips `graduated`; the pool is registered as a Ponder child source (V3 `Swap` indexing starts now — pre-grad pool activity is never in the price series); publishes `graduated`.
4. **Web:** status pill flips, TradeWidget silently re-engines to Uniswap V3 (QuoterV2 + SwapRouter02), chart continues as **one series** — the pool was initialized at the curve's terminal price, so there is no economic or visual seam. Post-graduation no ROBBED_ contract has any pause authority.

### 3.4 Fee collection

1. Anyone calls `LPFeeVault.collect(tokenId)` (ops cron, the keeper, or an altruist); the vault harvests both V3 fee legs to itself, then **splits each 50/50** — the treasury half pushed to the fixed treasury Safe, the creator half pushed to the `CreatorVault` (credited to the registered creator). Principal mathematically cannot leave — `collect()` never touches liquidity.
2. **Indexer:** V3 `Collect` + the vault's split events (filtered to vault-held `lp_token_id`s) → `fee_collections`; alerts if the treasury recipient ≠ treasury.
3. **API/Web:** `GET /v1/tokens/:address/fees` = collected (indexed) + uncollected (live `tokensOwed` RPC read, cached 60s) — the treasury/creator accrual dashboard.

## 4. Cross-service contracts — who owns what

| Contract surface | Owner (authoritative doc) | Consumers |
|---|---|---|
| Event ABIs (`TokenCreated`, `Trade`, `Graduated`, `GraduationReady`, `FeesSwept`, `CreatorFeesSwept`, `PoolInitialized`, `FeesCollected`, `FeesSplit`) — canonical shapes | robbed-contracts — contracts.md section 2 | indexer (handlers), shared `events.ts`, web (receipt parsing) |
| On-chain view surface (`quoteBuy/quoteSell`, `reserves`, `phase`, factory config getters) | robbed-contracts — contracts.md section 2.3/section 2.4 | web live reads (holder table + TradeWidget), API fees endpoint |
| Postgres table shapes | robbed-indexer — indexer.md section 3 | API (read-only role), shared `db-rows.ts` |
| WS channel taxonomy + message schemas | robbed-indexer — indexer.md section 8.1/section 8.2 | WS fanout (api), web; types in shared `channels.ts`/`ws-messages.ts` |
| REST endpoint paths + DTOs (`/v1/...`) | robbed-indexer (API doc) — api.md section 3 | web; types in shared `api-types.ts` |
| Metadata canonicalization (`canonicalizeMetadata`, `metadataHash`) + golden fixtures | `packages/shared` `metadata.ts` — **single implementation**, api.md section 5 | API (hash at publish), web (pre-sign verify), indexer (verify vs chain) |
| Confirmation vocabulary `soft_confirmed \| posted_to_l1 \| finalized` | shared `confirmation.ts` (read-derivation, D-48c) | all three |
| Constants (chain 4663, WETH, LP sentence, intervals, size caps) | shared `constants.ts` | all three |
| Full read-function ABIs → `packages/shared/src/abi/*.json` — **compilation-time** codegen (`forge build`, no deploy) | robbed-contracts → shared codegen, contracts.md section 7.4 | indexer (`curveDefaults()` startup read — replaces env-interim), web live reads (never hand-written) |
| Deploy artifacts → generated **addresses** — **deploy-time** codegen (needs a broadcast) | robbed-contracts → shared codegen | indexer config, web `lib/addresses.ts` (never hand-edited) |

Change protocol for any row above: the owning doc changes first, consuming agents review, architect signs off — in the docs **before** code (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## 5. Confirmation states — cross-cutting

Three tiers: **soft-confirmed** (sequencer inclusion, sub-second — tracked internally; no longer surfaced as a user-facing chip), **posted-to-L1** (batch posted), **finalized** (L1 finality). The tier *machinery* is unchanged by the redesign — the indexer still tracks all three. Implementation chain:

- `block.number` is banned on-chain (L1 estimate on Orbit); off-chain we store the L2 block number from logs, which is the real sequence.
- The indexer tracker polls the RPC `safe`/`finalized` tags (~5s) and maintains a `confirmation_watermarks` singleton; a row's tier is **read-derived** at query time from `block_number` vs the watermarks via the single shared `stateForBlock` rule (no per-row write-back — monotonic by construction).
- Propagation is O(1): one `confirmations` message on `global:confirmations` per watermark advance; clients upgrade held events locally. REST returns the derived `confirmation_state`; every event-derived DTO carries `confirmationState`.
- Web surfaces the posted-to-L1 and finalized tiers only (the soft tier renders null — a fresh trade makes no finality claim); large-value trades (≥1 ETH) disclose the tier more prominently. See web.md for the confirmation surfacing.

## 6. Infra topology

| Component | Role | Notes |
|---|---|---|
| Robinhood Chain RPC (Alchemy WS + HTTP) | Ponder realtime sync + backfill; web live reads + tx submission; keeper `GraduationReady` sub | WS push is the first hop of the <500ms budget |
| Postgres (+`pg_trgm`) | Indexed truth + search; Ponder-managed tables + offchain tables (watermarks, eth-usd, metadata-verifications, moderation) | API has read-only role on indexer tables, read-write only on moderation tables |
| Redis | Pub/sub (indexer → WS fanout), per-channel `seq` counters, rate limiting, moderation job queue | No polling layers anywhere chain→browser |
| Cloudflare R2 + CDN | Content-addressed images (`images/{keccak}.webp`), canonical metadata (`metadata/{hash}.json`), rendered OG cards (`og/{address}/{version}.png`); bucket `robbed-assets`, account `0b1b0b8753489a11d35ee922961f6b72` | R2 is mutable; the on-chain hash is the commitment; indexer re-verifies |
| Treasury | Gnosis Safe (verify/deploy canonical on 4663 — open O-6) | Receives all fees; owner of CurveFactory via Ownable2Step; can never touch live curves or the vault |
| Hosting — **backend** | Postgres (+`pg_trgm`), Redis, Ponder indexer (Node container), Hono/Bun API + Bun WS fanout, keeper — one **docker-compose stack** (`docker-compose.{testnet,mainnet}.yml`) exposed via a **Cloudflare Tunnel** (`cloudflared` service) | Long-running stateful processes; **WS fanout stays co-located** so the Redis→socket hop keeps the <500ms budget. Runbook: [runbooks/docker.md](runbooks/docker.md) + [runbooks/deploy.md](runbooks/deploy.md) |
| Hosting — **frontend** | Next.js 16 SSR on **Cloudflare Workers** via the OpenNext adapter (`nodejs_compat`) — **not** Pages-edge; R2 bound for assets | OG rendering lives entirely in `apps/api` (native satori + resvg), so `apps/web` ships no raster backend — the workerd no-N-API constraint is satisfied by relocation |
| Monitoring (gate 7) | Prometheus-style metrics + alerts: head lag, publish latency, confirmation stalls, invariant violations (double-graduation, fee > cap, collect recipient ≠ treasury), funding-cluster dominance | Mandatory during capped beta |

## 7. Milestone map

| M | Milestone | Driving doc(s) | Gate coverage |
|---|---|---|---|
| M0 | Parameter notebook → `tools/m0/constants.json` (curve constants, graduation tick/sqrtPrice, anti-sniper values, arb-back numbers, caller reward) | contracts.md section 4 (consumer contract + schema) | — |
| M1 | Contracts + testnet deploy | contracts.md (all) | Gates 1–4 |
| M2 | Indexer + API + WS | indexer.md, api.md | Gate-7 metric hooks built in |
| M3 | Frontend (4 pages + Top Holders table vs testnet) | web.md | — |
| M4 | Creator-fee factory generation + LLM audit register + red-team + **capped beta** (mainnet, caps live) + bounty | contracts.md section 2.6/section 2.7, indexer.md | Gates 5–8 |
| M5 | Caps lift (Safe executes `setCaps(max,max)`) | contracts.md section 7.2 | Gate 9 decision executed; gate 10 published |
| M6 | Platform expansion (ERC-4337, livestreams) | future mini-specs | — |

Cross-milestone handoffs: M0→M1 = `constants.json` (schema in contracts.md section 4, consistency-asserted by the deploy script); M1→M2 = deploy artifacts + canonical ABIs into `packages/shared`; M2→M3 = ratified REST/WS contracts in `packages/shared`; M4→M5 = gate-9 explicit decision. Project framing and Gate G-A are in [design-decisions.md](design-decisions.md#project-framing--gono-go-gates).
