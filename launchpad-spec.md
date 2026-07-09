# SPEC — Pump.fun-Style Launchpad on Robinhood Chain

**Codename:** `hoodpad` (working title, TBD)
**Status:** Specification v1.2 — incorporates external review + on-chain reconnaissance 2026-07-09 — no implementation
**Stack:** TypeScript + Bun · Solidity (pinned, §6.7) + Foundry + OpenZeppelin v5

**v1.2 changelog (addendum 2026-07-09, no architecture change):** adds §2.2 on-chain adversary profile (observed bot-fleet + gas-funder-farm activity; binding organic-flow discount ≤50%, day-1-users-are-bots, product-correct-under-bot-dominant-flow); §3 amended (hood.fun = mainnet incumbent, bot-operator trader cohort); §5.2 Trust panel gains organic metrics; §8.5 indexer bot/farm heuristics; §10 gates 6/7/10 parameterized against observed patterns; §11 M2/M3 scope adds + **M1 hard timebox** (V3Migrator fuzz/invariant by end of week 1 of M1 else documented V2+burn fallback the same day); §14 two-phase project framing + **Gate G-A** mainnet go/no-go; §13 open-items amended (legal → blocking at G-A; organic-volume floor + cluster thresholds → M0; weekly hood.fun snapshot). §12 decisions unchanged.

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

### 2.2 On-chain adversary profile (new, v1.2)

Documented, observed activity on mainnet as of 2026-07-09 (source: manual tx-level analysis; re-verify at M2 with own indexer, §8.5):

| Pattern | Observation | Implication |
|---|---|---|
| Sniper/arb executor | Unverified proxy contract (`0x65050a…`) accounting for ~⅓ of sampled swaps; atomically pulls WETH from multiple pools in the same second; invoked by dozens of EOAs | Professional bot operation with shared execution infra is live on-chain. Anti-sniper guard (§6.5) faces a real, deployed adversary — not a theoretical one |
| Gas-funder farm | EOA (`0x1887FA…`, ~1084 ETH) drip-funding ~0.0004 ETH to fresh addresses every 1–2 min | Multi-wallet fleets (hundreds+) exist and are pre-funded. Per-wallet early-buy caps WILL be bypassed via wallet rotation; guard blunts single-tx sweeps only (already acknowledged in §6.5 — now confirmed empirically) |
| Programmatic flow share | >50% of sampled swaps have `sender ≠ recipient` (contract-mediated execution) | A majority of visible "trading" is programmatic. Chain-level activity metrics (DAW, volume, holder counts) are inflated and MUST NOT be used for revenue projections without an organic-flow discount |

**Consequences (binding planning assumptions):**
1. All market-sizing and revenue estimates in any planning doc carry an explicit **organic-flow discount** (default: assume **≤50% of headline DEX volume is organic** until own indexer data says otherwise).
2. **Day-1 users of the platform are assumed to be bots.** Product must be **correct and profitable under bot-dominant flow** (fee capture is actor-agnostic — the pull-payment curve fee §12.25 accrues regardless of who trades) while protecting human UX (creator atomic buy §5.3, early-buy caps §6.5).
3. Gate 6 (economic red-team, §10) simulations are parameterized against the observed patterns above: multi-wallet sniping from a shared funder, same-second multi-pool exits, wash-loop volume.

## 3. Competitive Landscape

