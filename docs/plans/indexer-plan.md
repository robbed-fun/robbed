# Per-Service Plan — Indexer (Ponder)

**Owner:** hoodpad-indexer · **Driving doc:** docs/services/indexer.md · **Master slice:** M2-0/0b · M2-3/3b · M2-4…M2-8 · M2-13/14 · T-5 · I-1/I-3 (indexer legs) · **Revised:** 2026-07-10

> **Authority.** `docs/implementation-plan.md` is the single `/goal` checkbox authority; this file is *detail* keyed to its item IDs (`⇐ M2-5`) and never contradicts it or a §12 decision. If this file and the master plan disagree, the master plan wins and this file is corrected (README §7). Every indexer output is **advisory** — it labels and derives, it never gates chain state, listings, or trades (§8.4). USD is never a constant (§2): it exists only as `eth_value × eth_usd_snapshots.latest`.
>
> **Scope note (routing).** The API + WS *read/serve* legs — M2-2, M2-9, M2-10, M2-11, M2-12 — live in `docs/plans/api-plan.md` (same owning agent, different plan). This file stops at the Redis publish boundary; the WS fanout *contract* (`apps/api/src/ws.ts`, no-DB-import structural test) is planned here because the publisher owns the latency guarantee, but the API endpoints that consume these tables are not duplicated here.
>
> **Docs-first (verified 2026-07-10).** Ponder `factory()` API confirmed current against ponder.sh docs: `factory({ address, event, parameter })`, and `event.log.address` identifies the emitting child contract — this is the mechanism for V3 pools (over `Graduated.pool`), LaunchToken `Transfer` (over `TokenCreated.token`), and the `Collect` single-source filter. Reorg-rollback and external-`UPDATE` tolerance are **version-specific** and could not be fully pinned from public docs; they are deliberately carried as decide-it-yourself items to reconfirm against the *pinned* Ponder version at M2-3 (OI-11) rather than assumed here.

## Build order

```
M2-0 compose ──► I-1 (indexer leg: wrapper over compose) ──► I-3 (dev:stack / dev:health)
   │                                                             ▲  ▲  ▲
   ▼                                                             │  │  │
M2-0b Ponder same-tx factory-child SPIKE  ◄── BLOCKING: must pass or escalate before M2-5
   │
M2-3 §13 checks (OI-6 eth/usd · OI-8 safe/finalized tags · OI-11 external-write)
   │                                   │
   │                                   └──► M2-3b OI-8 fallback (L1 watermark reader) — conditional
   ▼
M2-4 schema + config ──► M2-5 handlers + unified trades + candles + rebuild  (X-2, X-4 baked in)
   │                          │
   │                          ├──► M2-6 confirmation tracker (needs M2-3/3b watermark source)
   │                          ├──► M2-7 metadata verification
   │                          ├──► M2-8 Redis publish + Bun WS fanout
   │                          ├──► M2-13 bot/farm heuristics ──► token_flow_stats ──► (api Trust feed + gate-7 M2-12)
   │                          └──► M2-14 hood.fun weekly snapshot
   ▼
T-5 staging vs testnet (backfill, real OI-8 behavior, metadata vs real R2)
```

**Blocking edge:** M2-0b (same-tx factory-child spike) gates M2-5. If Ponder cannot index a child curve's `Trade` in the *same tx* as its `TokenCreated`, every atomic initial buy (§12.15) is silently lost — the spike must pass or an escalation + workaround must be recorded before any handler work.

## Task table

