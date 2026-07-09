# hoodpad — Decision Register

**Status:** Consolidated 2026-07-09 by hoodpad-architect. This register indexes every open item / flagged interpretation raised by the four service design docs and records its disposition. The authoritative record of *decided* items is `launchpad-spec.md` §12; the authoritative list of *open* items is §13. This file is the cross-reference — if it ever disagrees with the spec, the spec wins and this file gets fixed.

Conventions:
- **DECIDED** — ratified by the architect, recorded in spec §12 (entry number given), propagated into the affected service docs.
- **OPEN** — genuinely undecided; listed in spec §13 with an owner and a latest-decision point. Implementing agents must not self-resolve these.
- **DELEGATED** — an implementation choice inside one service's lane; the owning agent decides and documents it in their service doc, no spec entry needed.

---

## 1. Contracts (`docs/services/contracts.md` §8, O-1…O-11)

| ID | Item | Disposition | Rationale / owner |
|---|---|---|---|
| O-1 | `GRADUATION_ETH` gross vs net of trade fee | **DECIDED — §12.11.** Net-of-fee real curve reserves | Net reserves are what actually funds the LP; the threshold must describe LP funding, not gross inflow. M0 sizes the mcap target from net reserves + LP tranche at graduation price. Blocks constants freeze (M0↔M1 handoff) |
| O-2 | Sells during the `ReadyToGraduate` window | **DECIDED — §12.12.** Lock both directions | §6.5 "sells always open" is a *no-pause-authority* guarantee, not a liveness guarantee for a deterministic, permissionlessly-exitable, typically same-block protocol state. Lock-both avoids threshold-oscillation games and matches pump.fun UX. Spec §6.2/§6.5 amended. Resolves web item 5 identically |
| O-3 | "Residual dust burned" — WETH leg included? | **DECIDED — §12.13.** Token dust → `0xdEaD`; WETH dust → treasury | Burning WETH destroys real ETH value for no trust benefit; "dust burned" reads as the token leg. Spec §6.3 step 5 amended |
| O-4 | V3 Factory / NPM addresses on 4663 | **RESOLVED — §12.28 (2026-07-09).** Uniswap V3 confirmed on 4663; Factory/NPM/SwapRouter02/QuoterV2 recorded in constants + CLAUDE.md; runtime assertions mandatory | Also closes indexer OI-13, web item 11 (V3 leg) and E-1 |
| O-5 | Compiler pin 0.8.35 vs Blockscout verifier | **OPEN — §13.** Owner: hoodpad-contracts verifies before first M1 deploy; architect records the final pin in §12 | Throwaway-contract verification test; if 0.8.35 fails, nearest supported exact pin chosen explicitly, never silently |
| O-6 | Safe deployment on 4663 + signer set | **OPEN — §13.** Owner: architect + ops. Canonical-Safe check at M1; signer set (M-of-N) blocks deploy step 7 only | Bespoke multisig remains forbidden (§6.6) |
| O-7 | Anti-sniper mechanism + values | **Mechanism DECIDED — §12.18:** `block.timestamp` window (deployment-constant seconds beat marketing-figure block cadence; both were spec-sanctioned). **Values OPEN — §13** (M0: window 5–10s suggested, cap sized vs `GRADUATION_ETH`) | Values land in `constants.json`, never inlined |
| O-8 | Arb-back params (`TOLERANCE_TICKS`, `MAX_ARB_ITERATIONS`, `MIGRATION_SLIPPAGE_BPS`) + inventory budget rule | **Token-leg budget rule DECIDED** (§13 note): arb spend may only consume inventory above what the target-price mint requires. **WETH-leg budget = M1 OBLIGATION on hoodpad-contracts** (the token-leg rule is undefined on the WETH side since the mint takes all WETH — threat-model §8.1; must be defined + proven in gate-2 invariant 6). **Numbers OPEN — §13** (M0) | Tolerance derived from acceptable value-skew at mint (≤0.5% suggested) |
| O-9 | Graduation caller reward value | **OPEN — §13.** Owner: M0 notebook (gas ×~10 heuristic); hard ceiling `maxCallerReward` immutable | Risk-free number, but market-dependent — never inlined |
| O-10 | Beta cap values (gate 7) | **OPEN — §13.** Owner: hoodpad-security + architect before mainnet beta deploy | Ops/risk numbers, not code; testnet placeholders fine |
| O-11 | Initial-buy size in `TokenCreated`? | **DECIDED — §12.15.** No — derived from the first `Trade` in the same tx. `TokenCreated` instead carries `metadataUri` (see OI-1) | Keeps the event minimal while satisfying the indexer |

