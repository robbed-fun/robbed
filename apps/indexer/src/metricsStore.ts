/**
 * DB-derived gate-7 snapshot (M2-12). Computes the series that are cheapest to
 * read straight from Postgres at SCRAPE time (not the hot path): head lag,
 * metadata verification counts, the 2%-fee-ceiling invariant, and ETH/USD
 * snapshot age. The in-process instruments (publish latency, confirmation lag,
 * fee-recipient/graduation invariants, cluster share) are fed by hooks elsewhere.
 *
 * Every query is wrapped so a transient DB error degrades a single series to its
 * last value rather than failing the whole /metrics scrape. Read-only — never
 * writes, never gates chain state.
 */
import { Pool } from "pg";
import { MAX_TRADE_FEE_BPS } from "@robbed/shared";
import type { Gate7DbSnapshot } from "./metrics";

export interface MetricsStore {
  snapshot(): Promise<Gate7DbSnapshot>;
}

export function createPgMetricsStore(pool: Pool, schema: string): MetricsStore {
  const scalar = async (text: string): Promise<string | null> => {
    const r = await pool.query(text);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const v = Object.values(row)[0];
    return v === null || v === undefined ? null : String(v);
  };

  return {
    async snapshot(): Promise<Gate7DbSnapshot> {
      const sc = `"${schema}"`;
      const nowSec = Math.floor(Date.now() / 1000);

      // Head lag: seconds since the newest indexed event (max across event tables).
      let headLagSeconds: number | null = null;
      try {
        const ts = await scalar(
          `SELECT MAX(ts) AS ts FROM (
             SELECT block_timestamp AS ts FROM ${sc}.trades
             UNION ALL SELECT block_timestamp FROM ${sc}.transfers
             UNION ALL SELECT created_at FROM ${sc}.tokens
           ) u`,
        );
        if (ts !== null) headLagSeconds = Math.max(0, nowSec - Number(ts));
      } catch {
        /* keep null — series simply omitted this scrape */
      }

      const countOr0 = async (text: string): Promise<number> => {
        try {
          const v = await scalar(text);
          return v === null ? 0 : Number(v);
        } catch {
          return 0;
        }
      };

      const metadataUnfetched = await countOr0(
        `SELECT count(*) FROM metadata_verifications WHERE status = 'unfetched'`,
      );
      const metadataMismatch = await countOr0(
        `SELECT count(*) FROM metadata_verifications WHERE status = 'mismatch'`,
      );
      // 2% fee ceiling (§6.4): fee_eth / eth_amount > MAX_TRADE_FEE_BPS/10000.
      const tradeFeeCeilingBreaches = await countOr0(
        `SELECT count(*) FROM ${sc}.trades
          WHERE venue = 'curve' AND eth_amount > 0
            AND fee_eth * 10000 > eth_amount * ${MAX_TRADE_FEE_BPS}`,
      );

      let ethUsdSnapshotAgeSeconds: number | null = null;
      try {
        const age = await scalar(
          `SELECT EXTRACT(EPOCH FROM now() - MAX(fetched_at)) FROM eth_usd_snapshots`,
        );
        if (age !== null) ethUsdSnapshotAgeSeconds = Math.max(0, Math.floor(Number(age)));
      } catch {
        /* keep null */
      }

      return {
        headLagSeconds,
        metadataUnfetched,
        metadataMismatch,
        tradeFeeCeilingBreaches,
        ethUsdSnapshotAgeSeconds,
      };
    },
  };
}