| Seq | ⇐ Master | Task | Files | Proven by test | Depends on |
|---|---|---|---|---|---|
| 1 | M2-0 | Root `docker-compose.yml` — Postgres (+`pg_trgm`), Redis, minio, healthchecks | `docker-compose.yml` | `docker compose up -d && docker compose ps --format json` → all healthy | — |
| 2 | **M2-0b** | **Ponder same-tx factory-child SPIKE (E-3/Q18) — BLOCKING.** Prove Ponder indexes a child curve's `Trade` in the *same tx* as its `TokenCreated` factory-registration. If not → escalate to architect with a workaround (receipt-derived initial buy / same-tx ordering shim) before M2-5 | spike test under `apps/indexer/`; finding in `docs/services/indexer.md §7.4` | same-tx child `Trade` captured in `trades`, **or** an escalation + chosen workaround recorded | M2-0 |
| 3 | M2-3 | §13 checks → architect records: **OI-6** (Chainlink ETH/USD feed on 4663? else DefiLlama/Coinbase config), **OI-8** (`safe`/`finalized` block-tag support on Robinhood RPC), **OI-11** (external `UPDATE` of `confirmation_state` on Ponder tables vs sidecar, against the *pinned* Ponder version) | dispositions in `docs/decisions.md` / spec §12 | three §12/decisions entries recorded (advisory findings, not code) | M2-0 |
| 4 | M2-3b | **OI-8 negative branch (E-4) — conditional.** If tags unsupported: L1 rollup-watermark reader — batch-posted from `SequencerBatchDelivered`, finalized from node confirmations, via an L1 RPC | `apps/indexer/src/l1watermark.ts`; env `L1_RPC_URL`, rollup/inbox addrs | N/A (recorded in M2-3) if tags supported; else watermarks advance from the L1 reader in the M2-6 suite | M2-3 |
| 5 | M2-4 | `ponder.config.ts` + `ponder.schema.ts` (**all §3 tables** incl. `transfers` X-5; §8.5 offchain `address_flags`/`token_flow_stats`/`competitor_snapshots`), offchain migrations (`confirmation_watermarks`, `eth_usd_snapshots`, `metadata_verifications`, `moderation_status`-read + `pg_trgm` GIN indexes), startup assertions | `apps/indexer/ponder.config.ts`, `apps/indexer/ponder.schema.ts`, `apps/indexer/migrations/*` | `bun test apps/indexer` schema tests; boots against compose Postgres; startup asserts fail on unset V3 addr / wrong WETH / chainId≠4663 / missing `pg_trgm` | M2-0b, **shared M2-1** |
| 6 | **M2-5** | Handlers — **six** event families + unified `trades` (venue discriminator) + candle pipeline (6 intervals, high-water idempotency) + `rebuild` script. **X-2** (invert price when token is token1, i.e. `token > WETH`) and **X-4** (`real_token_reserves` maintenance + balance-write ownership) baked in — see M2-5 detail below | `apps/indexer/src/handlers/*.ts`, `apps/indexer/src/candles.ts`, `apps/indexer/scripts/rebuild.ts` | `bun test apps/indexer` — venue-continuity-across-graduation fixture + `rebuild == incremental` byte-equal + dup-replay no-op | M2-4 |
| 7 | M2-6 | Confirmation tracker — watermark singleton, ~5s poll, ranged materialization of `confirmation_state`, O(1) `global:confirmations` broadcast (§12.20), `reorg` notice | `apps/indexer/src/confirmation.ts` | `bun test apps/indexer` transition suite (monotonicity, boundary-block, reorg-consistency) | M2-4, M2-3(/3b for source) |
| 8 | M2-7 | Metadata verification — fetch (timeout/size-cap/content-type), **shared `canonicalizeMetadata`**, keccak256 compare byte-for-byte, backoff schedule, re-verify cadence, `control:reverify` subscribe (X-9); never `match` without a byte compare | `apps/indexer/src/metadata.ts` | `bun test apps/indexer` match / mismatch / unfetched + "comparison stubbed out ⇒ suite fails" mutation guard | M2-4, **shared** (`metadata.ts` canonicalizer + fixtures) |
| 9 | M2-8 | Redis publish (zero hot-path DB/RPC reads, fire-and-forget, `INCR channel:seq`) + Bun WS fanout + no-DB-import structural test; publishes suppressed during historical backfill | `apps/indexer/src/publish.ts`, `apps/api/src/ws.ts` | `bun test apps/api` incl. import-graph assertion (publish/ws modules import no DB client); backfill-suppression unit | M2-5, M2-6 |
| 10 | **M2-13** | **(§8.5) Bot/farm detection** — SQL views + scheduled jobs over `trades`+`transfers`: funder clustering, wallet-age-vs-action (sniper), contract-mediated exec (**own-Router whitelist**), wash-loop (excluded from organic vol), same-second multi-pool exits → `address_flags` + `token_flow_stats` (organic-holder %/organic-volume % as ranges); flow-quality dashboard feed + Trust feed. **Advisory only, never gates chain state.** Rebuildable from `trades`+`transfers` | `apps/indexer/src/flags/*.ts`, `apps/indexer/src/flags/views.sql` | `bun test apps/indexer` heuristics suite (funder-cluster→`farm`+`cluster_id`; own-Router NOT `programmatic`; wash excluded from organic vol; sniper t+59s flagged / t+61s not; organic %s render as a range; no code path gates a trade/listing on a flag) | M2-5 |
| 11 | M2-14 | **(§3/§14) Weekly hood.fun snapshot** — tokens/day, graduation count, visible volume (own indexer or Dune), **source+timestamped** into `competitor_snapshots` (never a hardcoded metric, §2) | `apps/indexer/src/jobs/competitor.ts` | dated snapshot row produced; API exposes it for the dashboard; feeds Gate G-A.2 | M2-5 |
| 12 | I-1 (indexer leg) | One-command wrapper over the **M2-0** compose (Postgres+`pg_trgm`, Redis, minio) — ensure it is part of `dev:stack` bring-up; **reuses M2-0, not rebuilt** | root scripts, `docker-compose.yml` | `docker compose up -d && docker compose ps --format json` → all healthy (as consumed by `dev:stack`) | M2-0 |
| 13 | I-3 (indexer leg) | Root orchestration scripts `dev:stack` (compose → chain → indexer → API → WS → web, readiness-gated) and `dev:health` (DB/Redis/RPC/indexer-head/`/v1/healthz`+`/readyz`/WS handshake/web 200) | root `package.json` scripts, `tools/localstack/**` | **G-1**: `bun run dev:stack && bun run dev:health` exits 0 from a clean checkout | I-1, M2-8; cross-service I-2 (chain), M3 (web) |
| 14 | T-5 | Staging stack vs testnet — indexer backfill from deploy block, confirm real OI-8 behavior on the live RPC, metadata verify vs real R2 | staging env config | **G-8** second half: `GET /v1/confirmations` advancing (non-zero `safeBlock`); lifecycle rows indexed with correct venue continuity | Phase T entry, M2-6, M2-7 |

