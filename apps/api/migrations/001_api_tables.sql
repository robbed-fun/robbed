-- API-owned tables + role split (api.md). The indexer owns and
-- creates every table in indexer.md EXCEPT the two the API writes:
-- * moderation_status (indexer.md declares the shape; written by the
--     API only — created here if the indexer has not, so the RW role can write)
--   * moderation_audit_log (API-only; NOT in packages/shared db-rows — FLAGGED
--     for robbed-shared: if any consumer needs the audit row shape, add it to
--     shared; today only the API reads/writes it)
--
-- Run once at deploy. Idempotent. The two Postgres roles referenced by the API
-- config (RO on indexer tables, RW on the tables below ONLY) are granted here.

-- ── moderation_status (offchain; indexer.md shape) ─────────────────────
CREATE TABLE IF NOT EXISTS moderation_status (
  token_address        text PRIMARY KEY,
  visibility           text NOT NULL DEFAULT 'visible'
                       CHECK (visibility IN ('visible','pending_review','hidden')),
  nsfw_score           real,
  csam_flag            boolean NOT NULL DEFAULT false,
  impersonation_flag   boolean NOT NULL DEFAULT false,
  impersonation_ticker text,
  reason               text,
  reviewed_by          text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moderation_status_visibility_idx ON moderation_status (visibility);

-- ── moderation_audit_log (API-only) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moderation_audit_log (
  id      bigserial PRIMARY KEY,
  actor   text        NOT NULL,
  action  text        NOT NULL,
  target  text        NOT NULL,
  reason  text,
  ts      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moderation_audit_log_ts_idx ON moderation_audit_log (id DESC);

-- ── role grants (adjust role names to deploy; boundary) ───────────────────
-- The RW role may write ONLY these two tables; it has SELECT on indexer tables
-- for the queue join. The RO role is SELECT-only everywhere.
--   GRANT SELECT ON ALL TABLES IN SCHEMA public TO robbed_api_ro;
--   GRANT SELECT ON ALL TABLES IN SCHEMA public TO robbed_api_rw;
--   GRANT INSERT, UPDATE, DELETE ON moderation_status, moderation_audit_log TO robbed_api_rw;
--   GRANT USAGE, SELECT ON SEQUENCE moderation_audit_log_id_seq TO robbed_api_rw;
