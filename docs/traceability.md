# hoodpad — Requirements Traceability Matrix

**Generated:** 2026-07-09 · **Sources:** `launchpad-spec.md` v1.1 · `docs/services/{contracts,indexer,api,web}.md` v1.0 · `docs/implementation-plan.md` v1.0 · `docs/architecture.md` · `docs/development-flow.md`
**Maintained by:** `/trace` (`.claude/commands/trace.md`). Derived view — if this matrix disagrees with the spec, service docs, or the plan, they win and this file gets fixed (development-flow.md §1). Gaps found here are routed to hoodpad-architect, never patched around.

## Legend

| Mark | Meaning |
|---|---|
| FULL | Requirement is designed in a service doc, built by a plan item, and has a concrete verification (plan Verify command, named test file/suite, e2e scenario, or CI job) |
| PARTIAL | Chain is incomplete — column notes say exactly what is missing (e.g. designed but no plan item; built but verification only implicit) |
| DEFERRED | Intentionally outside the plan's Goal (M4/M5 per implementation-plan "Explicitly OUT"); must gain plan items before caps lift |
| DOC-ONLY | Requirement is satisfied by documentation itself (contingency/disclosure text); nothing to build |
| OPEN-§13 | Blocked on a spec §13 open item / NEEDS-USER decision; tracked, never invented |

Column key: **Design** = service-doc section(s) that design the requirement · **Build** = implementation-plan item(s) · **Verify** = the verification contract (plan Verify command, test file, e2e flow, or CI job).

---

## §2.1 Confirmation semantics (product-wide)

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-2.1-1 | Three explicit states (soft-confirmed → posted-to-L1 → finalized) tracked by the indexer per event (§2.1) | indexer.md §3.8, §5; shared `confirmation.ts` (api.md §5) | M2-1, M2-6 | `bun test apps/indexer` confirmation-transition suite (monotonicity, boundary, reorg) | FULL |
| R-2.1-2 | Trading UX runs on soft-confirmed; UI badges tiers where it matters, never renders soft-confirmed as final (§2.1) | web.md §4, §4.2; api.md §2 (`confirmationState` on every event DTO) | M2-9, M3-7 | `badge.test.tsx`, `trade-reducer.test.ts`; e2e "Buy pre-grad, optimistic→reconcile" (web.md §8.2) | FULL |
| R-2.1-3 | Large-value displays disclose posted/finalized tiers (§2.1) | web.md §4.2; threshold value = web-10 (§13) | M3-10 (architect decides + records) | spec §12 entry + config key present in web + api (M3-10 Verify) | PARTIAL — threshold value OPEN-§13 (web-10); disclosure UI designed, number pending |
| R-2.1-4 | Bridge/withdrawal flows disclose tiers (2)/(3) (§2.1) | none — the three-page product contains no bridge/withdrawal flow (web.md §1: exactly three pages) | none | n/a | PARTIAL — vacuously satisfied but no doc records the N/A; see orphan A-2 |

## §5.1 Discover (`/`)

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-5.1-1 | King of the Hill hero — closest to graduation, volume-weighted (§5.1, formula §12.22) | api.md §3.4 (`/v1/tokens/king-of-the-hill`); web.md §3.1 | M2-9, M3-4 | `bun test apps/api` snapshots; `bun test apps/web`; flow-catalog e2e (G-5b) | FULL |
| R-5.1-2 | Live launch ticker via WebSocket (§5.1) | indexer.md §8.1 (`global:launches`); web.md §3.1 | M2-8, M3-4 | `bun test apps/api` WS suite; e2e "WS reconnect" (web.md §8.2) | FULL |
| R-5.1-3 | Token grid: 5 sorts (trending/newest/mcap/volume24h/progress), 3 filters (pregrad/graduated/all) (§5.1) | api.md §3.4 (`GET /v1/tokens`); web.md §3.1 | M2-9, M3-4 | api.md §10 DoD "all five sorts + three filters"; `bun test apps/api` + `apps/web` | FULL |
| R-5.1-4 | Search over name, ticker, contract, creator via `pg_trgm` (§5.1, ranking §12.22) | api.md §3.3; indexer.md §3.1 (GIN trgm indexes); web.md §3.1 | **no dedicated plan item** — M2-9 transcribes api.md §3.4–3.5 only; M2-4 covers only the pg_trgm startup assertion | api.md §8 search-builder units + §10 DoD (caught only by M2 exit criteria) | PARTIAL — designed + verifiable, but no plan item claims the search endpoint (orphan A-1) |
| R-5.1-5 | Card: image, name, ticker, mcap, progress bar, 24h Δ%, creator, age (§5.1) | api.md §3.4 (`TokenCard`); web.md §3.1 | M2-9, M3-4 | `bun test apps/api` response snapshots vs shared types; `bun test apps/web` | FULL |