## M2-5 detail (largest item — sub-tasks, all inside the one master checkbox)

| # | Sub-task | Baked-in rule | Proving test |
|---|---|---|---|
| 5a | `TokenCreated` handler | seed `tokens` row; `metadata_verifications` `unfetched`; seed `real_token_reserves = CURVE_SUPPLY` (factory immutable cached at startup, X-4); `virtual_*`/`graduation_eth` from cached factory constants (no per-event RPC); `creator`+`creator_fee_bps=0` from day 1 (§7) | row shape + reserve seed unit |
| 5b | `Trade` handler (curve child) | insert `trades venue='curve'`; `price_eth = virtualEth_post / virtualToken_post` (post-trade reserves in event, no RPC); update `tokens` live state; **`real_token_reserves −= tokenAmount` on buy / `+= tokenAmount` on sell (X-4)**; write **cost-basis columns only** on `balances` — never `balance`/`holder_count` (X-4 balance-write ownership); candle upsert ×6 | reserve-delta unit; "Trade never touches `balance`" assertion |
| 5c | `Graduated` handler | insert `graduations`; `tokens.graduated=true`, `v3_pool_address`, `graduated_at`; cache `token_is_token0 = (token < WETH)`; dynamically register the pool for V3 `Swap`/`Collect` (Ponder `factory()` over `Graduated.pool`) | single-fire (2nd `Graduated` no-op); orientation cached |
| 5d | V3 `Swap` handler (graduated pools only) | insert `trades venue='v3'`, `fee_eth='0'`; **X-2 price orientation** — raw `(sqrtPriceX96/2^96)^2` is WETH-per-token when token is token0 (use directly); **invert (`1/raw`) when token is token1 (`token > WETH`)**; direction from `amount0/amount1` signs; cost-basis best-effort (OI-5), **never `balance`/`holder_count`** | sqrtPriceX96→price for **both** orderings; 18/18 decimals |
| 5e | V3 `Collect` handler | single-source on NPM, filter `tokenId ∈ graduations.lp_token_id` (in-memory set, no per-event DB read); insert `fee_collections`, oriented via `token_is_token0`; alert if `recipient != treasury` | orientation + recipient-mismatch flag unit |
| 5f | LaunchToken `Transfer` handler (sole balance truth, §12.16) | `factory()` over `TokenCreated.token`; persist `transfers` row `(tx_hash,log_index)` as **dedup anchor**; apply `balance ± value` + `holder_count` transitions **guarded by the transfers insert** (re-delivery = no-op, X-5) | Transfer-driven balances; holder_count 0↔positive; dup-replay no-op |
| 5g | Candle pipeline (`candles.ts`) | 6 intervals `1s/15s/1m/5m/15m/1h` (§12.17); inline upsert per interval on every `trades` insert (curve+v3, uniform `price_eth` ⇒ **venue-continuous by construction**); high-water guard `(block_number,log_index) <= (last_block_number,last_log_index)` skips re-apply | bucket flooring; OHLC upsert; **continuity across simulated graduation** (curve→`Graduated`→v3 = one series, no boundary reset/null) |
| 5h | `rebuild` script (`scripts/rebuild.ts`) | truncate derived tables; replay `trades` + `transfers` in `(block_number,log_index)` order; also the reorg deep-recovery path; extends to `address_flags`/`token_flow_stats` | `rebuild` output byte-equal to incremental output over the fixture set |

