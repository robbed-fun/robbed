# SPEC — Pump.fun-Style Launchpad on Robinhood Chain

> **⚠ HISTORICAL BASELINE (v1.1) — SUPERSEDED. The living source of truth is [`docs/spec.md`](docs/spec.md) (v1.2+). This file is retained for provenance only; where it disagrees with `docs/spec.md`, `docs/spec.md` wins. Do not implement from this file.** Since this snapshot, `docs/spec.md` has moved Portfolio into v1, redesigned Discover and the token-detail page, re-derived the economics, and — 2026-07-12, §12.63, user-directed via `/goal` — folded the §5.4 Phase-2 features (creator fees, comments, ERC-4337, livestreams) into product scope. The project is also renamed `ROBBED_` (§12.46); "hoodpad" below is stale.

**Codename:** `hoodpad` (working title, TBD)
**Status:** Specification v1.1 — incorporates external review 2026-07-09 — no implementation
**Stack:** TypeScript + Bun · Solidity (pinned, §6.7) + Foundry + OpenZeppelin v5

**v1.1 changelog:** graduation venue V2+burn → **V3 + locked fee vault (Option B)**; anti-sniper rewritten for ArbSys/timestamp (block.number unreliable on Orbit); pre-seeded-pool attack mitigated; pause split into granular flags; Safe replaces bespoke multisig; compiler pinned exactly; confirmation-state semantics added; Trust panel + on-chain metadata hash added; security program hardened with capped beta; volatile market metrics date-stamped or removed.

---

## 1. Thesis

Robinhood Chain launched July 1, 2026 and is in a memecoin discovery phase (CASHCAT et al., as of 2026-07-09 — treat all market metrics as snapshots, pull live from DefiLlama/Dune in any material). Pump.fun routes cross-chain flow *into* the chain but creates nothing native. One native competitor (hood.fun) launched July 9: bonding curve → Uniswap V3 1% → permanent LP lock.

The product is **soft-confirmed trading UX**: ~100ms blocks with FCFS sequencing mean a trade can be reflected in the UI in well under a second — but this is an AMM/bonding curve with soft confirmations, not a real-time order book, and the spec never claims otherwise. We win on perceived speed, trust transparency, and a tighter three-page product.

## 2. Chain Facts (verified against official docs, 2026-07-09)

| Property | Value |
|---|---|
| Type | Permissionless L2, Arbitrum (Orbit) stack, optimistic rollup settling to Ethereum |
| Chain ID | 4663 |
| Gas token | ETH |
| Block time | ~100 ms target (marketing figure; UX must still distinguish confirmation tiers, §2.1) |
| Sequencing | Single Robinhood-operated sequencer, **FCFS; priority fees do not jump the queue** (official docs) |
| `block.number` | **Returns an L1 estimate, not the L2 block count** (Orbit behavior). Use `ArbSys(0x64).arbBlockNumber()` or timestamps for any block-based logic |
| EVM tooling | Foundry, Hardhat, viem, wagmi unmodified; ERC-4337 first-class (docs-confirmed) |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (official docs) |
| Uniswap | v2, v3, v4, UniswapX live. **v2 Factory `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f`, v2 Router02 `0x89e5db8b5aa49aa85ac63f691524311aeb649eba`** (official Uniswap deployments). v3/v4 addresses: pull from official registry at implementation time |
| Explorer | Blockscout (robinhoodchain.blockscout.com) — contract verification constraints drive compiler pin (§6.7) |
| Market metrics | TVL / addresses / volume / token performance: **never hardcode in product copy or docs; cite source + timestamp or query live** |

### 2.1 Confirmation semantics (product-wide)
Three explicit states, tracked by the indexer and surfaced in UI where it matters:
1. **Soft-confirmed** — included by the sequencer (sub-second). Default UI state for trades.
2. **Posted to Ethereum** — batch posted to L1.
3. **Finalized** — L1 finality / challenge-period considerations for withdrawals.
Trading UX runs on (1); bridge/withdrawal flows and any large-value displays disclose (2)/(3).