## 2. Indexer (`docs/services/indexer.md` §10, OI-1…OI-13)

| ID | Item | Disposition | Rationale / owner |
|---|---|---|---|
| OI-1 | Exact event ABI shapes (post-trade reserves? `metadataUri`?) | **DECIDED — §12.15.** Canonical shapes fixed: `TokenCreated(token, curve, creator, name, symbol, metadataHash, metadataUri, pool)`; `Trade(trader, isBuy, ethGross, tokenAmount, fee, vE, vT, realEth — post-trade)`; `Graduated` per contracts.md §2.5. contracts.md is authoritative for ABIs; indexer.md mirrors | Indexer must need zero hot-path RPC reads (<500ms budget, §8). Contracts doc updated (metadataUri added to factory/Router signatures + event); indexer doc updated to canonical shapes |
| OI-2 | `Trade.ethAmount` gross vs net | **DECIDED — §12.15.** Gross, with `fee` as a separate field; net = gross − fee | One representation, both values derivable; matches contracts' emission point |
| OI-3 | LaunchToken `Transfer` as 6th event family | **DECIDED — §12.16.** Adopted; sole source of holder-balance truth | Only exact way to satisfy §5.2 holder distribution + §5.4 portfolio readiness. Spec §8 amended to six families |
| OI-4 | Pre-graduation V3 pool activity | **DECIDED — §12.16.** Not indexed; curve is sole venue until `Graduated`; gate-7 alerting covers pool griefing | Anomaly-swap indexing adds cost for data the product never shows |
| OI-5 | V3 per-EOA cost basis approximate (router recipients) | **DECIDED — §12.16.** Accepted; balances exact via Transfer, v3 cost basis best-effort until Phase-2 portfolio spec | Exactness where it matters (balances); precision debt documented |
| OI-6 | ETH/USD source on 4663 | **OPEN — §13.** Owner: hoodpad-indexer checks Chainlink feed existence at M2 start; config-driven either way | Shared with api OI-A10 |
| OI-7 | Candle interval set | **DECIDED — §12.17.** `1s, 15s, 1m, 5m, 15m, 1h` | Spec gave only endpoints; set covers all chart zooms; derived data, cheap to change later |
| OI-8 | `safe`/`finalized` RPC tag support | **OPEN — §13.** Owner: hoodpad-indexer, M2 day 1; fallback = L1 rollup-contract watermarks | Fallback documented in indexer.md §5.1 |
| OI-9 | Confirmation propagation: watermark broadcast vs per-row | **DECIDED — §12.20.** O(1) watermark broadcast on `global:confirmations`; clients upgrade locally; REST serves the materialized column | Per-row fanout is O(rows) for zero added information |
| OI-10 | Server-side `imageHash` verification | **DECIDED — §12.23.** Deferred post-v1; hash carried in metadata JSON, client-verifiable in Trust panel | Metadata-hash verification (the chain commitment) is unaffected |
| OI-11 | External `confirmation_state` UPDATE vs sidecar table | **OPEN — §13.** Owner: hoodpad-indexer against the pinned Ponder version at M2; sidecar `event_confirmations` is the documented fallback | Either satisfies §2.1; pick is version-dependent |
| OI-12 | WS replay buffer | **DECIDED — §12.23.** None in v1; REST-heal on reconnect/seq-gap | Replay buffers add fanout-tier state for a problem REST already solves |
| OI-13 | V3 Factory / NPM addresses | **RESOLVED — §12.28.** = contracts O-4 (addresses recorded) | Startup assertions still mandatory |

## 3. API (`docs/services/api.md` §9, OI-A1…OI-A10)