## Decide-it-yourself decisions

Research → decide (safest, idempotent, rebuildable-from-raw) → record here → prove by test → implement. Undocumented design choices are unfinished.

| Decision | ⇐ | Chosen approach & basis | Research source | Proving test |
|---|---|---|---|---|
| **Reorg handling** | M2-5/M2-6 | Rely on Ponder's built-in onchain-table rollback; derived tables (`candles`, denormalized `tokens.*`, `balances`, flags) are **rebuildable from raw** (`trades`+`transfers`) so a reorg replays cleanly. Watermarks are **reorg-immune by construction**: they only ever reference L1-*posted* blocks, so a rolled-back event was by definition still `soft_confirmed` — no watermark can disagree. Emit a `reorg` notice on `global:confirmations` so clients drop orphaned soft-confirmed rows. Reconfirm the exact rollback hook name against the **pinned** Ponder version at M2-3 (public docs did not pin it). | ponder.sh reorg/reconciliation docs (verify at pinned version, not from memory) | reorg fixture: orphaned trades removed, `candles`/balances rebuilt to the pre-orphan state, watermark does not regress below a posted block |
| **Idempotency dedup key** | M2-5 | `(tx_hash, log_index)` as PK/unique on every event table; all handlers are pure upserts; balance/candle **increments** are guarded (candles by high-water mark, balances by the `transfers` insert conflict) so a re-delivered log never double-counts. Boring + can't silently corrupt derived data. | Ponder event-ordering + Postgres `ON CONFLICT` upsert docs | duplicate-event replay leaves `trades`/`balances`/`candles` counts unchanged (byte-equal) |
| **Same-tx child indexing** (workaround if M2-0b fails) | M2-0b | Prefer the boring path: if Ponder captures the same-tx child `Trade`, do nothing extra. If the spike fails, the workaround is receipt-derived: reconstruct the atomic initial buy from the `TokenCreated` tx receipt logs in the `TokenCreated` handler (still keyed `(tx_hash,log_index)` so it dedupes against a later real capture). **Escalate the choice to architect before M2-5** — it changes what a consumer sees (initial-buy visibility). | Ponder factory-pattern docs (`factory()` confirmed); spike result | atomic initial-buy `Trade` appears exactly once in `trades` under both the native and workaround paths |
| **Bot-heuristic thresholds** (advisory, tunable) | M2-13 | v1 defaults from spec §8.5: funder fan-out `N=20` in 24h, micro-transfer `< 0.001 ETH`, sniper `< 60s` after `TokenCreated` **and** funded `< 1h` prior, same-second multi-pool exit `≥ 3` pools/block. Store as config, not literals; tune with own M2 data. Never gates chain state. | spec §8.5 defaults; own tx-level data at M2 (§2.2 re-verify) | boundary fixtures: buy at t+59s flagged / t+61s not; funder with 20 fan-outs → cluster, 19 → not; own-Router trade NOT flagged `programmatic`; wash round-trip excluded from organic volume |
| **Confirmation materialization: direct UPDATE vs sidecar** | M2-6 (OI-11) | Prefer the direct ranged `UPDATE` of `confirmation_state` on Ponder tables (monotonic, reorg-compatible, one indexed pass on `block_number`). If the pinned Ponder version forbids external writes to its live store, fall back to an `event_confirmations` sidecar joined at read time. Decide against the **pinned** version at M2-3, record disposition. | Ponder table-store/external-write docs at pinned version | either path: an event at exactly `safe_block` materializes to `posted_to_l1`; states never downgrade |

