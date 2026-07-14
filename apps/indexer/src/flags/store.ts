/**
 * Postgres concrete for the bot/farm job (M2-13). Kept OUT of
 * `heuristics.ts` so that module stays DB-free and fully unit-testable. Here live
 * the two side-effecting boundaries: reading the `flow_*` views (0005_flow_views
 * .sql) into a `FlowInput`, and writing the results into `address_flags` +
 * `token_flow_stats` (the two offchain, indexer-owned side tables).
 *
 * Writes are a TRUNCATE + re-insert inside one transaction: the tables are
 * DERIVED and fully rebuildable from `trades`+`transfers`, so recomputing
 * the whole set each run is the boring, can't-silently-corrupt option (a stale
 * flag can never linger). Advisory only — never gates chain state.
 */
import { Pool, type PoolClient } from "pg";
import type { IndexerConfig } from "../config";
import type { FlowInput, FlowResult } from "./heuristics";

/**
 * Own-contract executor whitelist (heuristic 3 — never flagged `programmatic`).
 * Our Router/factory/migrator/NPM/swapRouter legitimately mediate trades. All
 * lowercased; undefined entries (optional router) are skipped.
 */
export function buildOwnContractWhitelist(config: IndexerConfig): Set<string> {
  const set = new Set<string>();
  const push = (a: string | undefined) => {
    if (a) set.add(a.toLowerCase());
  };
  push(config.router);
  push(config.curveFactory);
  push(config.migrator);
  push(config.v3Factory);
  push(config.v3PositionManager);
  // Chain's SwapRouter02 from the registry-resolved config — the
  // shared UNISWAP_V3 constant is mainnet-only.
  push(config.swapRouter02);
  return set;
}

/** Load/write boundary (Pg impl below; faked in the unit suite). */
export interface FlowStore {
  loadInput(): Promise<FlowInput>;
  writeResults(result: FlowResult, nowIso: string): Promise<void>;
}

export function createPgFlowStore(pool: Pool, schema: string): FlowStore {
  const q = async (client: PoolClient, text: string) => (await client.query(text)).rows;
  return {
    async loadInput(): Promise<FlowInput> {
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO "${schema}"`);
        const [firstInbound, firstBuys, programmatic, multiPoolExits, tradeAggs, clusterVol24h, holders] =
          await Promise.all([
            q(client, `SELECT address, funder, value_wei, funded_at_sec FROM flow_first_inbound`),
            q(client, `SELECT token, trader, first_buy_at_sec, token_created_at_sec FROM flow_first_buy`),
            q(client, `SELECT token, address, executor, recipient FROM flow_programmatic`),
            q(client, `SELECT address, block, pool_count FROM flow_multipool_exit`),
            q(client, `SELECT token, address, buy_eth_wei, sell_eth_wei, fee_wei FROM flow_trade_agg`),
            q(client, `SELECT token, address, vol_24h_wei FROM flow_cluster_vol_24h`),
            q(client, `SELECT token, holder FROM flow_holders`),
          ]);
        return {
          firstInbound: firstInbound.map((r) => ({
            address: r.address,
            funder: r.funder,
            valueWei: BigInt(r.value_wei),
            fundedAtSec: Number(r.funded_at_sec),
          })),
          firstBuys: firstBuys.map((r) => ({
            token: r.token,
            trader: r.trader,
            firstBuyAtSec: Number(r.first_buy_at_sec),
            tokenCreatedAtSec: Number(r.token_created_at_sec),
          })),
          programmatic: programmatic.map((r) => ({
            address: r.address,
            executor: r.executor,
            recipient: r.recipient,
          })),
          multiPoolExits: multiPoolExits.map((r) => ({
            address: r.address,
            block: Number(r.block),
            poolCount: Number(r.pool_count),
          })),
          tradeAggs: tradeAggs.map((r) => ({
            token: r.token,
            address: r.address,
            buyEthWei: BigInt(r.buy_eth_wei),
            sellEthWei: BigInt(r.sell_eth_wei),
            feeWei: BigInt(r.fee_wei),
          })),
          clusterVol24h: clusterVol24h.map((r) => ({
            token: r.token,
            address: r.address,
            vol24hWei: BigInt(r.vol_24h_wei),
          })),
          holders: holders.map((r) => ({ token: r.token, holder: r.holder })),
        };
      } finally {
        client.release();
      }
    },

    async writeResults(result: FlowResult, nowIso: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // address_flags + token_flow_stats live in stable `public` (no schema
        // prefix needed — they are search_path-independent side tables).
        await client.query("TRUNCATE address_flags");
        for (const af of result.addressFlags) {
          await client.query(
            `INSERT INTO address_flags (address, flags, cluster_id, updated_at)
             VALUES ($1, $2, $3, $4::timestamptz)`,
            [af.address, af.flags, af.clusterId, nowIso],
          );
        }
        await client.query("TRUNCATE token_flow_stats");
        for (const ts of result.tokenStats) {
          await client.query(
            `INSERT INTO token_flow_stats
               (token_address, organic_holder_pct_low, organic_holder_pct_high,
                organic_volume_pct, flagged_cluster_vol_pct_24h, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6::timestamptz)`,
            [
              ts.token,
              ts.organicHolderPctLow,
              ts.organicHolderPctHigh,
              ts.organicVolumePct,
              ts.flaggedClusterVolPct24h,
              nowIso,
            ],
          );
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
