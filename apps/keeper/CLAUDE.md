# apps/keeper — auto-graduation keeper (owner: robbed-keeper)

Small Bun service that fires permissionless housekeeping calls: `BondingCurve.graduate()` (caller reward ≥10× gas) so no curve sits locked in `ReadyToGraduate`, `BondingCurve.sweepFees()` for pre-grad treasury fees, and `LPFeeVault.collect(tokenId)` for post-grad V3 fee splits. Zero contract changes; zero new authority; DB access is read-only.

- Detection: on-chain `GraduationReady` via one topic-filtered viem WS subscription (primary) + a Postgres fallback sweep of the indexer's `tokens` table every `KEEPER_POLL_MS`. `REDIS_URL` is accepted but **reserved** — detection never depends on it (see `src/chain.ts` DETECTION DECISION).
- Correctness bar (README, the Correctness section): idempotent one-attempt-per-curve; re-read `phase()` before every send; "someone else graduated first" = SUCCESS; persistent revert = donation-brick alert (`graduation_failed_persistent`) + cooldown — never hot-loop, never work around (periphery fixes are robbed-contracts' job).
- LP fee collection: simulate `LPFeeVault.collect(tokenId)` first, then send only when the WETH leg crosses threshold or a nonzero fee is due by age. The contract hardcodes Safe/CreatorVault routing; the keeper cannot redirect funds.
- `bun run dev` · `bun test` (pure core — no live chain/DB) · `bun run typecheck`
- Config: copy `.env.example` → `.env`; startup fails closed on missing vars or a chain-id mismatch. Ops runbook: `docs/developers/runbooks/keeper.md`.
- ABIs/types from `@robbed/shared` only; cross-service changes (e.g. a Redis readiness channel, indexer columns) are proposed to robbed-shared/robbed-indexer, never made here.