## §5.2 Token Detail (`/t/[address]`)

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-5.2-1 | Live candles 1s→1h, venue-continuous across graduation (curve + V3 `Swap` in one series) (§5.2, §12.17) | indexer.md §4 (§4.3 continuity guarantee); api.md §3.4 candles; web.md §3.2 Chart | M2-5, M2-9, M3-5 | indexer venue-continuity fixture + rebuild-equals-incremental test; e2e "Graduation venue switch" (contiguous candle timestamps) | FULL |
| R-5.2-2 | Buy/Sell widget: curve quote pre-grad, invisible V3 venue switch post-grad, slippage default 2% + deadline (§5.2) | web.md §3.2 TradeWidget; contracts.md §2.4 quote views | M1-9, M3-5 | `quotes.test.ts` vs shared vectors; e2e "Graduation venue switch"; web DoD slippage/deadline row | FULL |
| R-5.2-3 | Trust panel, first-class: all 7 items (ownerless ✓, fixed 1B ✓, live reserves, graduation progress, LP destination = canonical sentence, fee policy, metadata hash verdict) (§5.2, §12.14) | web.md §3.2 TrustPanel (exact sourcing table); api.md §3.4 `trust` payload | M2-9, M3-5 | e2e "Trust panel truth" (reserves = direct `eth_call`; mismatch fixture renders ⚠); api DoD "full Trust-panel payload (exact LP copy from constants.ts)" | FULL |
| R-5.2-4 | Live trade feed with soft-confirmed badge (§5.2, §2.1) | indexer.md §8; web.md §3.2 TradeFeed | M2-8, M3-5 | `badge.test.tsx`; e2e optimistic→reconcile scenario | FULL |
| R-5.2-5 | Holder distribution top-20; creator/curve/vault(/pool) flagged (§5.2) | indexer.md §3.6 (Transfer-driven balances); api.md §3.4 holders | M2-5, M2-9, M3-5 | indexer balance-accounting units (top-20 query shape); `bun test apps/api` | FULL |
| R-5.2-6 | Token info, Blockscout links, creator profile (§5.2) | web.md §3.2; api.md §3.4 detail (`creator: {address, tokensCreated}`) | M2-9, M3-5 | `bun test apps/web`; flow-catalog e2e (G-5b) | FULL |
| R-5.2-7 | SSR + per-token OG image (chart snapshot + mcap + progress) — the viral share unit (§5.2, §9) | web.md §6 | M3-8 | OG route unit/integration test (`image/png` 1200×630); e2e "OG image" (no-JS context) | PARTIAL — brand mark blocked on §13 name/brand (NEEDS-USER); placeholder sanctioned by plan |

## §5.3 Launch Flow (`/launch`)

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-5.3-1 | Form: name, ticker ≤10, description ≤500, image required ≤4MB re-encoded, optional links (§5.3) | api.md §3.1–3.2 (limits, zod); web.md §3.3 | M2-10, M3-6 | api zod-edge units (ticker length, desc 500, link URLs); upload hostile-fixture suite | FULL |
| R-5.3-2 | Image uploaded through the API (MIME sniff + re-encode before storage), presign only on API→R2 leg (§5.3, §12.19) | api.md §3.1, §4.2 | M2-10 | `bun test apps/api` upload suite (oversized, wrong magic bytes, EXIF, decode-bomb) | FULL |
| R-5.3-3 | Metadata JSON server-canonicalized; client re-verifies hash with shared canonicalizer before signing; keccak256 emitted in `TokenCreated` (§5.3, §8.3, §12.19) | api.md §3.2, §5 (`metadata.ts` single implementation); web.md §3.3; contracts.md §2.2/§3.1 | M2-1, M2-10, M3-6, M1-7 | shared golden-fixture hash parity (G-4: identical in all three consumers); `canonicalizer.test.ts`; forge `metadataHash` propagation unit | FULL |
| R-5.3-4 | Optional atomic initial creator buy (anti-self-snipe), subject to anti-sniper cap (§5.3) | contracts.md §2.4, §3.1 | M1-9 | `forge test --match-path '*Router*'`; flow-catalog e2e `createToken` with/without initial buy (G-5b) | FULL |
| R-5.3-5 | One tx `Router.createToken{value: fee + initialBuy}`; tradeable in <1s soft-confirmed (§5.3) | contracts.md §2.4, §3.1; web.md §3.3 stepper | M1-9, M3-6 | e2e "Launch flow" (soft-confirmed <1s → redirect → tradeable) | FULL |
| R-5.3-6 | Economics displayed plainly with exact LP sentence, never "burned" (§5.3, §12.14) | web.md §3.3 EconomicsPanel, §5 copy rules | M3-6, M3-9 | `copy-lint.test.ts` + web.md §8.3 greps (CI-blocking); e2e "Launch flow" asserts sentence verbatim | FULL |

## §6.1 LaunchToken

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-6.1-1 | OZ ERC20+Permit, 18 dec, fixed 1B minted once to curve; no mint/burn/owner/hooks/taxes/blacklist (§6.1) | contracts.md §2.1 | M1-5 | `forge test --match-path 'test/unit/LaunchToken*'`; gate-2 supply invariant | FULL |
| R-6.1-2 | Constructor stores immutable `metadataHash` commitment (§6.1, §8.3) | contracts.md §2.1 | M1-5 | LaunchToken units + `metadataHash` propagation token↔event test (contracts.md §6) | FULL |

## §6.2 BondingCurve

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-6.2-1 | Virtual-reserve constant product (hardened Gnad math); 1% ETH-leg fee to treasury before curve math, computed in-contract (§6.2, §4.1) | contracts.md §2.3 (CurveMath, fee order), §5.6 | M1-6, M1-8 | `forge test --match-path '*CurveMath*'` (k-rounding fuzz); gate-2 invariants 1 & 3 | FULL |
| R-6.2-2 | Only Router may call trade functions (§6.2) | contracts.md §2 trust topology, §2.3 (`onlyRouter`) | M1-8 | curve unit tests (NotRouter reachable/asserted, contracts.md §6 error coverage) | FULL |
| R-6.2-3 | Graduation trigger at **net-of-fee** `realEthReserves == GRADUATION_ETH`; final buy clamped, excess refunded (§6.2, §12.11) | contracts.md §2.3 graduation-boundary clamp | M1-8 | clamp boundary units (exact fill, 1-wei-over); failure-mode row §5.7 | FULL |
| R-6.2-4 | `ReadyToGraduate` locks both buys and sells — deterministic, permissionlessly-exitable state, not a pause; permissionless `graduate()` with small caller reward (§6.2, §12.12) | contracts.md §2.3 lifecycle, §3.4 | M1-8, M1-10 | gate-2 invariant 4 (single-fire + reachability); e2e "graduating-window lock" flow (G-5b) | FULL |

