# Goal-completion & audit-remediation plan — 2026-07-12

Derived from the five-agent implementation audit of `docs/implementation-plan.md` + `launchpad-spec.md` against the tree at commit `adb3c5d` (main, clean). This document is **subordinate to `docs/implementation-plan.md`** — that file remains the single tracker; every checkbox flips only there, via `/goal`, with evidence. This document sequences the remaining work, assigns owners, and lists verify commands.

**Definition of complete:** Goal end-state checklist G-1…G-10 all green, all audit discrepancies resolved, all stale doc text fixed. Explicitly OUT (unchanged from the master plan): gates 5–10 execution, M4/M5, beta-cap values (O-10), bounty terms, mainnet anything.

---

## 0. Decision points (resolve first — they gate workstreams)

| ID | Decision | Owner | Recommendation | Gates |
|---|---|---|---|---|
| D-1 | **Discover surface**: shipped Discover (trending carousel + event tape) diverges from spec §5.1 (KotH hero, token grid, 5 sorts / 3 filters, URL-state) with no §12.50 deviation recorded. Record a §12.50(f) deviation and amend flows DISC-1/DISC-3, or restore the §5.1 surface? | **user** + robbed-architect | **Record §12.50(f)** — the redesign was user-directed (`docs/design/robbed-redesign-plan.md`); restoring would undo it | W4, full G-5 |
| D-2 | **Deployments-artifact path**: plan T-3/G-7 say `tools/deployments/testnet.json`; the implemented pipeline writes `contracts/deployments/<chainId>.json`. | robbed-architect | Canonicalize `contracts/deployments/<chainId>.json`; amend plan T-3 + G-7 verify text | W7 |
| D-3 | **G-9 wording**: requires Dockerfiles for indexer/api/**web**, but web ships as Cloudflare Workers per §12.45 (recorded in `docs/runbooks/prod-images.md`). | robbed-architect | Amend G-9 to "container images for api/indexer + OpenNext/Cloudflare build for web" | W8 |
| D-4 | **M2-13 / M2-14 verify clauses**: internal dashboard endpoints (organic-% flow quality; competitor snapshots) don't exist. Build them or amend the clauses? | robbed-architect | **Build both** as thin read-only routes (small, and G-A.1/G-A.2 consume exactly this data) | W3 |

---

## 1. Workstreams

### W1 — CI e2e green (unblocks G-6, prerequisite for G-5) — owner: robbed-e2e
Latest main run 29167427029 fails only the `e2e` job, at step **"bring up stack (dev:stack)"**; logs have expired.

1. Re-trigger to capture fresh logs: `gh run rerun 29167427029 --failed` (or push a trivial commit).
2. In parallel, reproduce locally: `bun dev:stack && bun dev:health` (7 checks must pass).
3. Likely suspects, in order: compose service healthcheck timing under CI resources (anvil/minio/deploychain one-shots), port collisions with GH-runner defaults, missing CI env vars consumed by `tools/localstack/*`, docker layer-cache miss blowing the job timeout.
4. Fix in `.github/workflows/ci.yml` and/or `docker-compose.yml`; keep the fix minimal and documented in the commit message.

**Verify:** e2e job green on main. Note: the *full* Playwright matrix will still fail DISC-1/DISC-3 until W4 lands — a green `dev:stack`/`dev:health` step plus all non-DISC flows is the W1 exit; full-matrix green is the W4+W1 joint exit.

### W2 — `/goal` reconciliation pass (bookkeeping, no code) — owner: robbed-architect via `/goal`
- Flip **G-5b** (evidence: `bun scripts/e2e-coverage.ts` exit 0, 44/44, catalog + waivers ratified — re-run at flip time).
- Flip the duplicate **P0-6b** Phase-I row (or annotate it as a pointer to the Phase-0 row).
- **I-5a**: flip once W1 provides "harness boots against G-1 stack" evidence; everything else is already on disk.
- Add dated audit annotations (do not silently rewrite): M3-4 (superseded by redesign, pending D-1), M2-13/M2-14 (verify-clause gap, pending D-4), M2-2 (sync weaker than claimed + 2 known divergences), M2-12 (stale verify text, superseded by `docs/decisions.md:180`), P0-5 (toolchain not on PATH — see W6.1).

**Verify:** `/goal` run reports no checkbox-vs-evidence contradiction.

### W3 — M2 gap closure — owner: robbed-indexer (after D-4)
1. **M2-13**: internal flow-quality endpoint, e.g. `GET /internal/flow/:address` → organic range, cluster stats, botFlags summary (reuse `apps/api/src/projections/trust.ts` internals). Admin-SIWE-gated or internal-network-only; document in `openapi.yaml`.
2. **M2-14**: `GET /internal/competitor-snapshots` (paged, newest first) reading the `competitor_snapshots` table.
3. **M2-2 hardening**: add the admin SIWE endpoints to `openapi.yaml`; fix the `readyz` 503 envelope mismatch (`apps/api/src/routes/health.ts:6`); strengthen the sync test from membership assertions to an endpoint-for-endpoint route inventory diff (`apps/api/test/api-types.test.ts:265` → new `openapi-sync.test.ts` walking Hono's route table vs the yaml paths).
4. Configure or explicitly stub-document the competitor snapshot source (`unconfiguredCompetitorSource` boot warning) — if no source is chosen, record "manual until configured" in the plan row rather than leaving it implicit.

**Verify:** `bun test` green in `apps/api` + `apps/indexer`; new endpoints return seeded data against the local stack; openapi parse step in CI still green.

### W4 — Frontend cleanup — owner: robbed-frontend (after D-1)
**Branch A (D-1 = record deviation, recommended):**
1. robbed-architect records §12.50(f) (Discover = trending carousel + event tape; grid/KotH/sorts/filters/URL-state retired) and amends `docs/user-flows.md` DISC-1/DISC-3 to assert the shipped surface; re-ratify the catalog rev.
2. Delete dead code: `src/widgets/king-of-the-hill-hero/`, dormant `src/entities/token/model/params.ts` URL-state (and its test), the unused KotH API client leg if nothing else consumes it.
3. Update `e2e/flows/disc-1.spec.ts` / `disc-3.spec.ts` to the amended flows; keep `@flow` tags so `e2e:coverage` stays 44/44 (or the new ratified count).

**Branch B (D-1 = restore):** re-wire KotH hero + grid with the 5 shared-enum sorts / 3 filters + URL-state into `DiscoverView`; specs stay as ratified.

**Either branch:**
4. Wire the creator-click search deep link: `AppHeader` passes `initialQ` from `?q=` (or `SearchBox` reads `useSearchParams`) so `TokenCard`'s `/?q=<creator>` round-trip works (DISC-4 nuance).
5. Harden the LP-copy single-constant lint to also scan `.json` (mock fixture currently escapes it — `tests/copy-lint.test.ts`).
6. Route to robbed-shared: pin the two caret devDeps (`@opennextjs/cloudflare`, `wrangler`) exact, per the workspace no-ranges ethos.

**Verify:** `bun test` in `apps/web` (copy-lint, discover tests); DISC specs pass against the local stack; `bun scripts/e2e-coverage.ts` exit 0.

### W5 — Stale-doc sweep — owner: robbed-architect (mechanical; run `/doc-check` after)
1. Spec §12.48c + §13 OI-11: replace "direct-UPDATE materialization … in flight" with the landed **read-derivation** design (`confirmation_watermarks` singleton + `stateForBlock` at read; no per-row join table) and mark it the chosen sanctioned variant.
2. Spec §12.45 + new §12 entry: record the OG relocation web→API (`GET /v1/og/{address}.png`, native satori+resvg, R2-cached, CF-Worker 3 MiB rationale, commit `9528121`); rewrite `docs/services/web.md` §6 and the web-7 note in §9.
3. `docs/runbooks/deploy.md` H.6: PORT-1..8 ratified 2026-07-11 — remove "pending pre-I-5a".
4. Plan P-1 routed-gaps note: `apps/api/.env.example` exists; indexer example has the Chainlink keys + `PNL_JOB_INTERVAL_MS`. Keep only the true residual: `CORS_ALLOWED_ORIGINS` documented but unread by API code (CDN-layer interim).
5. Plan P-3 row: Redis no-op-transport finding is FIXED (`publish.ts` runtime transport + `sidecar.ts` fail-loud preflight) — replace "fix in flight".
6. Blocked-on-user table "Name / domain / brand" row: name (§12.46) and domain (§12.49) resolved; narrow the row to DNS nameserver cutover + OG brand mark + wordmark.
7. Spec §2 table: annotate the v3 "pull at implementation time" line as superseded by §12.28 fixed addresses.
8. Plan M2-12 row: replace the stale `/metrics on $API_PORT` verify clause with the recorded disposition (`docs/decisions.md:180`).
9. `docs/services/web.md` §9 web-7 note (doubly stale per audit) — covered by item 2.

**Verify:** `bun scripts/doc-check.ts` green; `/trace` over touched spec sections reports no new orphans.

### W6 — Env-gated contract legs — owner: robbed-contracts (+ user environment)
1. **P0-5 re-verify**: `forge`/`slither`/`solhint`/`anvil` are not on PATH in the current shell and `~/.foundry/bin`/`~/.venvs` don't exist. Either reinstall per `docs/runbooks/toolchain.md` pins (forge 1.7.1, slither 0.11.5, solhint 6.2.3, aderyn 0.6.8, solc-select 0.8.35) or, if the toolchain deliberately moved (e.g. into `docker/dev.Dockerfile`), update the runbook's "Binary on PATH" column to the new truth.
2. **M1-12 fork run**: with `ROBINHOOD_RPC_URL` set — `cd contracts && FOUNDRY_PROFILE=fork forge test`. Record output in the plan row; this also discharges the **14 fork-gated mutation survivors** (M1-13 rider) — re-run the mutation slice or disposition them against the green fork log.
3. **M1-2 pin verification**: deploy a throwaway contract compiled with 0.8.35 + cancun and verify it on Robinhood Blockscout; record the verification GUID in `docs/runbooks/toolchain.md:20`. **Hard gate: must precede the first testnet deploy (T-3).**

**Verify:** fork suite green log recorded; Blockscout GUID recorded; mutation README updated to 0 fork-gated survivors.

### W7 — Phase T execution — owner: robbed-contracts + user (after W6.3 and D-2)
Sequential; each step fail-closed by design:
1. **T-1 finish**: re-validate testnet constants with `--reuse-snapshot`; confirm `constants.testnet.json` derivation record.
2. **T-2**: fund a dev key on chain 46630 (faucet per `docs/runbooks/testnet.md` §1) → `bun safe:create` (canonical Safe v1.4.1 per §12.52) → write the Safe address into `tools/m0/external.testnet.json` → re-derive so `treasurySafe` is non-zero.
3. **T-3**: deploy all six contracts via `Deploy.s.sol` testnet mode (`contracts/script/emit-testnet-env.ts` for env injection); verify each on testnet Blockscout; record `contracts/deployments/46630.json` (per D-2); run `codegen-addresses`.
4. **T-4**: full lifecycle on testnet — create → buys/sells → cross graduation threshold → permissionless `graduate()` → V3 pool live → `collect()` → `sweepFees()` — record every tx hash in a new `docs/runbooks/testnet-lifecycle.md`.
5. **T-5**: bring up `docker-compose.testnet.yml` (chaincheck preflight) against the live testnet; `dev:health` equivalent green; indexer catches the T-4 history.
6. Flip **G-7, G-8** via `/goal` with the artifacts above.

**User inputs needed here:** faucet-funded key (T-2), confirmation to spend testnet gas.

### W8 — Goal closure — owner: robbed-architect orchestrating
1. **G-2**: run `bun dev:seed` against the stack; record the curl assertions + a Playwright smoke pass → flip.
2. **G-3**: with W6 done, record the full local `forge test` (default + fork profiles) green output → flip.
3. **G-4**: record `bun test` green in all four TS packages → flip.
4. **G-5**: full Playwright matrix green against the stack (needs W1 + W4) → flip; **G-6**: all CI jobs green on main → flip.
5. **G-9**: after D-3 wording amendment — `docker build` exit-0 evidence for api/indexer images + OpenNext build for web → flip.
6. **G-10**: `/spec-check` over the final tree; route any findings; on clean pass → flip.
7. Final `/goal` run: end-state checklist all `[x]`; update the Blocked-on-user table to only the genuinely-open rows (WalletConnect projectId, mainnet Safe signers, moderation vendor, DNS/brand legs, legal-at-G-A, O-10, organic-floor ratification).

---

## 2. Sequencing (waves; items within a wave run in parallel)

| Wave | Items | Blocked by |
|---|---|---|
| 1 | D-1…D-4 rulings · W1 CI diagnosis · W5 doc sweep · W2 (flips that need no new evidence: G-5b, P0-6b dup) · W6.1 toolchain | — |
| 2 | W3 (M2 gaps) · W4 (frontend, branch per D-1) · W6.2 fork run · W6.3 pin verify | D-1, D-4; RPC access |
| 3 | W7 (T-1→T-5) | W6.3, D-2, user faucet key |
| 4 | W8 (G-2/3/4/5/6/9/10 closure + final /goal) | W1, W3, W4, W6, W7 |

Critical path: **D-1 → W4 → G-5**, and **W6.3 → W7 → G-7/G-8**. Everything else is parallel filler around those two chains.

## 3. Blocked-on-you — exactly what to provide, where it goes, when it's needed

### Needed for the current goal (Waves 1–4)

**D-1 ruling — Discover surface** *(now; gates W4 and full G-5)*
Say "record the deviation" (keep the shipped trending-carousel + event-tape Discover; DISC-1/DISC-3 flows get amended) or "restore §5.1" (grid + KotH hero come back). Recommended: record the deviation.

**Testnet gas + go-ahead (T-2/T-3/T-4)** *(Wave 3)*
- Deployer key is generated fresh by us (`cast wallet new`, runbook §2.1) — you don't provide a key; you complete the faucet's human-verification step and fund the printed address at `https://faucet.testnet.chain.robinhood.com` (0.05 ETH + 5 of each stock token per 24h after verification; verified fallbacks: `faucets.chain.link/robinhood-testnet`, `faucet.quicknode.com/robinhood/testnet`). Deploy + lifecycle may need more than one 24h claim — start claiming early.
- Explicit go-ahead to deploy the six contracts on 46630 and run the lifecycle (spends testnet gas only).
- Testnet Safe signers: §12.52 sanctions dev-signers-only — confirm a 1-of-1 dev-key Safe is acceptable for testnet.
- *(Optional, recommended)*: an **Alchemy API key** for `https://robinhood-testnet.g.alchemy.com/v2/{KEY}` — the public RPC is rate-limited and the T-5 staging indexer will hammer it.

**Mainnet 4663 RPC URL** *(Wave 2, for the M1-12 fork suite)*
Any working 4663 RPC (public endpoint from `docs.robinhood.com/chain/connecting`, or a provider key) exported as `ROBINHOOD_RPC_URL`. If the public endpoint suffices, nothing to provide — just confirm network access from the machine running `forge`.

### Needed before mainnet, NOT goal-blocking (provide whenever ready)

**web-6 — WalletConnect projectId**
- Get: free account at `cloud.walletconnect.com` (Reown) → create project "ROBBED_" → copy the Project ID (a hex string).
- Goes in: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in `apps/web/.env.local` + prod web env.
- Until set: injected browser wallets work; the WalletConnect and Robinhood Wallet connectors stay hidden (by design, `apps/web/.env.example:14-17`).
- Second leg: once set, an on-device test of the Robinhood Wallet connect flow (a phone with the Robinhood Wallet app, pointed at the testnet deployment) closes web-6.

**O-6 — Mainnet treasury Safe signer set** *(needed at Phase-B deploy; admin SIWE allowlist OI-A8 follows it)*
Provide: N signer EOA addresses (hardware-wallet-backed recommended), the threshold M (recommend 2-of-3 or 3-of-5), and who holds each key. We then deploy/pull the canonical Safe on 4663, and the address lands in `tools/m0/external.json → treasurySafe` (deploy fails closed while it is `0x0`).

**OI-A7 — Moderation vendor(s)** *(needed before capped beta; prod API refuses boot on stubs unless `MODERATION_ALLOW_STUBS=true`)*
Provide two vendor choices + credentials:
1. CSAM hash-match (candidates: Microsoft PhotoDNA, Google Content Safety / CSAI Match, Thorn Safer, Cloudflare CSAM tool) — note most require an application/approval process with lead time, so start early.
2. NSFW classifier (candidates: Hive, AWS Rekognition, Google Vision SafeSearch, Azure Content Safety).
Credentials go in the reserved `MODERATION_CSAM_VENDOR_*` / `MODERATION_CLASSIFIER_VENDOR_*` keys (`apps/api/.env.example:26-29`). Thresholds have defaults (auto-hide ≥0.95, review ≥0.8) — override only if you want different ones. The **mandated-reporting legal flow** (e.g. NCMEC reporting if US-touching) rides on the legal-wrapper decision below.

**O-10 — Beta cap values** *(gate 7, M4; set jointly with robbed-security)*
Provide two ETH numbers: `perTokenEthCap` (max ETH a single curve may absorb during beta) and `globalEthCap` (max ETH across the platform). M0 placeholder defaults exist in `constants.json.beta.*`; the real question for you is: how much total ETH exposure is acceptable while gates 5–10 are still in flight?

**Brand / DNS legs** *(cosmetic-blocking only; name + domain already decided)*
1. DNS: at your registrar, point `robbed.fun` nameservers at Cloudflare account `0b1b0b8753489a11d35ee922961f6b72` (spec §13) — until then the web app lives on `*.workers.dev` and Worker custom domains can't attach.
2. OG brand mark: supply a logo/mark image (or approve a generated one) for OG cards.
3. Header wordmark: approve the styling treatment for `ROBBED_`.

**Legal wrapper / ToS** *(becomes BLOCKING only at Gate G-A; Phase A is testnet-only, no fees)*
Provide: chosen jurisdiction + entity form for operating the frontend, MiCA/JDG counsel outcome with a workable path, and ToS text. Nothing needed until you decide to go for mainnet.

**G-A.1 — Organic-volume floor ratification** *(at Gate G-A, after M2 recalibration)*
Ratify (or adjust) the M0 default: floor = 5 graduations-equivalent of organic volume per 7 days (`floorWei = 5 × GRADUATION_ETH`). This is the "is there a real market on this chain" go/no-go number — we'll bring you the indexer's real organic-volume series alongside the hood.fun snapshots when it's time; the only input is your judgement on N.

**Bounty terms** *(gate 8, M4)* — payout tiers/scope for the public bounty; repo-public precondition already met.
