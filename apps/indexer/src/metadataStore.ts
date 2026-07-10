/**
 * Postgres concrete for the metadata verifier (M2-7). The verifier is the SOLE
 * writer of `metadata_verifications` (X-9); this store also SEEDS unverified
 * tokens via a LEFT JOIN discovery pass (a token with no verification row is
 * "due" and gets its first `unfetched`/verdict write here — keeping the
 * sole-writer invariant while the `TokenCreated` handler only writes the Ponder
 * `tokens` row). `tokens` lives in the Ponder schema; `metadata_verifications`
 * in stable `public` (§7.3) — the query spans both.
 */
import { Pool } from "pg";
import {
  reverifyDelayMs,
  type DueVerification,
  type MetadataStore,
  type VerificationWrite,
} from "./metadata";

interface CandidateRow {
  token_address: string;
  onchain_hash: string;
  metadata_uri: string | null;
  attempts: number;
  status: "match" | "mismatch" | "unfetched" | null;
  last_attempt_ms: string | null;
}

export function createPgMetadataStore(pool: Pool, schema: string): MetadataStore {
  return {
    async selectDue(nowMs: number, limit: number): Promise<DueVerification[]> {
      // Coarse SQL filter (unseeded, or last attempt older than the min backoff
      // step); the EXACT schedule is applied in JS via the shared `reverifyDelayMs`
      // so the cadence rule lives in one place (metadata.ts).
      const r = await pool.query(
        `SELECT t.address AS token_address,
                t.metadata_hash AS onchain_hash,
                t.metadata_uri AS metadata_uri,
                COALESCE(v.attempts, 0) AS attempts,
                v.status AS status,
                (EXTRACT(EPOCH FROM v.last_attempt_at) * 1000) AS last_attempt_ms
           FROM "${schema}".tokens t
           LEFT JOIN metadata_verifications v ON v.token_address = t.address
          WHERE v.token_address IS NULL
             OR v.last_attempt_at IS NULL
             OR v.last_attempt_at < now() - interval '1 minute'
          ORDER BY t.block_number
          LIMIT $1`,
        [Math.max(limit * 4, limit)],
      );
      const out: DueVerification[] = [];
      for (const row of r.rows as CandidateRow[]) {
        const due = isDue(nowMs, row);
        if (!due) continue;
        out.push({
          tokenAddress: row.token_address,
          onchainHash: row.onchain_hash,
          metadataUri: row.metadata_uri,
          attempts: Number(row.attempts),
        });
        if (out.length >= limit) break;
      }
      return out;
    },

    async writeVerification(write: VerificationWrite): Promise<void> {
      const { outcome } = write;
      const verifiedAt = outcome.status === "unfetched" ? null : write.nowIso;
      await pool.query(
        `INSERT INTO metadata_verifications
           (token_address, onchain_hash, computed_hash, status, fetched_body_sha256,
            attempts, last_attempt_at, last_error, verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9::timestamptz)
         ON CONFLICT (token_address) DO UPDATE SET
           onchain_hash = EXCLUDED.onchain_hash,
           computed_hash = EXCLUDED.computed_hash,
           status = EXCLUDED.status,
           fetched_body_sha256 = EXCLUDED.fetched_body_sha256,
           attempts = EXCLUDED.attempts,
           last_attempt_at = EXCLUDED.last_attempt_at,
           last_error = EXCLUDED.last_error,
           verified_at = EXCLUDED.verified_at`,
        [
          write.tokenAddress,
          write.onchainHash.toLowerCase(),
          outcome.computedHash,
          outcome.status,
          outcome.bodySha256,
          write.attempts,
          write.nowIso,
          outcome.error,
          verifiedAt,
        ],
      );
    },

    async requeue(tokenAddress: string): Promise<void> {
      // Make the row immediately due; if it doesn't exist yet the LEFT JOIN
      // discovery already treats it as due, so this is a harmless no-op there.
      await pool.query(
        `UPDATE metadata_verifications SET status = 'unfetched', last_attempt_at = NULL
          WHERE token_address = $1`,
        [tokenAddress.toLowerCase()],
      );
    },
  };
}

/** Exact due-ness using the shared schedule (single source of cadence). */
function isDue(nowMs: number, row: CandidateRow): boolean {
  if (row.status === null) return true; // never verified → seed
  if (row.last_attempt_ms === null) return true;
  const delay = reverifyDelayMs(row.status, Number(row.attempts));
  return nowMs - Number(row.last_attempt_ms) >= delay;
}
