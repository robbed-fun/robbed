# apps/indexer — Ponder indexer (owner: robbed-indexer)

Ponder → Postgres (+pg_trgm) → Redis pub/sub → Bun WS fanout (sidecar). Design docs: `docs/developers/indexer.md`, `docs/developers/architecture.md` (off-chain architecture; confirmation states soft-confirmed → posted-to-L1 → finalized).

- `bun run dev` (ponder dev) · `bun test` · `bun run typecheck` · `bun run codegen` (`ponder-env.d.ts` is COMMITTED per Ponder docs)
- `bun run migrate` / `bun run rebuild` — schema/backfill helpers; `.ponder/` and `generated/` are cache (ignored)
- ABIs + event types come from `@robbed/shared` (committed codegen) — never paste ABIs locally.
- The WS message taxonomy (trade / candle / launch / graduated / confirmations / metadata_verified / fee_collected) is a `@robbed/shared` union — adding a variant is a robbed-shared change first, then a handler here.
- Contract addresses + `START_BLOCK` flow from the deploy artifact per compose stack (see the headers in `docker-compose*.yml`); after a redeploy, the affected stack's indexer must be rebuilt + restarted or new tokens never appear on discovery pages.