## 3. Competitive Landscape

| Player | Model | Threat |
|---|---|---|
| **hood.fun** (2026-07-09) | Curve → Uniswap V3 1% → permanent LP lock (per their PR) | Direct competitor; same venue mechanics we now adopt. Differentiation = UX speed, trust transparency, later creator fees |
| **Pump.fun cross-chain** | Routes SOL trades into existing Robinhood Chain tokens; no native creation | Captures flow, validates demand |
| **Uniswap v2/v3/v4** | Venue, not competitor | — |

## 4. Template Analysis

Template repositories:
- Gnad.fun (primary): https://github.com/HarrierOnChain/Gnad.fun-SmartContract
- IDOFactory / TokenLocker reference: https://github.com/VitaliyShulik/launchpad
- Minimal-surface reference: https://github.com/DePayFi/depay-evm-launchpad
- (Scaffolding CLI, ignored): https://github.com/0xPolygon/dapp-launchpad

### 4.1 Gnad.fun-SmartContract — primary architecture template
**Take:** Factory → Curve → Token pattern; router as single entrypoint with slippage/deadline; virtual-reserve constant product (`k = virtualEth × virtualToken`); locked LP token tranche; custom errors; event taxonomy; Foundry test structure.
**Drop / change:**
- `WMon` → canonical WETH `0x0Bd7…AD73`
- Caller-supplied fee validated via `checkFee` → **fee computed in-contract** (griefing/footgun surface)
- V2 graduation → **V3 migrator + fee vault** (§6.3)
- Bespoke multisig FeeVault → **Safe** (§6.6)
- `UNLICENSED`, `^0.8.13` → MIT, exact pin (§6.7)
- Add OZ v5 throughout: SafeERC20, ReentrancyGuard, Ownable2Step, granular pause flags

### 4.2 DePayFi/depay-evm-launchpad — benchmark for minimal audit surface only.
### 4.3 VitaliyShulik/launchpad — `TokenLocker` pattern is reference material for the LP fee vault's "principal can never leave" property.
### 4.4 0xPolygon/dapp-launchpad — scaffolding CLI; ignore.

## 5. Product Spec — Three Pages

Dark, dense, fast. Optimistic UI reconciled by WebSocket events; every trade renders as soft-confirmed and reconciles on indexed event.

### 5.1 Discover (`/`)
- King of the Hill hero (closest to graduation, volume-weighted)
- Live launch ticker (WebSocket)
- Token grid: sorts = trending / newest / mcap / 24h volume / progress; filters = pre-grad / graduated / all
- Search: name, ticker, contract, creator (Postgres `pg_trgm`)
- Card: image, name, ticker, mcap, progress bar, 24h Δ%, creator, age

### 5.2 Token Detail (`/t/[address]`)
- Live candles (`lightweight-charts`, 1s→1h) from indexed trades; **venue-continuous** across graduation (curve trades + V3 `Swap` events in one series)
- Buy/Sell widget: curve quote pre-grad; post-grad routes to Uniswap V3 (invisible venue switch); slippage default 2%, deadline
- **Trust panel (new, first-class):** ownerless token ✓ · fixed 1B supply ✓ · live curve reserves (ETH/token, read on-chain) · graduation threshold + progress · LP destination: "principal permanently locked in immutable vault; trading fees claimable by treasury" · fee policy (1% curve fee → treasury) · metadata content hash vs on-chain commitment (§8.3)
- Live trade feed (soft-confirmed badge), holder distribution (top 20; creator/curve/vault flagged)
- Token info, Blockscout links, creator profile
- SSR + per-token OG image (chart snapshot + mcap + progress) — the viral share unit

### 5.3 Launch Flow (`/launch`)
- Form: name, ticker ≤10, description ≤500, image required (≤4MB, re-encoded), optional links
- Image → R2 presigned upload; metadata JSON canonicalized → `keccak256` hash emitted on-chain in `TokenCreated` (§8.3)
- Optional atomic initial creator buy (anti-self-snipe)
- One tx: `Router.createToken{value: deployFee + initialBuy}`; tradeable in <1s (soft-confirmed)
- Economics displayed plainly, including exact LP copy: **"LP principal permanently locked; trading fees claimable by treasury."** Never "burned."

