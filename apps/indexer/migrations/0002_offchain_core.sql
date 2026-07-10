-- 0002 — [offchain] side-process tables (indexer.md §3.8-§3.11, §7.3).
-- These are NOT Ponder-managed: they are written by the confirmation tracker
-- (M2-6), eth/usd poller, metadata verifier (M2-7), and the API's moderation
-- writes. They live in a STABLE schema (public) and must survive Ponder schema
-- redeploys, so they carry NO foreign key to Ponder-managed tables (whose
-- schema name is versioned). Column names/types mirror @robbed/shared db-rows.
-- All idempotent (CREATE TABLE IF NOT EXISTS).

-- §3.8 confirmation_watermarks — singleton (soft/posted/finalized boundaries).
CREATE TABLE IF NOT EXISTS confirmation_watermarks (
  id               integer PRIMARY KEY CHECK (id = 1),
  latest_block     bigint NOT NULL,
  safe_block       bigint NOT NULL,
  finalized_block  bigint NOT NULL,
  updated_at       timestamptz NOT NULL
);

-- §3.9 eth_usd_snapshots — USD is ONLY ever eth_value × latest snapshot (§2).
CREATE TABLE IF NOT EXISTS eth_usd_snapshots (
  fetched_at  timestamptz PRIMARY KEY,
  price_usd   numeric NOT NULL,
  source      text NOT NULL
);

-- §3.10 metadata_verifications — indexer-owned; verifier (M2-7) is sole writer.
CREATE TABLE IF NOT EXISTS metadata_verifications (
  token_address        text PRIMARY KEY,
  onchain_hash         text NOT NULL,
  computed_hash        text,
  status               text NOT NULL DEFAULT 'unfetched'
                       CHECK (status IN ('match','mismatch','unfetched')),
  fetched_body_sha256  text,
  attempts             integer NOT NULL DEFAULT 0,
  last_attempt_at      timestamptz,
  last_error           text,
  verified_at          timestamptz
);

-- §3.11 moderation_status — WRITTEN BY THE API (docs/services/api.md §4); the
-- indexer only reads it (list/search join). Created here IF NOT EXISTS so local
-- dev/tests can join before the API service provisions it; whoever runs first
-- wins (idempotent). Listing gating only — never touches chain state (§8.4).
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