| ID | Item | Disposition | Rationale / owner |
|---|---|---|---|
| OI-A1 | "R2 presigned uploads": browser presign vs API-mediated | **DECIDED — §12.19.** API-mediated; presign exists only on the API→R2 leg. Spec §5.3/§8 amended; web.md corrected (`POST /v1/uploads/image`, no `/uploads/presign`) | §8.4's sniff + re-encode must run before any byte reaches public storage; browser presign would need a quarantine bucket for strictly more complexity |
| OI-A2 | Search ranking (ticker ×1.2, volume tiebreak, floor 0.25) | **DECIDED — §12.22.** As proposed, explicitly *tunable config* | Pure product tuning; ratified so M2 isn't blocked, revisit with beta data |
| OI-A3 | `trending` + King-of-the-Hill formulas | **DECIDED — §12.22.** KotH = `progress × ln(1+vol24h)`; trending = `vol24h × e^(−age/24h)`, τ=24h; tunable config | Spec gave intent, not math; formulas are indexer/API-owned, frontend renders only (resolves web item 3) |
| OI-A4 | Moderation queue tech (BullMQ vs Redis list worker) | **DELEGATED.** hoodpad-indexer's implementation choice; recommendation (minimal Redis worker) stands | Inside one service's lane; no cross-service or spec surface |
| OI-A5 | `pending_review` visibility + WS ticker moderation | **DECIDED — §12.21.** `pending_review` stays listed; WS `global:launches` unmoderated in v1 (hide propagates via REST) | Vendor outage must not blank the site; moderation-aware fanout would need hot-path DB reads (violates latency rule) |
| OI-A6 | Hidden token on direct fetch: 404 vs flag | **DECIDED — §12.21.** Visible-with-hidden-flag | Hiding is listing-only (§8.4); the token exists on-chain regardless |
| OI-A7 | Moderation vendor + mandated-reporting flow | **OPEN — §13.** Owner: architect + ops. M2 ships stub vendors behind a boot guard | Legal dimension is part of vendor selection |
| OI-A8 | Admin SIWE allowlist membership | **OPEN — §13.** Follows the Safe signer-set decision (O-6) | Config-driven; populate when decided |
| OI-A9 | Impersonation watchlist source + cadence | **DECIDED — §12.23.** Curated, source-cited, dated data file; refreshed ≥ monthly | §2 discipline applied to list data; never hardcoded metrics |
| OI-A10 | ETH/USD endpoint source | **Aligned** (single source = `eth_usd_snapshots`); underlying feed **OPEN — §13** (= OI-6) | One producer (indexer poller), one reader (API) |

## 4. Web (`docs/services/web.md` §9, items 1–11)

| # | Item | Disposition | Rationale / owner |
|---|---|---|---|
| 1 | WS + REST contract ratification | **DECIDED (ratified interfaces).** Canonical = indexer.md §8.1/§8.2 channels/messages and api.md §3 routes; web.md corrected (channel taxonomy, message type names, `/v1/` paths). One gap web exposed was real: `GET /v1/trades/:txHash` did not exist — **added to api.md §3.4** for optimistic reconciliation | The owning service's doc is authoritative for its interface; web's names were proposals |
| 2 | ETH/USD endpoint existence | **RESOLVED (no decision needed).** `GET /v1/eth-usd → { price, source, asOf }` already in api.md §3.5; web.md corrected (`fetchedAt` → `asOf`) | Was a doc-sync gap, not a design gap |
| 3 | Ranking formulas | **DECIDED — §12.22** (= OI-A3) | Frontend renders, never computes |
| 4 | `quoteBuy`/`quoteSell` views on chain | **RESOLVED (no decision needed).** They exist on Router + Curve (contracts.md §2.3/§2.4), incl. graduation-clamp outputs; web.md updated to prefer them | Was a doc-sync gap |
| 5 | Graduating-interstitial sells | **DECIDED — §12.12** (= O-2). Both directions locked; two-sided disabled interstitial is the ratified UX; copy must not say "paused" | Same ruling as contracts O-2 |
| 6 | WalletConnect projectId + Robinhood Wallet on 4663 | **OPEN — §13.** Owner: hoodpad-frontend verifies at M3 start; architect records | Ops/runtime check |
| 7 | `next/og`/satori under Bun; Multicall3 on 4663 | **OPEN — §13.** Owner: hoodpad-frontend, M3 start; fallbacks documented in web.md §6 | Runtime checks with in-doc fallbacks |
| 8 | LP sentence wording divergence (§5.2 vs canon) | **DECIDED — §12.14.** Canonical: **"LP principal permanently locked; trading fees claimable by treasury."** Spec §5.2 amended to the canonical sentence; longer "immutable vault" phrasing allowed only as explanatory sub-copy, never as the constant | One string constant, zero drift; grep-enforceable |
| 9 | Dark-only v1 | **DECIDED — §12.23.** Dark-only, no toggle | "Dark-first, dense, fast" + zero theme-flash; a toggle adds surface for no v1 value |
| 10 | Large-value disclosure threshold (ETH notional) | **OPEN — §13.** Owner: architect with M0 input; must land before M3 exit; config value, never a literal | §2.1 disclosure requirement |
| 11 | Upstream §13 items (V3 addresses, brand, ToS, M0 constants) | **OPEN — §13** (pre-existing) | Tracked in spec §13 with blockers noted |
| 12 | UI component library (design not ready; must be trivially re-themeable) | **DECIDED — §12.24 (2026-07-09).** **shadcn/ui**: Tailwind-native (existing §9 stack), components vendored into `apps/web/components/ui/` (owned, no runtime component dep), theming exclusively via CSS custom-property design tokens — future design = token-value swap + selective restyles; no bespoke styling may bypass the token system (lint-enforced). Alternatives rejected: raw Radix (more assembly, same result), HeroUI (runtime dep), Mantine (parallel styling system vs Tailwind) | web.md §7 amended; implementation-plan M3-2 |

