-- 002 — API-owned `comments` table (Phase-2 off-chain comments; spec §12.63b).
--
-- Comments are OFF-CHAIN (not a Ponder-indexed chain event): SIWE-authored,
-- §8.4-moderation-gated, per-token, flat. Like `moderation_status` /
-- `moderation_audit_log`, this is an API-WRITTEN sidecar table living in the
-- STABLE `public` schema (no FK to Ponder-managed, schema-versioned tables), so
-- it survives Ponder schema redeploys. Run once at deploy; idempotent.
--
-- Column notes:
--   * moderation_status REUSES the moderation queue's visibility enum verbatim
--     (text + CHECK IN ('visible','pending_review','hidden')) — the SAME shape as
--     moderation_status.visibility (001) and @robbed/shared moderationVisibilitySchema.
--     No new moderation enum is invented (task constraint). Public GET lists
--     visible + pending_review; hidden is excluded (pending_review REMAINS LISTED,
--     §12.21). A "delete" is a moderation-hide, never a physical row delete.
--   * created_at is an INTEGER unix-seconds column (server insert time), NOT a
--     timestamptz: it is BOTH the shared `Comment.createdAt` (unix seconds, api-
--     types commentBaseSchema) AND the keyset sort key, so an integer column keeps
--     the DTO value and the cursor bit-exactly comparable (mirrors the indexer's
--     integer `block_timestamp` convention) with no epoch-extraction ambiguity.
--   * author is the SIWE-authenticated poster (lowercased address); NEVER client-
--     supplied — the API sets it from the session (task constraint / shared DTO).

CREATE TABLE IF NOT EXISTS comments (
  id                bigserial PRIMARY KEY,
  token_address     text    NOT NULL,
  author            text    NOT NULL,
  body              text    NOT NULL,
  moderation_status text    NOT NULL DEFAULT 'visible'
                    CHECK (moderation_status IN ('visible','pending_review','hidden')),
  created_at        bigint  NOT NULL  -- unix seconds, server insert time
);

-- Keyset page index: newest-first per token via (created_at DESC, id DESC) with the
-- token_address prefix (the exact ORDER BY + keyset predicate the GET list runs).
-- Columns are (token_address, created_at, id) per the feature spec; DESC ordering
-- aligns the physical index with the newest-first scan so no extra sort is needed.
CREATE INDEX IF NOT EXISTS comments_token_created_idx
  ON comments (token_address, created_at DESC, id DESC);

-- ── role grants (adjust role names to deploy; §7 boundary) ───────────────────
-- The RW role writes this API-owned table; the RO role never does. Mirrors the
-- 001 grant block (commented — deploy substitutes the concrete role names).
--   GRANT SELECT, INSERT ON comments TO robbed_api_rw;
--   GRANT SELECT ON comments TO robbed_api_ro;
--   GRANT USAGE, SELECT ON SEQUENCE comments_id_seq TO robbed_api_rw;