## §6.3 Graduation — Option B

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-6.3-1 | Flat graduation fee → treasury (Safe) first (§6.3 step 1) | contracts.md §3.4 step 2 | M1-10 | gate-2 invariant 3 (exact fee accounting incl. graduation fee) | FULL |
| R-6.3-2 | V3 pool (1%) created + initialized at token-creation at deterministic graduation price; migrator arbs polluted price back before minting (bounded, reverts if unachievable) — never a hostile-ratio mint (§6.3 step 2) | contracts.md §2.5, §3.4 steps 4–6, §5.7 | M1-10 (arb-back params from M0-3/O-8) | gate-2 invariant 6 fuzz campaign (donation, sync-style, swap, hostile concentrated liquidity); gate-3 fork pollute-then-graduate | PARTIAL — `TOLERANCE_TICKS`/`MAX_ARB_ITERATIONS`/`MIGRATION_SLIPPAGE_BPS` numbers OPEN-§13 (O-8; budget rule ratified) |
| R-6.3-3 | Mint full-range V3 position with `LP_TOKEN_TRANCHE` + raised WETH, amount-mins enforced (§6.3 step 3) | contracts.md §3.4 step 7 | M1-10 | `forge test --match-path '*Migrator*'`; gate-3 fork lifecycle | FULL |
| R-6.3-4 | LP NFT → LPFeeVault: immutable, no owner, no withdraw, sole external fn `collect(tokenId)` → fixed treasury (§6.3 step 4) | contracts.md §2.6 (full source sketch) | M1-10 | `forge test --match-path '*Vault*'` (rejects non-NPM NFTs; collect recipient constant); gate-3 fork `collect` + treasury WETH delta | FULL |
| R-6.3-5 | Residual token dust → `0x…dEaD`; residual WETH dust → treasury; `Graduated` emitted (§6.3 step 5, §12.13) | contracts.md §3.4 steps 8–10 | M1-10 | gate-2 invariant 5 (post-grad curve zero value); Migrator units | FULL |
| R-6.3-6 | Fallback (documented, not default): V2 + LP burn with copy switched back (§6.3) | spec-resident contingency only; no service doc designs it | none (adopted only by explicit architect decision) | `/spec-check` rule 5 flips copy enforcement if formally adopted | DOC-ONLY |

## §6.4 Economics

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-6.4-1 | Supply split: 1B total, ~793.1M curve, ~206.9M LP tranche — factory constants from M0, existing curves immutable (§6.4) | contracts.md §4 (constants.json schema), §2.2 config-mutability model | M0-1, M0-2, M1-7 | M0-2 validator (split sums to 1B); deploy-script consistency assertions (M1-14) | FULL |
| R-6.4-2 | Graduation mcap ≈ $69k equivalent — ETH figure computed at deploy from live ETH/USD, never hardcoded (§6.4, §2, §12.4/§12.11) | contracts.md §4; `/m0-notebook` | M0-1 | `bun run --cwd tools/m0 generate` writes cited `ethUsdSnapshot`; validator graduation-reachability assertion | FULL |
| R-6.4-3 | Trade fee 1% ETH leg both directions → treasury; hard cap ≤2% in code (§6.4) | contracts.md §2.2 (`MAX_TRADE_FEE_BPS = 200` constant), §2.3 fee math | M1-7, M1-8 | gate-2 invariant 3; factory unit (setter reverts above cap); gate-7 metric `fee > 2%` page (M2-12) | FULL |
| R-6.4-4 | Creation fee ~$1–2 flat + flat graduation fee → treasury (§6.4) | contracts.md §4 (`fees.*` + immutable ceilings) | M0-1, M1-7, M1-9 | M0-2 validator; fee-exactness invariant | FULL |
| R-6.4-5 | Post-graduation revenue: V3 1% pool fees claimable via LPFeeVault → treasury; fee accrual dashboard (§6.4) | contracts.md §3.5; indexer.md §3.5; api.md §3.4 (`/fees`) | M1-10, M2-5, M2-9 | gate-3 fork collect test; `bun test apps/api` fees endpoint | FULL |
| R-6.4-6 | Creator reward 0 in v1; `creatorFeeBps` slot exists, no code path (§6.4, §7) | contracts.md §2.2 (no setter, no fee-path read), §4 | M1-7 | factory invariant "no code path reads creatorFeeBps into a fee computation" (unit-asserted); CI grep surface | FULL |