| Player | Model | Threat |
|---|---|---|
| **hood.fun** (**mainnet 2026-07-09**) | Curve → Uniswap V3 1% → permanent LP lock (per their PR) | **Incumbent, not "same-day peer" (v1.2).** Same venue mechanics we adopt. Differentiation = UX speed, trust transparency (incl. organic-flow metrics §5.2/§8.5), later creator fees. **Standing task:** weekly snapshot of hood.fun traction (tokens created/day, graduation count, visible volume) via own indexer or Dune — feeds Gate G-A (§14) |
| **Pump.fun cross-chain** | Routes SOL trades into existing Robinhood Chain tokens; no native creation | Captures flow, validates demand |
| **Bot operators** (v1.2) | Shared-infra sniper/arb executors + gas-funder farms (§2.2) | Not a competitor for creators, but the dominant **trader** cohort near-term. They generate real curve fee revenue **and** degrade human trader experience. Neutral-to-positive for revenue, negative for retention; addressed via Trust panel (§5.2) — organic-flow transparency, not futile suppression |
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
- **Trust panel (new, first-class):** ownerless token ✓ · fixed 1B supply ✓ · live curve reserves (ETH/token, read on-chain) · graduation threshold + progress · LP destination: **"LP principal permanently locked; trading fees claimable by treasury."** (the canonical sentence, §12.14 — explanatory sub-copy may mention the immutable vault, but the quoted string is the one constant) · fee policy (1% curve fee → treasury) · metadata content hash vs on-chain commitment (§8.3)
- **Organic-flow metrics (new, v1.2 — sourced entirely from own indexer §8.5, no new on-chain surface):**
  - **Organic holder estimate** — % of holders NOT flagged by bot heuristics (§8.5), with a methodology tooltip; displayed as a **range**, never false precision
  - **Flow quality** — share of curve volume from flagged clusters over trailing 24h
  - **Funding-cluster flag on the holder list** — top-20 holders sharing a gas-funding source are visually grouped
  Rationale: on a chain where >50% of flow is programmatic (§2.2), "how many holders are real" is a question no competitor (pump.fun, hood.fun) answers — cheapest available differentiation, reusing infrastructure (Ponder → Postgres) that exists anyway
- Live trade feed (soft-confirmed badge), holder distribution (top 20; creator/curve/vault flagged)
- Token info, Blockscout links, creator profile
- SSR + per-token OG image (chart snapshot + mcap + progress) — the viral share unit

### 5.3 Launch Flow (`/launch`)
- Form: name, ticker ≤10, description ≤500, image required (≤4MB, re-encoded), optional links
- Image uploaded **through the API** (MIME sniff + re-encode before storage, §8.4), stored to R2 — presign lives on the API→R2 leg only (§12.19); metadata JSON server-canonicalized, client re-verifies the hash before signing → `keccak256` hash emitted on-chain in `TokenCreated` (§8.3)
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
- Virtual-reserve constant product (Gnad math, hardened): buy `tokensOut = virtualToken − k/(virtualEth + ethIn)`; sell inverse; 1% ETH-leg fee **accrued in-contract** (never pushed to treasury on any trade path — withdrawn by the permissionless pull-payment `sweepFees()`, §12.25) before curve math
- Only Router may call
- Graduation trigger: **net-of-fee** `realEthReserves` reaches `GRADUATION_ETH` (§12.11 — the final buy is clamped to land exactly on the threshold, excess refunded) → curve locks **both buys and sells** (a deterministic, permissionlessly-exitable protocol state, not a pause — §12.12); permissionless `graduate()` (small caller reward) invokes V3Migrator

### 6.3 Graduation — Option B: Uniswap V3 (1% tier) + locked fee vault
1. Deduct flat graduation fee → treasury (Safe)
2. **Pool lifecycle & pre-seed defense:** the token/WETH **V3 pool (1% tier) is created and initialized at token-creation time** at the deterministic graduation price. At graduation, migrator reads `slot0`; if price was polluted (donations/swaps into the near-empty pool), the migrator **arbs price back to target using curve inventory before minting** (bounded loop, reverts if unachievable within tolerance) — never mints into a hostile ratio. Fuzz/invariant tests must cover donation, sync-style, and swap griefing on the pre-graduation pool.
3. Mint **full-range V3 position** with `LP_TOKEN_TRANCHE` + raised ETH (as WETH), amount-mins enforced
4. LP NFT transferred to **LPFeeVault**: immutable, no owner, no `withdraw`; sole external function `collect(tokenId)` sends accrued fees to a fixed treasury address set at deploy. Principal mathematically cannot leave.
5. Residual **token** dust → `0x…dEaD` ("burned"; LaunchToken has no burn fn); residual **WETH** dust → treasury (§12.13); `Graduated` emitted
**Fallback (documented, not default):** V2 + LP burn (original Option A) if V3 migrator complexity threatens timeline — with copy switched back to "LP burned forever," since burn and fee capture are mutually exclusive claims.