---

## 5. Ratification pass 2026-07-09 (findings docket `docs/review/findings-2026-07-09.md`)

Dispositions from the closing verification docket. **DECIDED** rows land in spec §12; **OBLIGATION** rows are implementation decisions delegated to the owning agent per the decide-it-yourself protocol; **DEFERRED** rows are roadmap.

| Finding | Disposition | Where |
|---|---|---|
| C-1 / UM-1 treasury-pointer sell-freeze | **DECIDED — §12.25.** Pull-payment fee escrow: fees accrue in-contract, permissionless non-phase-gated `sweepFees()`; no trade path calls treasury. Solvency/exact-fee invariants updated; reverting-treasury sell test added to gate-2 pause matrix | spec §12.25; contracts.md §2.3/§3.2–3.4/§5.7/§6; threat-model §0/§4.2/§4.5/§8/R5; CLAUDE.md |
| U-3 graduation fee | **DECIDED — §12.26.** Small flat cost-based (≈ migration gas + thin margin), not %-of-raise; exact number at M1, formula/placeholder in M0 | spec §6.4/§12.26; contracts.md §4 |
| U-3 anti-sniper | **DECIDED — §12.27 + DEFERRED.** v1 ships §12.18 fixed timestamp window; decaying+size-based redesign deferred to pre-caps-lift | spec §6.5/§11/§12.27 |
| U-4 / O-4 / E-1 V3 on 4663 | **DECIDED — §12.28.** V3 confirmed; Factory/NPM/SwapRouter02/QuoterV2 recorded; runtime assertions mandatory; trade fee kept 1%. Closes O-4/OI-13/web-11(V3)/E-1 | spec §12.28/§13; CLAUDE.md; contracts.md §4/§7.2 |
| U-2 workspace | **DECIDED — §12.29.** pnpm workspaces; Bun stays runtime/test runner. Conversion by hoodpad-shared | spec §12.29; development-flow §4 |
| X-1 name limit | **DECIDED — §12.30.** 32 bytes on-chain = source of truth; API/shared/OpenAPI align to byte limits | spec §12.30; api.md §3.2/§5 |
| X-13 metadata version | **DECIDED — §12.31.** `version:1` frozen inside hash preimage | spec §12.31; api.md §3.2/§5 |
| X-2 V3 price orientation | **FIXED (doc).** Invert when token is token1 (`token > WETH`), not token0 | indexer.md §3.2 |
| X-3 Trade.trader plumbing | **FIXED.** `trader` plumbed into curve `buy`/`sell`; Router forwards `msg.sender` | contracts.md §2.3/§2.4/§3.2–3.3 |
| X-4 real_token_reserves + balance ownership | **FIXED.** `real_token_reserves` maintained incrementally from `Trade.tokenAmount±`; `balance`/`holder_count` written only by Transfer handler | indexer.md §3.2/§3.4/§3.6 |
| X-5 Transfer idempotency | **FIXED.** Per-event `transfers` table keyed `(tx,log)` anchors balance-delta idempotency | indexer.md §3.6/§7.3 |
| X-6 fee_collected WS msg | **FIXED.** Message schema added; hoodpad-shared adds to `ws-messages.ts` | indexer.md §8.2; api.md §5 |
| X-7 OG candles param | **FIXED.** OG uses `from`/`to` (not `limit`) | web.md §6 |
| X-8 architecture routing | **FIXED.** `graduate` → BondingCurve, `collect` → LPFeeVault (not Router) | architecture.md §1 |
| X-9 admin re-verify | **FIXED.** API publishes `control:reverify` on Redis; indexer is sole writer of `metadata_verifications` | api.md §3.6; indexer.md §6.2 |
| X-10 TokenCreated seam | **FIXED.** API moderation worker subscribes to `global:launches`; writes API-owned `moderation_status` | api.md §4.4 |
| X-11 confirmation tier | **FIXED.** Watermark broadcasts (§12.20), not per-event messages | web.md §4.1 |
| X-12 graduation recordEthDelta | **FIXED.** `graduate()` registers `recordEthDelta(−realEth)` (non-reverting) | contracts.md §3.4 |
| X-13 TokenDetail.creator | **RATIFIED.** Card = address, Detail = `{address, tokensCreated}` by design | api.md §5 |
| UM-2 grief-lock | **OBLIGATION (M1, hoodpad-contracts) + gate-6 cost proof.** Bounded-retry + escape-hatch design; escape hatch mandatory if griefing not proven uneconomic | threat-model §8/§8.1 |
| O-8 arb-back WETH-leg budget (T-2) | **OBLIGATION (M1, hoodpad-contracts).** Define + prove the WETH-side budget rule (undefined by "inventory above mint requirement" since mint takes all WETH) | threat-model §8.1; contracts.md §3.4 |
| Cross-entrypoint reentrancy (T-3) | **OBLIGATION (M1, hoodpad-contracts).** Trade fns + `graduate()` + `sweepFees()` `nonReentrant` + CEI; explicit cross-entrypoint unit | threat-model §8.1; contracts.md §5.4 |
| UM-4 single-RPC | **ACCEPTED v1 + gate-10 disclosure;** second RPC = pre-caps-lift enhancement | threat-model §8.1; spec §11 |
| UM-5 stored-link XSS | **OBLIGATION (M3, frontend+api).** https-only scheme allowlist + `rel=noopener` + CSP + e2e XSS assertion | threat-model §8.1; web.md §5/§8.2; api.md §6.4 |
| UM-9 CREATE2 squatting | **OBLIGATION (M1, hoodpad-contracts, low).** Accept + document, or mix salt nonce if gate-6 shows cheap front-run | threat-model §8.1 |
| T-5 coverage map | **FIXED.** §7 completion addendum maps the previously-omitted §4 threats | threat-model §7.1 |
| Plan runnability (P-1…P-9, E-3, E-4, Bucket 6) | **FIXED.** P0-6 split (local commit vs USER push), M0 `derive`/`out/constants.json`, compose hoisted to M2, addresses codegen in M1-14, search in M2-9, G-5b assertable-layers+waivers, verify-line rot, owners ratified, Ponder same-tx spike (M2-0b), OI-8 fallback (M2-3b), ops docs pre-M4 | implementation-plan; development-flow §4 |