## §6.5 Router

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-6.5-1 | `createToken`/`buy`/`sell`(+permit) single entrypoint; slippage + deadline on all; fees in-contract; `nonReentrant`, CEI (§6.5) | contracts.md §2.4, §5.4–5.6 | M1-9 | `forge test --match-path '*Router*'`; permit + deadline units; Slither/Aderyn (M1-11) | FULL |
| R-6.5-2 | Anti-sniper: early-window per-tx buy cap via `block.timestamp` window — never `block.number` (§6.5, §2, §12.18) | contracts.md §2.3 anti-sniper, §5.1–5.2 | M1-8; window/cap values M0-3 (O-7) | window-boundary units (`vm.warp` end−1 vs end); CI grep `block.number` (M1-11) | PARTIAL — mechanism designed+built; window/cap **values** OPEN-§13 (O-7, from M0) |
| R-6.5-3 | Granular pause flags: `pauseCreates`, `pauseBuys` only (§6.5) | contracts.md §2.2, §5.3 pause-model table | M1-7 | factory units; CI grep `Pausable` (M1-11) | FULL |
| R-6.5-4 | Sells always open — no flag can block curve sells; zero pause authority post-graduation (§6.5, §12.12) | contracts.md §2.4 (sell reads no pause state), §5.3 proof-by-construction; web.md §1/§3.2 (UI never gates sells) | M1-7, M1-9, M3-5 | pause-matrix forge test (sells succeed under both pauses); `sell-gating.test.tsx`; e2e "Sell while buys paused" | FULL |
| R-6.5-5 | Hard-capped admin params — fee ceilings in code (§6.5) | contracts.md §2.2 (immutable ceilings), §7.3 | M1-7 | one-time-setter + ceiling units (gate-2 additional coverage) | FULL |

## §6.6 Treasury — Safe

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-6.6-1 | Gnosis Safe as treasury; verify official deployment on 4663 or deploy canonical Safe — never bespoke (§6.6, §12.10) | contracts.md §7.2; plan T-2 | T-2 (testnet, dev signers); mainnet signer set O-6 | Safe `getOwners()` responds on testnet RPC (T-2 Verify) | PARTIAL — testnet in-goal; mainnet Safe + signer set OPEN-§13 (O-6, NEEDS-USER, M4) |
| R-6.6-2 | Bespoke Gnad FeeVault dropped; LPFeeVault ~50 lines, one function, no privileged paths (§6.6) | contracts.md §2.6 (growth justified line-by-line to hoodpad-security) | M1-10, M1-15 | vault units; hoodpad-security adversarial review (`docs/security/findings-m1.md`) | FULL |
| R-6.6-3 | Admin = `Ownable2Step` on Factory, owner = Safe; owner cannot touch live curves, token economics, or the vault (§6.6) | contracts.md §2.2, §7.3 (negative properties unit-tested) | M1-7, M1-14 (transferOwnership step 7), T-3 | Ownable2Step handover unit; admin negative-property units (gate-2 additional coverage) | FULL |

## §6.7 Compiler & verification

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-6.7-1 | Exact single compiler pin (candidate 0.8.35), confirmed against Blockscout before first deploy, whole workspace one version (§6.7, §12.9) | contracts.md §7.1 | P0-3 (pin in foundry.toml), M1-2 (O-5 confirmation) | `grep -q '0.8.35' contracts/foundry.toml`; verification GUID in `docs/runbooks/toolchain.md`; CI grep `\^0\.8` | PARTIAL — pin unverified vs Blockscout until M1-2 executes (O-5) |
| R-6.7-2 | All contracts Blockscout-verified at deploy; repo public; MIT (§6.7, §10.8) | contracts.md §7.2 step 8 | T-3; P0-6 (repo public — NEEDS-USER) | G-7 (`tools/deployments/testnet.json` GUIDs, all verified); `git remote` check (P0-6 Verify) | PARTIAL — blocked on P0-6 (GitHub remote + push consent, NEEDS-USER) |

## §7 Creator rewards (designed-in, disabled)

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-7-1 | `creatorFeeBps` field exists in fee config, hardcoded 0, no branching path; Phase 2 = new Router + CreatorVault (§7) | contracts.md §2.2, §4 | M1-7 | factory units (no setter, no fee-path read); `/spec-check` rule 16 | FULL |
| R-7-2 | Indexer/UI track `creator` per token from day 1 (§7) | indexer.md §3.1, §11 DoD; api.md §3.4 (`creator` on card/detail) | M2-4, M2-5, M2-9 | indexer DoD "`creator` + `creatorFeeBps` on every token row from first indexed event" (`bun test apps/indexer`) | FULL |

## §8 Off-chain architecture

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-8-1 | Component stack: Next.js (Bun) SSR+OG · Ponder (Node container) · Hono on Bun · Postgres+pg_trgm · Redis pub/sub→WS · R2+CDN (§8, §12.5/§12.6/§12.7) | architecture.md §1/§6; indexer.md §2; api.md §7; web.md §2 | P0-3, M2-4, M2-8, M3-2, I-1, P-3 | G-1 `dev:stack`+`dev:health`; `docker build` exits 0 (P-3) | FULL |
| R-8-2 | Ponder indexes six event families: `TokenCreated`, `Trade`, `Graduated`, `Transfer`, V3 `Swap`/`Collect` (§8, §12.15/§12.16) | indexer.md §3.1–3.6 | M2-5 (handlers), M1-3 (canonical ABIs → `events.json`) | indexer DoD "handlers for all six event families, idempotent on (tx_hash, log_index)"; `grep metadataUri packages/shared/events.json` (M1-3) | FULL |
| R-8-3 | Candle rollups 1s·15s·1m·5m·15m·1h (§8, §12.17) | indexer.md §4.1–4.4 | M2-5 | candle-math units (bucket flooring, high-water idempotency, rebuild byte-equal) | FULL |
| R-8-4 | Confirmation-state labels recorded per event; UI badges where relevant (§8, §2.1) | indexer.md §5; web.md §4.2 | M2-6, M3-7 | confirmation-transition suite; `badge.test.tsx` | FULL |
| R-8-5 | WebSocket: Redis pub/sub → Bun WS; per-token + global channels (§8) | indexer.md §8.1–8.2; api.md §6.5 (hardening) | M2-8 | `bun test apps/api` incl. no-DB-import structural test; e2e "WS reconnect" | FULL |
| R-8-6 | Target <500ms event-to-browser (§8) | indexer.md §8.3 (budget), §9.4 (`ws_publish_to_head_ms` alert p95>300ms) | M2-8 (structural), M2-12 (metric hooks) | import-graph assertion (structural only); live budget = gate-7 monitoring alert | PARTIAL — in-goal verification is structural; measured latency verified only during capped beta (M4, out of goal) |

