-- ROBBED_ local Postgres init (M2-0). Runs once, against POSTGRES_DB, only when the data
-- directory is empty (postgres docker-entrypoint semantics). Idempotent regardless.
--
-- pg_trgm powers the search GIN indexes (name/ticker/address/creator trgm indexes,
-- indexer.md). The indexer's startup assertion (indexer.md) requires the extension
-- to already exist, so it is created here at DB bootstrap.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