## 6. Spec Addendum v1.2 (2026-07-09) — adversary model, organic-flow, project framing

Authoritative user addendum; incorporated faithfully (not re-litigated). All entries are **spec-resident** (v1.2 §2.2/§3/§5.2/§8.5/§10/§11/§13/§14) — this register cross-references and records the binding planning assumptions.

| Decision | Disposition | Where |
|---|---|---|
| **Organic-flow discount** | **BINDING PLANNING ASSUMPTION.** Assume **≤50% of headline DEX volume is organic** until own indexer says otherwise; all market-sizing/revenue estimates carry it explicitly | spec §2.2; M0-4 (floor), G-A.1 |
| **Day-1 users are bots** | **BINDING.** Product must be correct + profitable under bot-dominant flow (fee capture actor-agnostic — pull-payment §12.25 accrues regardless) while protecting human UX (§5.3 atomic buy, §6.5 caps) | spec §2.2 |
| **Two-phase framing + Gate G-A** | **DECIDED (spec §14).** Phase A = the plan's existing Goal (testnet, portfolio-grade); **Gate G-A** (market/competition/personal/legal — all NEEDS-USER) gates Phase B (M4/M5). Legal moves open→blocking at G-A. §14 does not expand the Goal | spec §14; plan "Gate G-A" section |
| **M1 hard timebox (pre-made)** | **DECIDED (spec §11).** If V3Migrator fuzz/invariant not green by end of week-1 of M1 → V2+burn fallback (§6.3) same day. **Cost is explicit and eyes-open:** flips LP copy §12.14→"burned" (§6.3, only sanctioned flip), kills post-grad fee revenue (§6.4 LPFeeVault descoped); **trigger is migrator gate-failure, NOT V3 availability (§12.28 confirms V3 on 4663)**; **§12.25 curve-fee escrow unaffected** (curve-side) | spec §11; plan M1 timebox block |
| **§8.5 bot/farm detection** | **DECIDED (spec §8.5).** M2 SQL views/jobs over existing trades+transfers; **advisory labeling only, never gates chain state** (§8.4 philosophy); feeds Trust panel + internal dashboard | indexer.md §8.5; api.md trust payload/holders; web.md §3.2; plan M2-13 |
| **Trust-panel organic metrics** | **DECIDED (spec §5.2).** Organic-holder estimate as a RANGE, flow quality, funding-cluster grouping — cheapest differentiation, no new on-chain surface | web.md §3.2; plan M3-5 |
| **Gate 6/7/10 amendments** | **DECIDED (spec §10).** Gate 6 parameterized vs observed §2.2 patterns; gate 7 cluster-volume alert (M0 thresholds); gate 10 heuristic-metrics disclosure | threat-model §3.1/§7; plan M2-12 |
| **hood.fun = mainnet incumbent** | **DECIDED (spec §3).** Weekly traction snapshot (own indexer/Dune, source+timestamped) → Gate G-A.2 | indexer.md §8.5.3; plan M2-14 |
| **M0 additions** | organic-volume floor (G-A.1) + funding-cluster alert thresholds X%/Y% (gate 7) in the M0 notebook | spec §13; plan M0-4 |

