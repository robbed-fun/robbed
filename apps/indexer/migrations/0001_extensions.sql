-- 0001 — required Postgres extensions (indexer.md startup assertion).
-- pg_trgm powers the search GIN indexes (0003). Idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
