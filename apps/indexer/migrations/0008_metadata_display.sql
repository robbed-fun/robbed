-- 0008 — display fields extracted from fetched metadata JSON (indexer.md
-- step 5, reworked per the OI-11 verdict: external UPDATEs into the
-- Ponder-managed `tokens` table are unsafe on ponder 0.16.8 (indexing-store
-- cache flushes silently revert them) and forbidden by Ponder's docs, so the
-- "extract into tokens" step lands on the OFFCHAIN, verifier-owned
-- `metadata_verifications` sidecar instead — the same read-derivation pattern
-- as the confirmation-state rework. The API card/detail projections
-- COALESCE these over the (permanently-null) tokens.image_url/description/links.
--
-- Written ONLY by the metadata verifier (sole-writer invariant, X-9), and only
-- from a fetch that succeeded AND strict-parsed as the shared canonical doc
-- (`tokenMetadataSchema`) — any verification verdict (match OR mismatch)
-- populates them; the Trust panel badges mismatches (indexer.md).
-- Idempotent; applies to schema `public` (offchain core).
ALTER TABLE metadata_verifications
  ADD COLUMN IF NOT EXISTS image_url   text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS links       jsonb;