## §8.3 Metadata integrity

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-8.3-1 | Canonical JSON (stable key order) → keccak256 → emitted in `TokenCreated` + stored in token (§8.3) | api.md §3.2, §5 (`metadata.ts`, single implementation, RFC-8785-style); contracts.md §2.1/§2.2 | M2-1, M2-10, M1-5, M1-7 | shared golden fixtures identical in api/indexer/web (G-4); forge `metadataHash` units | FULL |
| R-8.3-2 | Indexer verifies fetched JSON against on-chain hash; Trust panel shows match/mismatch (§8.3) | indexer.md §6 (never `match` without byte comparison); web.md §3.2 TrustPanel row | M2-7, M3-5 | indexer match/mismatch/unfetched suite (incl. mutation-style stub test); e2e "Trust panel truth" mismatch fixture | FULL |
| R-8.3-3 | Image integrity: image hash included inside metadata JSON (server-side verification deferred, client-verifiable) (§8.3, §12.23) | api.md §3.1 step 3 (hash of re-encoded bytes = `imageHash`) | M2-10 | upload suite (hash returned + existence check at `POST /v1/metadata`) | FULL — server-side re-verification explicitly deferred by §12.23 (not a gap) |

## §8.4 Moderation

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-8.4-1 | Upload-time MIME sniff (magic bytes), size caps, re-encode before public storage (§8.4, §12.19) | api.md §3.1, §4.2 | M2-10 | hostile-fixture upload suite | FULL |
| R-8.4-2 | Auto-moderation gates *listing* only, never chain state, never creation/trading (§8.4) | api.md §4.1, §3.6 (no chain-write endpoint exists) | M2-11 | route-inventory test proves no chain-write capability (no signer/wallet module imported) | FULL |
| R-8.4-3 | CSAM hash-matching vendor + NSFW/violence classifier (§8.4) | api.md §4.3 (vendor interfaces + stubs + prod boot guard) | M2-11 (stubs sanctioned); real vendor OI-A7 | moderation state-machine suite (csam short-circuit, fail-open, thresholds); boot-guard test | PARTIAL — vendor + mandated-reporting legal flow OPEN-§13 (OI-A7, NEEDS-USER); stubs are the sanctioned in-goal state |
| R-8.4-4 | Impersonation flags for top-asset and Stock Token tickers (§8.4, §12.23 watchlist = curated dated data file, refreshed ≥ monthly) | api.md §4.4 | M2-11 | impersonation-matcher units incl. homoglyphs; watchlist-file freshness is process (≥ monthly) with no automated check | PARTIAL — refresh cadence has no automated verification; relies on ops process |
| R-8.4-5 | Admin can hide listings only; hidden token direct-fetch returns flag, never 404; `pending_review` stays listed; WS ticker unmoderated v1 (§8.4, §12.21) | api.md §3.6, §4.5, §2 | M2-11 | moderation + SIWE suites; visibility state-machine tests | FULL |

## §10 Security program (gates)

| ID | Requirement (spec §) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-10-G1 | Gate 1 — Slither (zero unexplained) + Aderyn + solhint + CI-enforced fmt (§10.1) | contracts.md §6 gate 1, §5.1/§5.6 (CI greps) | M1-11, P0-5 | `slither --triage-database` exit 0; CI contracts+slither jobs (G-6) | FULL |
| R-10-G2 | Gate 2 — unit + fuzz + invariants: all 7 spec invariant rows (k, solvency, fee exactness, single-fire+reachable graduation, post-grad zero value, no hostile-ratio mint, no ETH extraction) (§10.2) | contracts.md §6 gate 2 (row-by-row test approaches) | M1-4 (skeletons first), M1-6, M1-8, M1-10 | `forge test` invariant suite; one test file per invariant row (M1-4 Verify); G-3 | FULL |
| R-10-G3 | Gate 3 — fork tests on live chain vs real V3 factory/NPM + real WETH `0x0Bd7…AD73` (§10.3) | contracts.md §6 gate 3 | M1-12 | `FOUNDRY_PROFILE=fork forge test` green with `ROBINHOOD_RPC` (G-3) | FULL |
| R-10-G4 | Gate 4 — mutation testing on curve + migrator math; suite kills mutants (§10.4) | contracts.md §6 gate 4 | M1-13 | `contracts/reports/mutation/` report, zero undispositioned survivors (G-3) | FULL |
| R-10-G5 | Gate 5 — multi-model LLM audit (≥3 models, findings register with dispositions) (§10.5) | spec-only (no service-doc procedure) | none — explicitly out of goal (M4) | none in-goal | DEFERRED — must gain a plan item at M4 (orphan A-5) |
| R-10-G6 | Gate 6 — economic red-team on fork: sniper/sandwich/wash sims under FCFS (§10.6) | spec-only; hoodpad-security agent charter | none — out of goal (M4) | none in-goal | DEFERRED (orphan A-5) |
| R-10-G7 | Gate 7 — capped beta: TVL caps in Factory config, monitoring + alerting on invariant metrics, kill-switch = pause creates/buys only (§10.7) | contracts.md §2.2 (`setCaps`), §5.3 kill-switch posture; indexer.md §9.4 metrics | M1-7 (cap machinery), M2-12 (metric hooks), P-3 (alert-rule configs); beta execution + cap values O-10 out of goal | `curl /metrics` named series (M2-12); cap units; beta itself unverified in-goal | PARTIAL — machinery in-goal; beta execution + cap values DEFERRED/OPEN-§13 (O-10, NEEDS-USER) |
| R-10-G8 | Gate 8 — public bug bounty live before caps lift; repo public day 1 (§10.8) | spec-only; repo-public leg = P0-6 | none for bounty (out of goal); P0-6 for repo | `git remote` check (P0-6) | DEFERRED — bounty terms NEEDS-USER (orphan A-5); repo-public leg PARTIAL on P0-6 |
| R-10-G9 | Gate 9 — explicit external-review decision before caps lift, budget reserved (§10.9) | spec-only | none — out of goal (M5) | none in-goal | DEFERRED (orphan A-5) |
| R-10-G10 | Gate 10 — published known-risks doc (no-firm-audit, single sequencer, soft-confirmation, centralized moderation) (§10.10) | spec-only; content sources exist (threat-model.md, contracts.md §5.7) | P-4 registers it in the M4/M5 handoff only — no item authors/publishes the doc | none in-goal | DEFERRED (orphan A-6) |

