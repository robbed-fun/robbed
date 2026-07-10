-- 0001 — required Postgres extensions (indexer.md §2 startup assertion).
-- pg_trgm powers the §5.1 search GIN indexes (0003). Idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
