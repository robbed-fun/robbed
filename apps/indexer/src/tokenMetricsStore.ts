/**
 * Postgres batched read for the `token_metrics` coalescer (D-70). Kept OUT of
 * `tokenMetrics.ts` so that module stays DB-free (a handler importing
 * `enqueueTokenMetrics` pulls in no pg client). This is the ONE side-effecting
 * boundary: one query per flush returns each pending token's post-write row fields
 * + the 24h anchor inputs.
 *
 * The anchor sub-selects MIRROR the API card projection's batched anchor read
 * (`apps/api/src/lib/db.bun.ts` `getChange24hAnchors`) — earliest-trade price +
 * the single 1h candle at/before the now−24h cutoff (LATERAL LIMIT 1) — so the
 * indexer's live `change24hPct` and the REST card's value are computed from the
 * same inputs through the same shared resolver (`computeChange24hPct`). The token
 * row fields (last_price_eth, total_supply, reserves, graduation_eth,
 * volume_eth_24h, graduated, created_at) are added to the same query so a whole
 * batch is ONE round trip. Read-only; never writes; never gates chain state.
 *
 * The `pnl_*`/Ponder tables live in the configured schema (search_path), same as
 * `pnl/store.ts` — set search_path once per connection, then query unqualified.
 */
import { Pool } from "pg";
import { ponderSearchPath } from "./dbSearchPath";
import type { AnchorCandleRow, MetricsCoalescerStore, MetricsInputRow } from "./tokenMetrics";

const DAY_SECONDS = 86_400;

export function createPgMetricsCoalescerStore(pool: Pool, schema: string): MetricsCoalescerStore {
  return {
    async readInputs(tokens: string[], nowSec: number): Promise<Map<string, MetricsInputRow>> {
      const out = new Map<string, MetricsInputRow>();
      if (tokens.length === 0) return out;
      const cutoff = nowSec - DAY_SECONDS;
      // $1..$n = token addresses, $(n+1) = 24h cutoff.
      const placeholders = tokens.map((_, i) => `$${i + 1}`).join(",");
      const cutoffParam = `$${tokens.length + 1}`;
      const client = await pool.connect();
      try {
        // Ponder tables live in the Ponder schema; candles/trades/tokens are all there.
        await client.query(`SET search_path TO ${ponderSearchPath(schema)}`);
        const text = `
          SELECT t.address, t.last_price_eth, t.total_supply, t.real_eth_reserves,
                 t.graduation_eth, t.volume_eth_24h, t.graduated, t.created_at,
                 (SELECT tr.price_eth FROM trades tr
                    WHERE tr.token_address = t.address
                    ORDER BY tr.block_number ASC, tr.log_index ASC LIMIT 1) AS first_trade_price,
                 ac.bucket_start AS anchor_bucket,
                 ac.close AS anchor_close
            FROM tokens t
            LEFT JOIN LATERAL (
              SELECT c.bucket_start, c.close FROM candles c
              WHERE c.token_address = t.address AND c.interval = '1h'
                AND c.bucket_start <= ${cutoffParam}
              ORDER BY c.bucket_start DESC LIMIT 1
            ) ac ON true
           WHERE t.address IN (${placeholders})`;
        const res = await client.query(text, [...tokens, cutoff]);
        for (const r of res.rows as Record<string, unknown>[]) {
          const hourCandles: AnchorCandleRow[] =
            r.anchor_close == null
              ? []
              : [{ bucket_start: Number(r.anchor_bucket), close: Number(r.anchor_close) }];
          const address = String(r.address);
          out.set(address, {
            token: address,
            lastPriceEth: r.last_price_eth == null ? null : Number(r.last_price_eth),
            totalSupply: String(r.total_supply ?? "0"),
            realEthReserves: String(r.real_eth_reserves ?? "0"),
            graduationEth: String(r.graduation_eth ?? "0"),
            volumeEth24h: String(r.volume_eth_24h ?? "0"),
            graduated: Boolean(r.graduated),
            createdAt: Number(r.created_at ?? 0),
            firstTradePrice: r.first_trade_price == null ? null : Number(r.first_trade_price),
            hourCandles,
          });
        }
      } finally {
        client.release();
      }
      return out;
    },
  };
}