## §12 Resolved decisions (each decision → where it lands)

| ID | Decision (spec §12) | Design | Build | Verify | Status |
|---|---|---|---|---|---|
| R-12.1 | Graduation = V3 1% full-range, LP NFT in immutable LPFeeVault, treasury collects (V2+burn = documented fallback) | contracts.md §2.5–2.6, §3.4–3.5 | M1-10 | gate-2 inv 6; gate-3 fork lifecycle | FULL |
| R-12.2 | Wallets: classic wagmi/RainbowKit; 4337 Phase 2 (no AA code paths) | web.md §2.4, §1 | M3-3 | web DoD "no AA code paths"; connector config in build | FULL |
| R-12.3 | Fees: treasury (Safe) only; creator rewards designed-in, disabled | contracts.md §2.2, §4 | M1-7 | see R-6.4-6 / R-7-1 | FULL |
| R-12.4 | Graduation threshold ~$69k mcap parity, constants fixed at deploy | contracts.md §4 | M0-1, M0-2 | M0-2 validator | FULL |
| R-12.5 | Indexer: Ponder + Postgres + Redis | indexer.md §2, §7 | M2-4, M2-8 | indexer boots vs compose Postgres; `bun test apps/indexer` | FULL |
| R-12.6 | Frontend: Next.js on Bun, SSR + OG | web.md §1, §6 | M3-2, M3-8 | `bun run build` under Bun; OG route test | FULL |
| R-12.7 | Storage: R2 + CDN, on-chain metadata hash commitment | api.md §3.1–3.2; contracts.md §2.1 | M2-10, M1-5 | upload suite; golden-fixture parity | FULL |
| R-12.8 | Security: AI pipeline + capped beta + bounty + explicit review gate | contracts.md §6 (gates 1–4); spec §10 (5–10) | M1-4…M1-13, M1-15; gates 5–10 M4/M5 | G-3; `docs/security/findings-m1.md` | PARTIAL — see R-10-G5…G10 (deferred by design) |
| R-12.9 | Compiler: exact single pin validated vs Blockscout (candidate 0.8.35) | contracts.md §7.1 | P0-3, M1-2 | see R-6.7-1 | PARTIAL (O-5 pending) |
| R-12.10 | Treasury: Safe (verify/deploy canonical), custom multisig dropped | contracts.md §7.2; plan T-2 | T-2 | `getOwners()` on testnet | PARTIAL (mainnet O-6) |
| R-12.11 | `GRADUATION_ETH` = net-of-fee real reserves; M0 sizes from net reserves + LP tranche | contracts.md §2.3 clamp, §4 | M0-1, M1-8 | clamp boundary units; M0-2 reachability assertion | FULL |
| R-12.12 | `ReadyToGraduate` locks both directions; "sells always open" = no pause authority; two-sided "Graduating…" interstitial | contracts.md §2.3, §5.3; web.md §3.2 | M1-8, M3-5 | pause-matrix + lifecycle units; e2e graduation + graduating-window-lock flow (G-5b) | FULL |
| R-12.13 | Dust: token → `0x…dEaD`, WETH → treasury | contracts.md §3.4 steps 8–9 | M1-10 | Migrator units; invariant 5 | FULL |
| R-12.14 | Canonical LP sentence, single string constant everywhere incl. Trust panel | api.md §5 (`constants.ts`); web.md §5, §8.3 | M2-1, M3-9 | copy-lint greps (sentence outside definition file = 0; no "burned"); api DoD exact-string row | FULL |
| R-12.15 | Canonical event shapes (`TokenCreated` w/ `metadataUri`+`pool`; `Trade` gross + post-trade reserves); initial buy derived from first `Trade` | contracts.md §2.2/§2.3 events; indexer.md §3.1–3.2 | M1-3, M2-5 | `grep metadataUri packages/shared/events.json`; indexer DoD escalation rule on shape divergence | FULL |
| R-12.16 | `Transfer` = 6th family, sole balance truth; V3 cost basis best-effort; pre-grad pool activity not in price series | indexer.md §3.6, §3.4 | M2-5 | balance-accounting units; venue-continuity fixture (pre-grad swaps excluded) | FULL |
| R-12.17 | Candle intervals 1s·15s·1m·5m·15m·1h | indexer.md §4.1 | M2-5 | candle units all six intervals (indexer DoD) | FULL |
| R-12.18 | Anti-sniper = `block.timestamp` window; values from M0 | contracts.md §2.3 | M1-8, M0-3 | window-boundary units; constants.json `antiSniper.*` non-zero (M0-3 Verify) | PARTIAL (O-7 values pending M0) |
| R-12.19 | API-mediated uploads (sniff+re-encode pre-storage; presign API→R2 only); client must re-verify hash before signing | api.md §3.1–3.2; web.md §3.3 | M2-10, M3-6 | upload hostile fixtures; `canonicalizer.test.ts` parity; e2e "Launch flow" client re-verify step | FULL |
| R-12.20 | Confirmation upgrades = O(1) watermark broadcasts on `global:confirmations`; REST serves materialized state | indexer.md §5.2; api.md §3.5 | M2-6 | confirmation suite; `GET /v1/confirmations` in G-1 health + G-8 | FULL |
| R-12.21 | Moderation defaults: `pending_review` listed; WS ticker unmoderated; hidden direct-fetch = flag not 404 | api.md §2, §4.1, §4.5 | M2-11 | visibility state-machine tests | FULL |
| R-12.22 | Ranking defaults (KotH, trending, search boost/floor) as tunable config, not consensus values | api.md §3.3–3.4 | M2-9 (KotH/trending); search — see R-5.1-4 | api snapshots; formulas-as-config assertion | PARTIAL — search leg inherits the R-5.1-4 plan-item gap |
| R-12.23 | v1 scope: no WS replay (REST-heal); server image-hash verify deferred; dark-only; watchlist = dated data file | indexer.md §8.4; api.md §4.4; web.md §7 | M2-8, M2-11, M3-2 | reconnect e2e (REST-heal); dark-only in M3-2 Verify | FULL |
| R-12.24 | shadcn/ui vendored, Radix under the hood; theming exclusively via CSS custom-property tokens; no styling bypasses tokens (lint-enforced) | web.md §7, §8.3 (color-value grep) | M3-2 | token-bypass lint grep (M3-2 Verify; web.md §8.3 line 5) | FULL |