### 5.4 Phase 2 (out of v1)
Portfolio page (schema ready day 1) · creator fee share (§7) · comments · ERC-4337 gasless · livestreams.

## 6. Smart Contract Architecture

Foundry workspace, immutable contracts (no proxies), upgrade = new factory version.

```
contracts/
├── LaunchToken.sol     // OZ ERC20 + ERC20Permit, fixed 1B, ownerless
├── CurveFactory.sol    // deploys token+curve, global config, hard caps
├── BondingCurve.sol    // virtual-reserve constant product
├── Router.sol          // create/buy/sell entrypoint, fees, guards
├── V3Migrator.sol      // graduation: pool init/verify, mint LP, send NFT to vault
├── LPFeeVault.sol      // immutable: holds LP NFTs forever, collect()-only to treasury
└── interfaces/, errors/, libs/
```

### 6.1 LaunchToken.sol
OZ ERC20 + ERC20Permit, 18 decimals, 1,000,000,000 minted once to curve in constructor. No mint/burn/owner/hooks/taxes/blacklist. Constructor stores `metadataHash` (bytes32) — immutable on-chain commitment to the canonical metadata JSON.

### 6.2 BondingCurve.sol
- Virtual-reserve constant product (Gnad math, hardened): buy `tokensOut = virtualToken − k/(virtualEth + ethIn)`; sell inverse; 1% ETH-leg fee to treasury before curve math
- Only Router may call
- Graduation trigger: `realEthReserves ≥ GRADUATION_ETH` → curve locks; permissionless `graduate()` (small caller reward) invokes V3Migrator

### 6.3 Graduation — Option B: Uniswap V3 (1% tier) + locked fee vault
1. Deduct flat graduation fee → treasury (Safe)
2. **Pool lifecycle & pre-seed defense:** the token/WETH **V3 pool (1% tier) is created and initialized at token-creation time** at the deterministic graduation price. At graduation, migrator reads `slot0`; if price was polluted (donations/swaps into the near-empty pool), the migrator **arbs price back to target using curve inventory before minting** (bounded loop, reverts if unachievable within tolerance) — never mints into a hostile ratio. Fuzz/invariant tests must cover donation, sync-style, and swap griefing on the pre-graduation pool.
3. Mint **full-range V3 position** with `LP_TOKEN_TRANCHE` + raised ETH (as WETH), amount-mins enforced
4. LP NFT transferred to **LPFeeVault**: immutable, no owner, no `withdraw`; sole external function `collect(tokenId)` sends accrued fees to a fixed treasury address set at deploy. Principal mathematically cannot leave.
5. Residual dust burned; `Graduated` emitted
**Fallback (documented, not default):** V2 + LP burn (original Option A) if V3 migrator complexity threatens timeline — with copy switched back to "LP burned forever," since burn and fee capture are mutually exclusive claims.

### 6.4 Economics (pump.fun parity, ETH-denominated)
Factory constants, tuned at deploy via parameter notebook (M0); existing curves immutable.

| Parameter | Target | Note |
|---|---|---|
| Total supply | 1,000,000,000 | fixed |
| Sold on curve | ~793.1M (79.31%) | pump.fun ratio |
| LP tranche | ~206.9M (20.69%) | minted to V3 at graduation |
| Graduation mcap | ≈ $69k equivalent | ETH figure computed at deploy — no hardcoded ETH/USD in spec |
| Trade fee | 1% ETH leg, both directions → treasury | hard cap in code: ≤2% |
| Creation fee | ~$1–2 equivalent flat → treasury | spam resistance |
| Graduation fee | flat, pump.fun-analog → treasury | |
| Post-graduation revenue | **V3 1% pool fees on our LP, claimable via LPFeeVault → treasury** | new in v1.1 |
| Creator reward | 0 in v1 | `creatorFeeBps` slot exists, no code path (§7) |

