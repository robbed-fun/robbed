/**
 * Postgres + RPC concretes for the confirmation tracker (M2-6). Kept OUT of
 * `confirmation.ts` so that module stays DB-free and fully unit-testable; here
 * live the two side-effecting boundaries: the `confirmation_watermarks`
 * read/write + ranged materialization (own `pg.Pool`, the §7.3-sanctioned single
 * external write into Ponder-managed tables), and the L2 block-tag poll (viem).
 */
import { Pool } from "pg";
import { createPublicClient, http, type PublicClient } from "viem";
import {
  materializationStatements,
  type ConfirmationStore,
  type ObservedTags,
  type TagFetcher,
  type WatermarkState,
} from "./confirmation";

/** Pg-backed `ConfirmationStore` — ranged `UPDATE`s + the watermark singleton. */
export function createPgConfirmationStore(pool: Pool, schema: string): ConfirmationStore {
  return {
    async loadWatermarks(): Promise<WatermarkState | null> {
      const r = await pool.query(
        `SELECT latest_block, safe_block, finalized_block FROM confirmation_watermarks WHERE id = 1`,
      );
      if (r.rows.length === 0) return null;
      const row = r.rows[0] as { latest_block: string; safe_block: string; finalized_block: string };
      return {
        latest: Number(row.latest_block),
        safe: Number(row.safe_block),
        finalized: Number(row.finalized_block),
      };
    },

    async saveWatermarks(wm: WatermarkState): Promise<void> {
      await pool.query(
        `INSERT INTO confirmation_watermarks (id, latest_block, safe_block, finalized_block, updated_at)
         VALUES (1, $1, $2, $3, now())
         ON CONFLICT (id) DO UPDATE
           SET latest_block = EXCLUDED.latest_block,
               safe_block = EXCLUDED.safe_block,
               finalized_block = EXCLUDED.finalized_block,
               updated_at = now()`,
        [wm.latest, wm.safe, wm.finalized],
      );
    },

    async materialize(wm: Pick<WatermarkState, "safe" | "finalized">): Promise<void> {
      // Ranged, monotonic, one indexed pass on block_number per statement.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const stmt of materializationStatements(schema, wm)) {
          await client.query(stmt.text, stmt.params);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * L2 block-tag fetcher (OI-8). Reads `latest`/`safe`/`finalized` block numbers
 * from the chain RPC. If the RPC rejects `safe`/`finalized` (unsupported on the
 * Robinhood RPC — OI-8 still OPEN), returns `null` so the tick no-ops and the
 * L1-watermark fallback (M2-3b) remains the documented seam. Never throws up.
 */
export function createRpcTagFetcher(rpcHttp: string): TagFetcher {
  const client: PublicClient = createPublicClient({ transport: http(rpcHttp) });
  let warnedUnsupported = false;
  return async (): Promise<ObservedTags | null> => {
    try {
      const [latest, safe, finalized] = await Promise.all([
        client.getBlock({ blockTag: "latest" }),
        client.getBlock({ blockTag: "safe" }),
        client.getBlock({ blockTag: "finalized" }),
      ]);
      return {
        latest: Number(latest.number),
        safe: Number(safe.number),
        finalized: Number(finalized.number),
      };
    } catch (err) {
      if (!warnedUnsupported) {
        warnedUnsupported = true;
        console.warn(
          "[confirmation tracker] RPC rejected safe/finalized tags (OI-8) — " +
            "tracker idle until the M2-3b L1-watermark fallback is wired:",
          err,
        );
      }
      return null;
    }
  };
}