---

## Orphan table A — spec requirements with no designing doc section or no plan item (real gaps)

| # | Spec requirement | What exists | What is missing | Severity / disposition |
|---|---|---|---|---|
| A-1 | **§5.1 Search** (name/ticker/contract/creator via `pg_trgm`) | Fully designed (api.md §3.3) with tests specified (api.md §8) and DoD row (api.md §10) | **No implementation-plan item claims the search endpoint.** M2-9 transcribes api.md §3.4–3.5 only; M2-10 covers §3.1–3.2; M2-11 covers §4/§6; M2-4 only asserts the `pg_trgm` extension at startup. Coverage exists solely via the M2 exit criterion "api.md §10 DoD green" | **Gap — route to hoodpad-architect:** add search to M2-9's scope line or insert an explicit M2 item, so `/goal` has a Verify contract for it |
| A-2 | **§2.1 bridge/withdrawal flows disclose posted/finalized tiers** | web.md §4.2 covers large-value displays; the three-page product has no bridge/withdrawal flow | No doc section records that the bridge/withdrawal leg is N/A-by-scope for v1 (the spec sentence is product-wide) | Low — documentation gap; architect should record the N/A (e.g. decisions.md note) so the requirement isn't silently dropped if a bridge UI ever appears |
| A-3 | **§6.3 fallback Option A (V2 + LP burn) documented** | Spec text itself documents the fallback; `/spec-check` rule 5 anticipates the copy flip | No service-doc section or plan hook describes *how* the fallback would be adopted (trigger, owner, copy-switch checklist) | Info — acceptable for a non-default contingency; becomes a real gap only if V3 migrator timeline slips |
| A-4 | **§8 <500ms event-to-browser target** | Structural guards designed+planned (indexer.md §8.3/§9.4; M2-8 import-graph test, M2-12 metric hooks) | No in-goal verification *measures* the budget end-to-end; the p95 alert only fires during gate-7 monitoring (M4, out of goal) | Low — consider a latency assertion in the I-5b e2e harness (measured WS delivery under the local stack) as an in-goal proxy |
| A-5 | **§10 gates 5, 6, 8 (bounty leg), 9** — LLM audit, economic red-team, public bounty, external-review decision | Spec defines them; hoodpad-security agent charter covers execution; plan lists them under "Explicitly OUT of this goal" | No plan items exist at all (by declared design); no service doc designs the gate-5/6 procedures (contracts.md §6 stops at gate 4) | Deferred-by-design — **must** gain plan items + owners before M4 starts; bounty terms and gate-9 budget are NEEDS-USER (§13) |
| A-6 | **§10 gate 10 known-risks doc** (no-firm-audit, single sequencer, soft-confirmation, moderation centralization) | Content sources exist (docs/threat-model.md, contracts.md §5.7, spec §10); P-4 lists it in the M4/M5 handoff register | No item authors or publishes the doc itself; no doc section specifies its outline | Deferred-by-design — needs an authoring item at M4; cheap to draft earlier since sources are ready |
| A-7 | **§10 gate 7 capped beta execution** (mainnet with caps live, alert delivery, kill-switch drill) | Cap machinery (M1-7), metric hooks (M2-12), alert-rule config files (P-3), kill-switch posture (contracts.md §5.3) all in-goal | Beta deployment, cap **values** (O-10, NEEDS-USER/security), and alert *delivery* are out of goal with no plan items | Deferred-by-design — O-10 blocked on user; verify the P-2 runbook covers the beta-deploy variant (it does, per P-2 text) |
| A-8 | **§8.4 CSAM/NSFW vendor selection + mandated-reporting legal flow** | Vendor interfaces, stubs, boot guard designed (api.md §4.3) and built by M2-11 | Real vendor + NCMEC-class legal flow is OPEN-§13 (OI-A7, NEEDS-USER); production refuses to boot on stubs without an explicit escape hatch | Open-§13 — sanctioned for M2; blocks production moderation, surfaced in the plan's Blocked-on-user table |
| A-9 | **§6.6 mainnet Safe + signer set / ownership handover execution** | Deploy-order step 7 designed (contracts.md §7.2); P-2 documents the handover choreography; T-2 does testnet with dev signers | Mainnet signer set (M-of-N, who) is OPEN-§13 (O-6, NEEDS-USER); handover execution is M4 | Open-§13 / deferred-by-design — no in-goal action possible |