### 6.5 Router.sol
- `createToken(meta, metadataHash, minTokensOut) payable` (atomic create+buy), `buy`, `sell` (+permit variant); slippage + deadline on all; fees computed in-contract; `nonReentrant`, CEI
- **Anti-sniper guard (rewritten):** early-window per-tx buy cap using `ArbSys(address(100)).arbBlockNumber()` **or** `block.timestamp` window (e.g. first 5–10s post-create) — **never `block.number`**, which returns an L1 estimate on Orbit chains. Cap = `MAX_EARLY_BUY` ETH; blunts single-tx sweeps under FCFS, acknowledged bypassable via multi-wallet
- **Granular pause flags (replaces single Pausable):**
  - `pauseCreates` — stop new launches
  - `pauseBuys` — stop curve buys
  - **sells always open** — no flag exists that can block curve sells (exit is a right, not a permission)
  - **no pause authority of any kind post-graduation** — Uniswap is out of our control by design
- Hard-capped admin params (fee ceilings in code)

### 6.6 Treasury — Safe, not bespoke
- **Primary:** Gnosis Safe as treasury. Verify official Safe deployment on chain 4663 at implementation time; if absent, **deploy the canonical Safe contracts ourselves** (permissionlessly deployable, audited) rather than writing a custom multisig.
- Bespoke Gnad-style FeeVault: **dropped.** LPFeeVault (§6.3) remains custom but is ~50 lines with one function and no privileged paths — smallest possible novel surface.
- Admin (`Ownable2Step` on Factory/Router) = the Safe. Owner cannot touch live curves, existing token economics, or LPFeeVault.

### 6.7 Compiler & verification
- **Exact pin, single version, no ranges.** Candidate at time of writing: `0.8.35` — reviewer reports Blockscout verification failures on 0.8.36 for this chain. Confirm the pin against Robinhood Blockscout verification support at implementation start; whole workspace compiles on that one version.
- All contracts verified on Blockscout at deploy; repo public.

## 7. Creator Rewards (designed-in, disabled)
Treasury-only v1. `creatorFeeBps` field exists in fee config, hardcoded 0, no branching path. Phase 2 = new Router + pull-payment `CreatorVault`. Indexer/UI track `creator` per token from day 1.

## 8. Off-Chain Architecture

```
┌─ Next.js (App Router, Bun runtime) ── SSR + OG images (satori)
├─ Ponder (Node container) ── Factory/Curve/Router + V3 Pool events → Postgres
├─ Hono on Bun ── R2 presigned uploads, moderation queue, search API
├─ Postgres (+pg_trgm) · Redis (pub/sub → WS fanout)
└─ Cloudflare R2 + CDN ── images + canonical metadata JSON
```

- **Ponder** indexes `TokenCreated(…, metadataHash)`, `Trade`, `Graduated`, plus **V3 `Swap`/`Collect`** on graduated pools (venue-continuous candles; treasury fee accrual dashboard). Candle rollups 1s→1h.
- **Confirmation-state labels:** indexer records soft-confirmed → posted-to-L1 → finalized per event (§2.1); UI badges where relevant.
- WebSocket: Redis pub/sub → Bun WS; per-token + global channels; target <500ms event-to-browser via Alchemy WS RPC.

### 8.3 Metadata integrity (new)
R2 URLs are mutable; the chain commitment is not. Canonical metadata JSON is canonicalized (stable key order) → `keccak256` → emitted in `TokenCreated` and stored in the token. Indexer verifies fetched JSON against hash; Trust panel shows match/mismatch. Image integrity: image hash included inside the metadata JSON.

### 8.4 Moderation
Upload-time MIME sniff, size caps, re-encode. Auto-moderation (CSAM hash-matching vendor + NSFW/violence classifier) gates *listing*, never chain state. Impersonation flags for top-asset and Stock Token tickers. Admin can hide listings only.