## Cross-service dependencies (flag, don't self-resolve)

- **`packages/shared` gap (route via hoodpad-shared, M2-1 leg).** The frozen `packages/shared/src/db-rows.ts` on disk does **not** yet carry `TransferRow` (X-5) nor the §8.5 offchain rows (`AddressFlagsRow`, `TokenFlowStatsRow`, `CompetitorSnapshotRow`). These are cross-service (the API reads `token_flow_stats`/`competitor_snapshots` for the Trust feed and dashboard, §8.5.2), so per the anti-drift rule they belong in `packages/shared`, authored by hoodpad-shared, not redeclared in `apps/indexer`. The indexer consumes them via `workspace:*` once ratified; M2-4 depends on this. Reported, not worked around.
- **`ws-messages.ts` `fee_collected` (X-6).** Confirmed present as a promised schema in the WS union; the indexer publishes it from the `Collect` handler (5e). If the frozen shape is missing the field, report to hoodpad-shared — do not shadow it locally.
- **Event-shape divergence.** Handlers transcribe the §12.15/§12.16 canonical shapes (mirrored in `packages/shared/events.ts` / codegen `events.json`). Any artifact-vs-§12.15 byte divergence at implementation time is escalated to hoodpad-architect (indexer.md §3 / DoD), never patched around with a heuristic.

## Definition of done

Mirrors indexer.md §11; all advisory, nothing gates chain state.

- [ ] Handlers for all **six** event families (§12.15–16), each idempotent on `(tx_hash, log_index)`; M2-0b resolved (native capture or recorded workaround).
- [ ] Schema materialized exactly per §3 (Ponder tables + offchain migrations + §8.5 tables), `pg_trgm` GIN indexes present, startup assertions live (pg_trgm, V3 addrs non-zero, WETH constant, chainId 4663).
- [ ] `creator` + `creator_fee_bps=0` on every token from the first indexed event (§7); `real_token_reserves` maintained per X-4; `balance`/`holder_count` written **only** by the Transfer handler.
- [ ] Candle series proven **continuous across a simulated graduation**; all six intervals; **X-2** price orientation correct for both token orderings; `rebuild` byte-equal to incremental.
- [ ] Confirmation tracker live: watermarks, ranged materialization, O(1) `global:confirmations` broadcast, `reorg` notice; transitions tested (monotonicity, boundary, reorg-consistency).
- [ ] Metadata verification: match / mismatch / unfetched tested; shared canonicalizer + shared fixtures; re-verify schedule + `control:reverify` seam; never `match` without a byte compare.
- [ ] Redis publish from every handler with **zero** hot-path DB/RPC reads (import-graph asserted); backfill suppresses publishes; `<500ms` budget respected.
- [ ] **(v1.2)** §8.5 bot/farm heuristics as SQL views/jobs over `trades`+`transfers`; `address_flags` + `token_flow_stats` populated (ranges); own-Router whitelisted; wash excluded from organic volume; advisory-only; weekly hood.fun `competitor_snapshots` job runs.
- [ ] No hardcoded market metrics anywhere; USD only via `eth_usd_snapshots`; competitor snapshots source+timestamped.
- [ ] I-1/I-3 indexer legs green (`dev:stack`/`dev:health`); `bun test apps/indexer` green; any §12.15 event-shape divergence escalated, not patched.
