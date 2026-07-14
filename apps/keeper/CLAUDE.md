# apps/keeper — auto-graduation keeper (owner: robbed-keeper)

Small Bun service that fires the permissionless `BondingCurve.graduate()` (caller reward ≥10× gas) so no curve sits locked in `ReadyToGraduate` (a deterministic two-way lock, *not* a pause; see `docs/developers/contracts.md`). Zero contract changes; zero new authority; DB access is read-only.

- Detection: on-chain `GraduationReady` via one topic-filtered viem WS subscription (primary) + a Postgres fallback sweep of the indexer's `tokens` table every `KEEPER_POLL_MS`. `REDIS_URL` is accepted but **reserved** — detection never depends on it (see `src/chain.ts` DETECTION DECISION).
- Correctness bar (README, the Correctness section): idempotent one-attempt-per-curve; re-read `phase()` before every send; "someone else graduated first" = SUCCESS; persistent revert = donation-brick alert (`graduation_failed_persistent`) + cooldown — never hot-loop, never work around (periphery fixes are robbed-contracts' job).
- `bun run dev` · `bun test` (pure core — no live chain/DB) · `bun run typecheck`
- Config: copy `.env.example` → `.env`; startup fails closed on missing vars or a chain-id mismatch. Ops runbook: `docs/developers/runbooks/keeper.md`.
- ABIs/types from `@robbed/shared` only; cross-service changes (e.g. a Redis readiness channel, indexer columns) are proposed to robbed-shared/robbed-indexer, never made here.