### 6.4 Economics (pump.fun parity, ETH-denominated)
Factory constants, tuned at deploy via parameter notebook (M0); existing curves immutable.

| Parameter | Target | Note |
|---|---|---|
| Total supply | 1,000,000,000 | fixed |
| Sold on curve | ~793.1M (79.31%) | pump.fun ratio |
| LP tranche | ~206.9M (20.69%) | minted to V3 at graduation |
| Graduation mcap | ≈ $69k equivalent | ETH figure computed at deploy — no hardcoded ETH/USD in spec |
| Trade fee | 1% ETH leg, both directions → treasury via pull-payment `sweepFees` (§12.25) | hard cap in code: ≤2% |
| Creation fee | ~$1–2 equivalent flat → treasury | spam resistance |
| Graduation fee | **small flat, cost-based** (≈ V3-migration gas + thin margin) → treasury | exact number computed at M1 vs real testnet gas; carried as formula/placeholder in M0 constants, never a hardcoded USD figure — NOT a %-of-raise (§12.26) |
| Post-graduation revenue | **V3 1% pool fees on our LP, claimable via LPFeeVault → treasury** | new in v1.1 |
| Creator reward | 0 in v1 | `creatorFeeBps` slot exists, no code path (§7) |

### 6.5 Router.sol
- `createToken(meta, metadataHash, minTokensOut) payable` (atomic create+buy), `buy`, `sell` (+permit variant); slippage + deadline on all; fees computed in-contract; `nonReentrant`, CEI
- **Anti-sniper guard (§12.18):** early-window per-tx buy cap using a **`block.timestamp` window** (deployment-constant seconds; e.g. first 5–10s post-create) — **never `block.number`** (L1 estimate on Orbit) and, per the §12.18 ruling, not `arbBlockNumber` either. Cap = `MAX_EARLY_BUY` ETH; blunts single-tx sweeps under FCFS, acknowledged bypassable via multi-wallet. A decaying + size-based early-buy-fee redesign is deferred to pre-caps-lift (§12.27); v1 ships this fixed mechanism
- **Granular pause flags (replaces single Pausable):**
  - `pauseCreates` — stop new launches
  - `pauseBuys` — stop curve buys
  - **sells always open** — no flag exists that can block curve sells (exit is a right, not a permission). This is a **no-pause-authority** guarantee: the deterministic `ReadyToGraduate` lock pending `graduate()` is not a pause (§12.12); and because fees accrue in-contract and are swept by `sweepFees()` (no trade path pushes ETH to the treasury), a hostile/reverting treasury cannot freeze sells either (§12.25)
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
├─ Hono on Bun ── R2 uploads (API-mediated, §12.19), moderation queue, search API
├─ Postgres (+pg_trgm) · Redis (pub/sub → WS fanout)
└─ Cloudflare R2 + CDN ── images + canonical metadata JSON
```

- **Ponder** indexes **six event families** (§12.15–16): `TokenCreated(…, metadataHash, metadataUri)`, `Trade` (carries post-trade reserves + fee), `Graduated`, LaunchToken `Transfer` (sole source of holder-balance truth), plus **V3 `Swap`/`Collect`** on graduated pools (venue-continuous candles; treasury fee accrual dashboard). Candle rollups 1s·15s·1m·5m·15m·1h (§12.17).
- **Confirmation-state labels:** indexer records soft-confirmed → posted-to-L1 → finalized per event (§2.1); UI badges where relevant.
- WebSocket: Redis pub/sub → Bun WS; per-token + global channels; target <500ms event-to-browser via Alchemy WS RPC.

### 8.3 Metadata integrity (new)
R2 URLs are mutable; the chain commitment is not. Canonical metadata JSON is canonicalized (stable key order) → `keccak256` → emitted in `TokenCreated` and stored in the token. Indexer verifies fetched JSON against hash; Trust panel shows match/mismatch. Image integrity: image hash included inside the metadata JSON.

### 8.4 Moderation
Upload-time MIME sniff, size caps, re-encode. Auto-moderation (CSAM hash-matching vendor + NSFW/violence classifier) gates *listing*, never chain state. Impersonation flags for top-asset and Stock Token tickers. Admin can hide listings only.

### 8.5 Bot/farm detection heuristics (new, v1.2)

Implemented in **M2** as SQL views / scheduled jobs over the existing trade + transfer tables (no new event families). Heuristics (v1, tune with data):

1. **Funder clustering:** wallets whose first inbound tx is a micro-transfer (< 0.001 ETH) from an address that funded ≥ N (default 20) other wallets in a 24h window → cluster by funder; cluster inherits a `farm` flag.
2. **Wallet age vs. action:** address executes its first-ever buy < 60s after a token's `TokenCreated` and was funded < 1h prior → `sniper` flag.
3. **Contract-mediated execution:** trade where the `tx.origin`-equivalent ≠ token recipient (Router-external executors) → `programmatic` flag. **Whitelist our own Router/contracts** (they legitimately mediate).
4. **Wash-loop detection:** address pairs/clusters with round-trip buy-sell of similar size within short windows, netting ≈ fees only → `wash` flag on volume, **excluded from "organic volume" metrics**.
5. **Same-second multi-pool exits:** recipient receiving WETH from ≥3 pools in one block → `arb/exit` flag.

Outputs: per-address flag set; per-token organic-holder % and organic-volume %; internal flow-quality dashboard + Trust-panel feed (§5.2). **All heuristics are advisory (labeling only) — never gate chain interactions**, consistent with §8.4 (moderation gates listing, never chain state). Cluster-alert thresholds for Gate 7 are set in the M0 notebook (§13).

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
6. Economic red-team on fork: sniper/sandwich/wash sims under FCFS; guard behavior verified via `arbBlockNumber`/timestamp. **(v1.2) Scenarios parameterized against the observed §2.2 patterns:** multi-wallet sniping from a shared gas-funder, same-second multi-pool exits, wash-loop volume — the multi-wallet-bypass acknowledgment (§6.5) is now empirically confirmed, so the sim quantifies its cost rather than treating it as hypothetical
7. **Capped beta (mandatory):** mainnet launch with global TVL cap and per-token caps enforced in Factory config, monitoring + alerting on invariant metrics, kill-switch = pause creates/buys only. **(v1.2) Add cluster monitoring:** alert when a single funding cluster (§8.5) exceeds X% of a token's curve volume or Y% of platform-wide volume (thresholds set in the M0 notebook, §13) — early-warning for metric distortion and coordinated dumps
8. **Public bug bounty live before caps lift** (e.g. 10% of at-risk funds, cap TBD); repo public from day 1
9. **Decision gate before caps lift:** if traction justifies it, commission a Sherlock/Code4rena-style contest or firm review at that point — budget line reserved, decision explicit, not deferred by default
10. Published known-risks doc: no-firm-audit disclosure, single-sequencer dependency, soft-confirmation semantics, centralized listing moderation. **(v1.2) Add:** "platform activity metrics may be materially influenced by automated trading; displayed organic estimates are heuristic (§8.5)."

## 11. Milestones

| # | Milestone | Contents |
|---|---|---|
| 0 | Parameter notebook | curve constants from live ETH/USD; price/mcap plots; V3 tick math for graduation price. **(v1.2)** organic-volume floor + cluster-alert thresholds (§13) |
| 1 | Contracts + gates 1–4 | incl. V3Migrator + LPFeeVault; Robinhood Chain testnet deploy. **(v1.2) Hard timebox — see below** |
| 2 | Indexer + API | Ponder, V3 events, candles, WS, confirmation states, search. **(v1.2)** §8.5 bot/farm heuristics + internal flow-quality dashboard |
| 3 | Frontend | 3 pages + Trust panel vs testnet. **(v1.2)** Trust-panel organic metrics (§5.2) |
| 4 | Gates 5–8 | LLM register, red-team, capped beta, bounty |
| 5 | Caps lift | gate-9 decision executed; OG loop tuned |
| P2 | Portfolio · creator fees · 4337 | separate specs |

**M1 hard timebox (new, v1.2).** If **V3Migrator** (incl. the pre-seed defense) does **not** pass fuzz/invariant gates by **end of week 1 of M1**, switch to the documented fallback (**V2 + LP burn**, §6.3) **the same day**. Rationale: hood.fun incumbency makes calendar time the scarcest resource; the fallback trades post-graduation fee revenue for ~1 week of schedule. **Decision is pre-made here to avoid sunk-cost drift.**

> **Reconciliation with §12 (explicit, do not re-litigate):** the fallback trigger is **migrator gate-failure within week 1**, *not* V3 availability — **§12.28 confirms Uniswap V3 is deployed on 4663**, so "V3 unavailable" is no longer a possible cause. Accepting the fallback has a stated, one-way cost: it **flips the LP copy** from the canonical "LP principal permanently locked; trading fees claimable by treasury" (§12.14) to **"LP burned forever"** (§6.3 / CLAUDE.md hard rule — the only sanctioned flip), and it **eliminates post-graduation fee revenue** (no LPFeeVault.collect stream, §6.4). The **pull-payment curve-fee escrow (§12.25) is unaffected** — it is curve-side and independent of graduation venue, so day-1 fee capture under bot-dominant flow (§2.2) survives either path.

**Pre-caps-lift roadmap (M4/M5, before caps lift):** anti-sniper redesign to a decaying + size-based early-buy fee (§12.27); §10 gates 5–10 execution; **operations runbooks** — RPC failover, Ponder schema-migration re-index strategy, Redis seq-reset heal stampede, lost-publish gap signal + poll cadence, graduate/collect cron + stuck-graduation alert, incident runbook (findings Bucket 6; sources exist today, must gain items before M4).

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
11. (2026-07-09) `GRADUATION_ETH` is **net-of-fee real curve reserves** (what actually funds the LP); M0 sizes the ~$69k-parity target from net reserves + LP tranche at the graduation price (contracts O-1)
12. (2026-07-09) `ReadyToGraduate` locks **both** buys and sells; §6.5 "sells always open" means *no pause authority* — the lock is a deterministic, permissionlessly-exitable protocol state; UI shows a "Graduating…" interstitial for both directions (contracts O-2, web-5)
13. (2026-07-09) Graduation dust: **token leg → `0x…dEaD`; WETH leg → treasury** — real ETH value is never burned (contracts O-3)
14. (2026-07-09) Canonical LP sentence, single string constant everywhere incl. the §5.2 Trust panel: **"LP principal permanently locked; trading fees claimable by treasury."** (web-8)
15. (2026-07-09) Canonical event shapes (indexer needs zero hot-path RPC reads): `TokenCreated(token, curve, creator, name, symbol, metadataHash, metadataUri, pool)` on the factory; `Trade(trader, isBuy, ethAmount gross, tokenAmount, fee, virtualEthReserves, virtualTokenReserves, realEthReserves — all post-trade)` on the curve; creator's initial buy is **not** in `TokenCreated` — derived from the first `Trade` in the same tx (indexer OI-1/OI-2, contracts O-11)
16. (2026-07-09) LaunchToken `Transfer` is the **sixth indexed event family** and the sole source of holder-balance truth; V3-leg cost basis is best-effort until Phase-2 portfolio; pre-graduation V3 pool activity is **not** indexed into the price series (curve is the sole venue until `Graduated`; gate-7 alerting covers pool griefing) (indexer OI-3/4/5)
17. (2026-07-09) Candle interval set: **1s · 15s · 1m · 5m · 15m · 1h** (indexer OI-7)
18. (2026-07-09) Anti-sniper mechanism = `block.timestamp` window (both mechanisms were spec-sanctioned; seconds are deployment-constant, block cadence is marketing); window/cap **values** from M0 (contracts O-7)
19. (2026-07-09) Image uploads are **API-mediated** (magic-byte sniff + re-encode before any byte reaches public storage; presign exists only on the API→R2 leg); metadata JSON is server-canonicalized and the client **must** re-verify the hash with the shared canonicalizer before signing (api OI-A1)
20. (2026-07-09) Confirmation upgrades propagate as O(1) **watermark broadcasts** on `global:confirmations` (clients upgrade held events locally); REST serves the materialized per-row state; no per-row fanout (indexer OI-9)
21. (2026-07-09) Moderation listing defaults: `pending_review` stays **listed**; the WS launch ticker is unmoderated in v1 (hide propagates via REST); direct `/tokens/:address` fetch of a hidden token returns it **with a hidden flag**, never a 404 — hiding is listing-only (api OI-A5/A6)
22. (2026-07-09) Discovery ranking defaults (tunable config, not consensus values): King of the Hill = `progress × ln(1+vol24h)`; trending = `vol24h × e^(−age/24h)`; search = trgm similarity with ticker boost ×1.2, volume tiebreak, floor 0.25 (api OI-A2/A3)
23. (2026-07-09) v1 scope defaults: no WS replay buffer (REST-heal on reconnect); server-side image-hash verification deferred (hash carried in metadata JSON, client-verifiable); UI is dark-**only**; impersonation watchlist = curated, source-cited, dated data file refreshed ≥ monthly (indexer OI-10/12, api OI-A9, web-9)
24. (2026-07-09) Frontend component library = **shadcn/ui** (design not ready; library must be trivially re-themeable): Tailwind-native (already the §9 stack), components are **vendored into `apps/web/components/ui/` via the CLI** (owned code, no runtime component dependency), Radix primitives under the hood, RSC/Next-15-compatible, dark-first. Theming is **exclusively via CSS custom-property design tokens** (`globals.css` `@theme`); the future design lands by swapping token values + selective component restyles. Rule: **no component may carry bespoke styling that bypasses the token system** (no raw color values outside the token file; lint-enforced, web.md §7/§8.3). Alternatives rejected: raw Radix (same result, more assembly — shadcn *is* Radix wrapped), HeroUI (runtime dep, less ownable), Mantine (parallel styling system alongside Tailwind). (web-12)
25. (2026-07-09) **Curve fee escrow = pull-payment.** `BondingCurve` never transfers ETH to the treasury on any trade path; the 1% ETH-leg fee **accrues in-contract** (`accruedFees`) and is withdrawn by a separate **permissionless `sweepFees()`** (`nonReentrant`, **not** phase-gated, never reaches curve reserves), mirroring `LPFeeVault.collect()`. This restores "sells always open" *by construction* — a hostile/reverting treasury can no longer freeze buys or sells (resolves threat-model UM-1). Solvency invariant becomes `balance ≥ realEthReserves + accruedFees`; exact-fee invariant becomes `treasuryReceipts (via sweepFees) + accruedFees == Σ computed fees`. `graduate()` transfers `balance − accruedFees` to the migrator, so accrued fees remain sweepable after graduation and the post-grad "zero value" invariant means zero LP/reserve value (unswept fees excluded, drained to 0 by `sweepFees`). The migrator's flat graduation-fee push to treasury is unchanged (graduate() is not a sell path; a reverting treasury there is the UM-2 grief surface, not a sell freeze). (findings C-1 / threat-model UM-1)
26. (2026-07-09) **Graduation fee = small flat, cost-based.** Sized to ≈ V3-migration gas + a thin margin — **not** 1.5%-of-raise. Exact number computed at M1 against real testnet gas; M0/constants carry it as a documented formula/placeholder, never a hardcoded USD figure (no "$219"). §6.4 amended. (findings U-3, graduation-fee leg)
27. (2026-07-09) **Anti-sniper: v1 mechanism frozen; redesign deferred.** v1 ships the ratified fixed `block.timestamp` window + per-tx `MAX_EARLY_BUY` cap (§12.18 mechanism; values from M0). A redesign to a **decaying + size-based early-buy fee** is a roadmap item deferred to **before caps-lift** (§11 pre-caps-lift roadmap); the M1 mechanism is unchanged. (findings U-3, anti-sniper leg)
28. (2026-07-09) **Uniswap V3 confirmed on chain 4663.** Verified addresses recorded as source of truth (also CLAUDE.md chain facts + M0 constants `external.*`): Factory `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`, NonfungiblePositionManager `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`, SwapRouter02 `0xcaf681a66d020601342297493863e78c959e5cb2`, QuoterV2 `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`. Closes O-4 / OI-13 / web-11 (V3 leg) / E-1. **Deploy-time runtime assertions remain mandatory** (`factory.feeAmountTickSpacing(10000)==200`, `NPM.factory()`/`NPM.WETH9()` checks — contracts.md §7.2). Trade fee stays **1%** (kept). Safe deployment/signer set (O-6) remains open. (findings U-4 / O-4 / E-1)
29. (2026-07-09) **Workspace manager = pnpm.** The monorepo uses pnpm workspaces (strict non-flat `node_modules`, `workspace:*` internal deps, single-version via pnpm catalogs, one `pnpm-lock.yaml`); **Bun remains the runtime and test runner** (§8/§9). The Bun→pnpm conversion of `packages/*`, root `package.json`, and lockfiles is executed by hoodpad-shared. (findings U-2)
30. (2026-07-09) **On-chain name/symbol byte limits = cross-service source of truth.** `createToken` validates `bytes(name).length ∈ [1,32]` and `bytes(symbol).length ∈ [1,10]` (contracts.md §2.2). The API, `packages/shared` zod schemas, and OpenAPI MUST validate the same **byte** limits (name ≤ 32 bytes, ticker ≤ 10 bytes — bytes, not characters), so no name/ticker that passes the API can revert at `createToken`. hoodpad-shared updates the frozen schemas (name was `≤ 64 chars`). (findings X-1)
31. (2026-07-09) **Metadata JSON `version` frozen at `1` inside the hash preimage.** The canonical metadata object carries `version: 1` for v1; it is part of the canonicalized bytes that produce `metadataHash`, so it is committed on-chain. Bumping `version` is a future, explicit decision (new preimage ⇒ new hash). (findings X-13, metadata-version leg)

## 13. Open Items
- Name/domain/brand (blocks OG brand mark, header, domain)
- Uniswap V3 addresses on 4663 **RESOLVED (§12.28)** — Factory/NPM/SwapRouter02/QuoterV2 recorded; deploy-time runtime assertions remain mandatory (contracts O-4 closed, indexer OI-13 closed, web-11 V3 leg closed). **Still open:** Safe deployment + signer set on 4663 (O-6) — pull canonical Safe from official registry or deploy; never invented; startup/deploy must fail if unset
- Confirm compiler pin (candidate 0.8.35) against Blockscout verifier before first M1 deploy (contracts O-5)
- M0 notebook outputs: final curve constants + V3 graduation tick/sqrtPrice; anti-sniper window+cap values (O-7); arb-back `TOLERANCE_TICKS`/`MAX_ARB_ITERATIONS`/`MIGRATION_SLIPPAGE_BPS` (O-8 — budget rule ratified: arb spend may only consume inventory above what the target-price mint requires; numbers pending); graduation caller reward (O-9)
- Beta cap values `perTokenEthCap`/`globalEthCap` — set with hoodpad-security before mainnet beta deploy (O-10, gate 7)
- Large-value confirmation-disclosure threshold (ETH notional, config value) — needed before M3 exit (web-10)
- Moderation vendor (CSAM hash-match + NSFW classifier, incl. mandated-reporting legal flow, api OI-A7); bounty terms; Safe signer set (M-of-N, who — O-6); admin SIWE allowlist (follows signer set, api OI-A8)
- ETH/USD snapshot source on 4663 (Chainlink feed existence — check at M2 start; else DefiLlama/Coinbase, config-driven) (indexer OI-6)
- Robinhood RPC `safe`/`finalized` block-tag support (M2 day 1; fallback = L1 rollup-contract watermarks) (indexer OI-8)
- Robinhood Chain **testnet parameters** (chain ID, RPC, Blockscout URL, faucet) — pull from official Robinhood docs at testnet-deploy start (implementation-plan Phase T); never invented; deploy fails if unset (owner: hoodpad-contracts)
- Ponder external-write tolerance for `confirmation_state` materialization vs sidecar table — check against pinned Ponder version at M2 (indexer OI-11)
- M3-start runtime checks: WalletConnect projectId + Robinhood Wallet connector on 4663; `next/og`/satori under Bun self-hosting; Multicall3 presence on 4663 (web-6/7)
- **Legal wrapper / ToS jurisdiction for the frontend — (v1.2) becomes BLOCKING at Gate G-A (§14)** (MiCA/JDG consultation with a workable path required before Phase B); until G-A it is not blocking (Phase A is testnet-only, no fees collected)
- **(v1.2) Organic-volume floor + funding-cluster alert thresholds** (§2.2, §8.5, §10 gate 7) — define in the M0 notebook (owner: hoodpad-contracts computes → architect records)
- **(v1.2) Weekly hood.fun traction snapshot** (tokens created/day, graduation count, visible volume) — feeds Gate G-A (§14); owner: indexer job once M2 lands, manual/Dune until then

## 14. Project framing & go/no-go gates (new, v1.2)

Explicit framing to resolve the business-vs-portfolio ambiguity. The project runs in **two phases with a decision gate between them.**

**Phase A — Portfolio-grade testnet build (committed, timeboxed).**
Scope: **M0 → M3 fully on Robinhood Chain testnet**, public repo from day 1, plus one technical write-up (candidate topic: bot-fleet analysis on a week-old L2 — data already in hand, extended by §8.5 output). Hard timebox: **3 weeks of part-time effort**; primary occupation (contract search) retains priority. **No legal work required in Phase A** (no mainnet, no fees collected).
Exit artifacts regardless of the Phase B decision: verified contracts + invariant suite, live indexer with bot-detection, 3-page frontend, write-up. **These stand alone as portfolio value.**

**Gate G-A — mainnet go/no-go (end of Phase A, ~3 weeks out).** Proceed to Phase B only if **ALL** hold:
1. **Market:** Robinhood Chain memecoin activity has not collapsed (organic-volume estimate from **own indexer**, not headline metrics; define floor in M0 notebook, §13).
2. **Competition:** hood.fun has not consolidated the niche (e.g., still < order-of-magnitude ahead on daily token creations, or visibly failing).
3. **Personal:** B2B contract situation resolved or on a clear path — mainnet operation does not compete with income security.
4. **Legal:** MiCA/JDG consultation completed with a workable path (legal wrapper / ToS jurisdiction, §13) — this item moves from "open" to **blocking** at this gate.

**Phase B — capped mainnet launch (conditional).** Only after G-A passes: M4 (gates 5–8), capped beta, bounty, then M5 per v1.1. **If G-A fails:** the repository is archived as a portfolio artifact, the write-up is published, loss = zero beyond the timeboxed effort.

**Relationship to the implementation-plan Goal:** the plan's Goal ("production-ready, not production-launched" — the full stack on testnet, mainnet explicitly out of goal) **is exactly Phase A**. §14 does not expand the Goal; it names the Phase-A/Gate-G-A/Phase-B structure the Goal already implied and makes the mainnet decision explicit and conditional. Nothing before G-A depends on a G-A input.