## 9. Frontend Stack
Next.js 15 App Router on Bun · wagmi v2 + viem + RainbowKit (custom chain 4663, injected/WalletConnect/Robinhood Wallet) · TanStack Query + WS · `lightweight-charts` · Tailwind dark-first · satori OG · Playwright e2e on fork, Vitest units.

## 10. Security Program (hardened per review)

AI-assisted auditing alone is insufficient assurance for a public-funds launchpad. v1.1 posture: AI pipeline **plus** a hard-capped beta **plus** public bounty before meaningful volume, with an external checkpoint decision gate.

**Gates (all required):**
1. Static: Slither (zero unexplained), Aderyn, solhint, CI-enforced fmt
2. Foundry unit + fuzz + **invariants**: `k` non-decreasing from trades; curve solvency at any fill sequence (`balance ≥ realEthReserves`; any circulating sell payable); exact fee accounting; graduation single-fire and reachable; post-grad curve holds zero value; **pre-seeded/donated/swapped V3 pool cannot cause hostile-ratio mint**; no fuzzed actor sequence extracts ETH beyond fair curve value
3. Fork tests on live chain: full lifecycle vs real V3 factory/NPM, real WETH `0x0Bd7…AD73`
4. Mutation testing on curve + migrator math (suite must kill mutants)
5. Multi-model LLM audit (≥3 frontier models, adversarial prompts, per-contract + system pass; written findings register with dispositions)
6. Economic red-team on fork: sniper/sandwich/wash sims under FCFS; guard behavior verified via `arbBlockNumber`/timestamp
7. **Capped beta (mandatory):** mainnet launch with global TVL cap and per-token caps enforced in Factory config, monitoring + alerting on invariant metrics, kill-switch = pause creates/buys only
8. **Public bug bounty live before caps lift** (e.g. 10% of at-risk funds, cap TBD); repo public from day 1
9. **Decision gate before caps lift:** if traction justifies it, commission a Sherlock/Code4rena-style contest or firm review at that point — budget line reserved, decision explicit, not deferred by default
10. Published known-risks doc: no-firm-audit disclosure, single-sequencer dependency, soft-confirmation semantics, centralized listing moderation

## 11. Milestones

| # | Milestone | Contents |
|---|---|---|
| 0 | Parameter notebook | curve constants from live ETH/USD; price/mcap plots; V3 tick math for graduation price |
| 1 | Contracts + gates 1–4 | incl. V3Migrator + LPFeeVault; Robinhood Chain testnet deploy |
| 2 | Indexer + API | Ponder, V3 events, candles, WS, confirmation states, search |
| 3 | Frontend | 3 pages + Trust panel vs testnet |
| 4 | Gates 5–8 | LLM register, red-team, capped beta, bounty |
| 5 | Caps lift | gate-9 decision executed; OG loop tuned |
| P2 | Portfolio · creator fees · 4337 | separate specs |

## 12. Resolved Decisions

1. Graduation: **Uniswap V3 1% full-range, LP NFT in immutable LPFeeVault, treasury collects fees** (Option B — supersedes interview's V2 choice; V2+burn documented as fallback)
2. Wallets: classic wagmi/RainbowKit; 4337 phase 2
3. Fees: treasury (Safe) only; creator rewards designed-in, disabled
4. Graduation threshold: ~$69k mcap parity, constants fixed at deploy
5. Indexer: Ponder + Postgres + Redis
6. Frontend: Next.js on Bun, SSR + OG
7. Storage: R2 + CDN, on-chain metadata hash commitment
8. Security: AI pipeline + capped beta + public bounty + explicit external-review decision gate
9. Compiler: exact single pin validated against Blockscout (candidate 0.8.35)
10. Treasury: Safe (verify/deploy canonical), custom multisig dropped

## 13. Open Items
- Name/domain/brand
- Pull v3 Factory / NonfungiblePositionManager / (Safe?) addresses on 4663 from official registries
- Confirm compiler pin against Blockscout verifier
- Final curve constants + V3 graduation tick (M0 notebook)
- Moderation vendor; bounty terms; Safe signer set (M-of-N, who)
- Legal wrapper / ToS jurisdiction for the frontend