## Orphan table B — plan items tracing to no spec/service-doc requirement

| # | Plan item(s) | What it builds | Traces to | Label |
|---|---|---|---|---|
| B-1 | P0-1 | Claude Code hooks (hard-rule greps, fmt) | CLAUDE.md hard rules, development-flow §7 — enforcement tooling, not a product requirement | Process — fine |
| B-2 | P0-2, I-6 | CI pipeline + CI e2e job | development-flow §5.6–5.7 (process contract); no spec section mandates CI | Process — fine |
| B-3 | P0-5 | Toolchain install + pin record (`docs/runbooks/toolchain.md`) | Supports gate 1 (contracts.md §6) and O-5 evidence | Process — fine |
| B-4 | P0-6 | Initial commit + GitHub remote + push | Partially traces to §6.7/§10.8 "repo public"; the git/remote mechanics are process | Process (with a spec-traced leg) — fine |
| B-5 | I-1, I-2, I-3 (G-1) | One-command local stack (compose, anvil bring-up, orchestration, health script) | No spec or service-doc requirement for a local dev stack; ratified process-level in the plan's Conventions (path-ownership extension) | Process / dev-experience — fine |
| B-6 | I-4 (G-2) | Seed script: ≥3 demo tokens through the real launch path | Plan-invented demo/verification scaffolding; exercises spec flows but is not itself required by any doc | Process / verification scaffolding — fine |
| B-7 | M3-11, I-5a, G-5b | Flow catalog `docs/user-flows.md` + e2e harness + `e2e:coverage` script | Loosely traces to spec §9 "Playwright e2e on fork" and §5 flows, but the catalog artifact, `@flow:` tagging, and coverage tooling are plan-invented; **`docs/user-flows.md` becomes a new normative artifact not anchored in the spec or any service doc** | Process / verification scaffolding — fine, but architect should note the catalog's authority position in development-flow.md §1 when it lands |
| B-8 | P-1, P-2, P-4 (G-9, G-10) | Env inventory, deploy runbook, M4/M5 handoff register | Ops preparation; runbook *content* transcribes contracts.md §7.2 / indexer.md §9.4, but the runbook documents themselves are plan-invented deliverables | Process / ops — fine |
| B-9 | M2-2 | OpenAPI document `apps/api/openapi.yaml` + lint/sync check | api.md §3 defines the endpoints but nowhere requires an OpenAPI artifact | Process / interface tooling — fine |
| B-10 | P-3 (partial) | Dockerfiles + prod compose + monitoring config files | Ponder-in-a-Node-container traces to spec §8; the Dockerfile/manifest deliverables and host-agnostic packaging are plan-invented | Process (with a spec-traced leg) — fine |

---

## Row counts

| Section | Rows | FULL | PARTIAL | DEFERRED | DOC-ONLY |
|---|---|---|---|---|---|
| §2.1 | 4 | 2 | 2 | 0 | 0 |
| §5.1 | 5 | 4 | 1 | 0 | 0 |
| §5.2 | 7 | 6 | 1 | 0 | 0 |
| §5.3 | 6 | 6 | 0 | 0 | 0 |
| §6.1 | 2 | 2 | 0 | 0 | 0 |
| §6.2 | 4 | 4 | 0 | 0 | 0 |
| §6.3 | 6 | 4 | 1 | 0 | 1 |
| §6.4 | 6 | 6 | 0 | 0 | 0 |
| §6.5 | 5 | 4 | 1 | 0 | 0 |
| §6.6 | 3 | 2 | 1 | 0 | 0 |
| §6.7 | 2 | 0 | 2 | 0 | 0 |
| §7 | 2 | 2 | 0 | 0 | 0 |
| §8 | 6 | 5 | 1 | 0 | 0 |
| §8.3 | 3 | 3 | 0 | 0 | 0 |
| §8.4 | 5 | 3 | 2 | 0 | 0 |
| §10 gates | 10 | 4 | 1 | 5 | 0 |
| §12 decisions | 24 | 19 | 5 | 0 | 0 |
| **Total** | **100** | **76** | **18** | **5** | **1** |

Orphans: **A = 9** (1 actionable plan-item gap, 2 documentation gaps, 1 verification-proxy suggestion, 5 open-§13/deferred-by-design) · **B = 10** (all process-labeled, none problematic).