**Reconciliation notes (recorded, not re-litigated):**
- **V2+burn timebox vs §12.28/§12.25:** the fallback is triggered only by migrator gate-failure within week 1, not by V3 absence (§12.28 confirms V3 on 4663). Its cost — LP-copy flip (§12.14→"burned") + loss of post-grad fee revenue — is accepted up-front. The pull-payment curve-fee escrow (§12.25) is orthogonal to graduation venue and survives the flip.
- **§14 vs the plan Goal:** identical scope. §14 Phase A == the Goal ("production-ready, not production-launched"); §14 only names the phase/gate structure and makes the mainnet decision explicit + conditional. No Goal expansion.

## Summary

**Decided 2026-07-09 (spec §12.11–§12.24):** O-1, O-2, O-3, O-7 (mechanism), O-8 (budget rule), O-11, OI-1, OI-2, OI-3, OI-4, OI-5, OI-7, OI-9, OI-10, OI-12, OI-A1, OI-A2, OI-A3, OI-A5, OI-A6, OI-A9, web-1/2/3/4/5/8/9, web-12 (shadcn/ui, §12.24).

**Decided 2026-07-09, ratification pass (spec §12.25–§12.31):** C-1/UM-1 pull-payment (§12.25), graduation fee cost-based (§12.26), anti-sniper freeze + deferred redesign (§12.27), V3 addresses on 4663 / O-4 / OI-13 / E-1 (§12.28), pnpm workspace (§12.29), name/symbol byte limits (§12.30), metadata `version` freeze (§12.31).

**Open (spec §13, with owners):** O-5 (compiler pin — contracts, pre-deploy), O-6/OI-A8 (Safe + signer set + admin allowlist — architect/ops), O-7 values + O-8 numbers (incl. WETH-leg budget definition — hoodpad-contracts M1) + O-9 (M0 notebook), O-10 (beta caps — security, pre-beta), OI-6/OI-A10 (ETH/USD feed — indexer, M2 start), OI-8 (RPC tags — indexer, M2 day 1), OI-11 (Ponder write tolerance — indexer, M2), OI-A7 (moderation vendor — architect/ops), web-6/7 (M3-start runtime checks — frontend), web-10 (large-value threshold — architect, before M3 exit), Robinhood testnet parameters (chain ID/RPC/explorer/faucet — contracts, at implementation-plan Phase T start), plus name/brand and legal/ToS. **O-4/OI-13 (V3 addresses) now CLOSED (§12.28).**

**Delegated:** OI-A4 (queue tech — hoodpad-indexer).
