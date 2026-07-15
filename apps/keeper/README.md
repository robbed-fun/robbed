# @robbed/keeper — auto-graduation keeper

Small Bun service that makes graduation **automatic**. `BondingCurve.graduate()` is
permissionless and pays a caller reward that offsets its gas; the keeper
is the standing caller, so a curve does not sit locked in `ReadyToGraduate` waiting for
an altruist. Zero contract changes.

- **Ops runbook** (funding, alerts, key rotation): [`docs/developers/runbooks/keeper.md`](../../docs/developers/runbooks/keeper.md)
- **Architecture context**: [`docs/developers/architecture.md`](../../docs/developers/architecture.md)
- **Spec**: (the `ReadyToGraduate` two-way lock — a deterministic, permissionlessly-exitable state, *not* a pause), (caller reward ≥10× `graduate()` gas), (gas model), gate 7 (stuck-graduation monitoring).

## What it does

1. **Primary detection — on-chain `GraduationReady`.** viem `watchContractEvent({ eventName:'GraduationReady', poll:false })` opens one topic-filtered `eth_subscribe('logs')` over the Alchemy WS RPC across **all** curves (every `BondingCurve` emits it; `log.address` is the curve). Reacts within ~1–2 blocks.
2. **Fallback sweep — Postgres.** Every `KEEPER_POLL_MS` (default 15s) it queries the indexer's `tokens` table for `graduated = false AND real_eth_reserves >= graduation_eth` (the ReadyToGraduate-not-yet-graduated set, derived from existing indexed columns — no schema change; covered by the `progressIdx` index). Catches WS drops, restarts, and curves locked while the keeper was down.
3. **Execution.** Re-reads on-chain `phase()` before every send (idempotent); estimates gas node-side and sends with an explicit `gas = estimate × 2` capped at 30M (never a tight cap — `graduate()` mints a V3 position); waits for the receipt; retries with backoff (3 attempts).
4. **Treasury fee sweep.** Every `KEEPER_TREASURY_SWEEP_POLL_MS` (default 60s) it reads `BondingCurve.accruedFees()` for fee-bearing curves and calls permissionless `sweepFees()` when the balance reaches `KEEPER_TREASURY_SWEEP_MIN_WEI` (default 0.5 ETH) or when a nonzero balance has waited `KEEPER_TREASURY_SWEEP_MAX_AGE_MS` (default 24h). Funds go to the factory's live treasury Safe.
5. **Health.** `GET /healthz` reports last sweep time, in-flight/cooldown curves, treasury sweep metrics, and the cached wallet balance.

### Why on-chain detection (not the indexer's Redis)

The plan's first choice was to subscribe to a Redis/WS `GraduationReady` signal from the indexer. No such channel exists today (the taxonomy is trade / candle / launch / graduated / confirmations / metadata_verified / fee_collected), and adding one would need a new `graduation_ready` variant in the `@robbed/shared` WS union **and** a new indexer handler — a cross-service change owned by robbed-shared/architect, not the keeper. The on-chain event is the authoritative source and watching it directly is strictly fewer hops (chain→keeper vs chain→ponder→redis→keeper). `REDIS_URL` is accepted but **reserved** — detection does not depend on it. See `src/chain.ts` (`DETECTION DECISION`). If a Redis readiness fanout is later wanted, it is a robbed-shared/indexer change to be flagged.

## Correctness properties

- **Idempotent / no double-send** — an in-flight set keys one attempt per curve at a time; every attempt re-reads `phase()` before sending. A stale DB hint or event can never produce a tx against a curve that is already `Graduated` or still `Trading`.
- **"Already graduated by someone else" == SUCCESS** — after any revert (send / receipt / estimate) the keeper re-reads `phase()`; if it is now `Graduated`, whoever landed first won the reward — that is expected under a permissionless `graduate()`, not a failure.
- **Persistent revert == donation-brick alert** — if `graduate()` keeps reverting while the curve stays `ready`, the migrator's arb-back cannot restore the pool tick. After the retry budget the keeper emits a **distinct loud alert** (`level:"error"`, `event:"graduation_failed_persistent"`, `alert:"donation_brick_suspected"`) and sets a cooldown so it does **not** hot-loop. A corrector swap can restore the tick, so the sweep retries after the cooldown.
- **Never touches chain-listing/moderation state** — the keeper only calls the permissionless `graduate()`; its DB use is a read-only query.
- **No treasury authority** — `sweepFees()` is permissionless and sends only to the factory's treasury Safe; the keeper cannot redirect funds.

## Configuration

Copy `.env.example` → `.env`. Required: `KEEPER_RPC_URL`, `CHAIN_ID`, `KEEPER_PRIVATE_KEY`, `DATABASE_URL`. Startup fails closed on a missing/invalid var and on a chain-id mismatch vs the live RPC. Treasury fee sweeping is on by default and tunable via `KEEPER_TREASURY_SWEEP_*`. Full table + operational notes in the runbook.

## Run

```sh
bun run --hot src/index.ts   # dev (also the compose `keeper` service command)
bun run src/index.ts         # prod
bun test                     # unit tests (pure core — no live chain/DB)
```

## Layout

```
src/
  index.ts    entrypoint — wires detection + sweeps + balance-watch + /healthz, graceful shutdown
  keeper.ts   GraduationKeeper — the PURE orchestration core (idempotency, retry, revert classification)
  treasury-sweeper.ts  TreasuryFeeSweeper — PURE sweepFees() scheduler core
  chain.ts    viem ChainPort + the GraduationReady watch (DETECTION DECISION recorded here)
  db.ts       fallback-sweep query shape (pure); db.pg.ts   pg-backed DbPort
  gas.ts      gasWithBuffer (estimate×2, capped)     revert via chain.classifyError + phase re-read
  config.ts   env (zod, fail-closed)   metrics.ts   logger.ts   health.ts   types.ts (ports)
test/         gas / db / keeper / health unit tests (bun test) + fakes.ts
```

## Compose

- **dev** (`docker-compose.yml`): ON by default; RPC = anvil fork WS; signer = anvil account #4 (public dev key, outside the e2e roles).
- **testnet** (`docker-compose.testnet.yml`): ON; RPC = testnet (WS preferred); signer = a **funded** ops wallet via the gitignored root `.env` (`TESTNET_KEEPER_PRIVATE_KEY`, ~0.05 ETH, NOT the deployer).
- **mainnet** (`docker-compose.mainnet.yml`): ON by default for the local/public mainnet-profile stack; signer = a **funded** ops wallet via external secrets (`MAINNET_KEEPER_PRIVATE_KEY`, NOT the deployer).
