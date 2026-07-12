-- 0003 — §5.1 search: pg_trgm GIN indexes over name, ticker, contract address,
-- creator address (indexer.md §3.1). The API's single search endpoint consumes
-- these.
--
-- ORDERING (important): these indexes are on the Ponder-managed `tokens` table,
-- so they can only be created AFTER Ponder has created that table. The migrate
-- runner applies this file with its search_path set to the Ponder schema
-- (DATABASE_SCHEMA) and SKIPS it when `tokens` does not yet exist; the INDEXER
-- SIDECAR BOOT (src/offchainMigrations.ts, Ponder :setup hook — after Ponder's
-- own table migration) re-applies it automatically on every start, so no manual
-- re-run is needed. All CREATE INDEX IF NOT EXISTS → idempotent, safe to re-run.
--
-- CAVEAT (flagged for ops, M4): Ponder's zero-downtime deploys can create a new
-- versioned schema; re-run `bun run migrate` after such a deploy to re-apply
-- these GIN indexes in the new schema. (Decision: kept in a raw migration per
-- the M2-4 task spec rather than the ponder.schema.ts DSL, whose per-column
-- operator-class GIN syntax could not be pinned from public docs — a raw
-- CREATE INDEX is guaranteed-correct and isolates blast radius.)
CREATE INDEX IF NOT EXISTS tokens_name_trgm_idx    ON tokens USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tokens_ticker_trgm_idx  ON tokens USING gin (ticker gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tokens_address_trgm_idx ON tokens USING gin (address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tokens_creator_trgm_idx ON tokens USING gin (creator gin_trgm_ops);
