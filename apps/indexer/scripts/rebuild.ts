/**
 * Derived-table rebuild (indexer.md §4.4, M2-5 sub-task 5h) — the reorg
 * deep-recovery path and CI byte-equality check.
 *
 * Candles, `balances`, and the denormalized `tokens` counters (last_price_eth,
 * volume_eth_24h, trade_count, holder_count) are DERIVED data. This script
 * truncates them and replays the RAW `trades` + `transfers` streams in a single
 * merged `(block_number, log_index)` order — exactly the order Ponder processed
 * them incrementally — through the SAME pure engines the handlers use
 * (`CandleStore`, `BalanceLedger`), then writes the result back. Because the
 * engines are the single source of math, `rebuild` output is byte-equal to the
 * incremental output (proven on the fixture set by the Vitest suite).
 *
 * Runs offline (safe while live indexing is paused). Second-pass script;
 * requires `pg` from node_modules. Invoke: `bun run rebuild`.
 */
import { Pool, type PoolClient } from "pg";
import { loadConfig } from "../src/config";
import { CandleStore } from "../src/candles";
import { BalanceLedger } from "../src/balances";

const DAY = 86_400;

interface TradeRaw {
  token: string;
  trader: string;
  venue: string;
  isBuy: boolean;
  ethAmount: bigint;
  tokenAmount: bigint;
  feeEth: bigint;
  price: number;
  block: number;
  ts: number;
  log: number;
}

interface TransferRaw {
  token: string;
  from: string;
  to: string;
  value: bigint;
  block: number;
  ts: number;
  log: number;
}

type Merged =
  | ({ kind: "trade" } & TradeRaw)
  | ({ kind: "transfer" } & TransferRaw);

async function fetchAll(client: PoolClient): Promise<{ trades: TradeRaw[]; transfers: TransferRaw[] }> {
  const t = await client.query(
    `SELECT token_address, trader, venue, is_buy, eth_amount, token_amount, fee_eth,
            price_eth, block_number, block_timestamp, log_index
       FROM trades ORDER BY block_number, log_index`,
  );
  const tr = await client.query(
    `SELECT token_address, from_address, to_address, value, block_number, block_timestamp, log_index
       FROM transfers ORDER BY block_number, log_index`,
  );
  return {
    trades: t.rows.map((r) => ({
      token: r.token_address,
      trader: r.trader,
      venue: r.venue,
      isBuy: r.is_buy,
      ethAmount: BigInt(r.eth_amount),
      tokenAmount: BigInt(r.token_amount),
      feeEth: BigInt(r.fee_eth),
      price: Number(r.price_eth),
      block: Number(r.block_number),
      ts: Number(r.block_timestamp),
      log: Number(r.log_index),
    })),
    transfers: tr.rows.map((r) => ({
      token: r.token_address,
      from: r.from_address,
      to: r.to_address,
      value: BigInt(r.value),
      block: Number(r.block_number),
      ts: Number(r.block_timestamp),
      log: Number(r.log_index),
    })),
  };
}

/** Replay merged raw events through the pure engines — mirrors the handlers. */
export function replay(trades: TradeRaw[], transfers: TransferRaw[]) {
  const merged: Merged[] = [
    ...trades.map((t) => ({ kind: "trade" as const, ...t })),
    ...transfers.map((t) => ({ kind: "transfer" as const, ...t })),
  ].sort((a, b) => (a.block !== b.block ? a.block - b.block : a.log - b.log));

  const candles = new CandleStore();
  const ledger = new BalanceLedger();
  const perToken = new Map<string, { lastPrice: number; tradeCount: number; maxTs: number }>();

  for (const ev of merged) {
    if (ev.kind === "trade") {
      candles.apply({
        tokenAddress: ev.token,
        price: ev.price,
        volumeEth: ev.ethAmount,
        volumeToken: ev.tokenAmount,
        blockNumber: ev.block,
        blockTimestamp: ev.ts,
        logIndex: ev.log,
      });
      if (ev.isBuy) ledger.applyCostBasisBuy(ev.token, ev.trader, ev.tokenAmount, ev.ethAmount, ev.ts);
      else ledger.applyCostBasisSell(ev.token, ev.trader, ev.tokenAmount, ev.ethAmount - ev.feeEth, ev.ts);
      const pt = perToken.get(ev.token) ?? { lastPrice: 0, tradeCount: 0, maxTs: 0 };
      pt.lastPrice = ev.price;
      pt.tradeCount += 1;
      pt.maxTs = Math.max(pt.maxTs, ev.ts);
      perToken.set(ev.token, pt);
    } else {
      ledger.applyTransfer(ev.token, ev.from, ev.to, ev.value, ev.ts);
    }
  }

  // 24h volume window per token, referenced to that token's latest trade ts.
  const volume24h = new Map<string, bigint>();
  for (const t of trades) {
    const pt = perToken.get(t.token);
    if (!pt) continue;
    if (t.ts >= pt.maxTs - DAY) volume24h.set(t.token, (volume24h.get(t.token) ?? 0n) + t.ethAmount);
  }

  return { candles, ledger, perToken, volume24h };
}

async function writeBack(
  client: PoolClient,
  result: ReturnType<typeof replay>,
): Promise<void> {
  const { candles, ledger, perToken, volume24h } = result;

  await client.query("BEGIN");
  try {
    await client.query("TRUNCATE candles");
    for (const c of candles.rows()) {
      await client.query(
        `INSERT INTO candles (token_address, interval, bucket_start, open, high, low, close,
             volume_eth, volume_token, trade_count, last_block_number, last_log_index)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          c.token_address, c.interval, c.bucket_start, c.open, c.high, c.low, c.close,
          c.volume_eth, c.volume_token, c.trade_count, c.last_block_number, c.last_log_index,
        ],
      );
    }

    // balances: balance + holder truth from Transfers, cost-basis from Trades.
    await client.query("TRUNCATE balances");
    for (const { token, holder, state } of ledger.entries()) {
      await client.query(
        `INSERT INTO balances (token_address, holder, balance, total_bought_tokens, total_sold_tokens,
             total_eth_in, total_eth_out, first_seen_at, last_active_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          token, holder, state.balance.toString(), state.totalBought.toString(), state.totalSold.toString(),
          state.ethIn.toString(), state.ethOut.toString(), state.firstSeenAt, state.lastActiveAt,
        ],
      );
    }

    // denormalized tokens counters (last_price_eth, volume_eth_24h, trade_count, holder_count).
    const allTokens = new Set<string>([...perToken.keys(), ...ledger.tokens()]);
    for (const token of allTokens) {
      const pt = perToken.get(token);
      await client.query(
        `UPDATE tokens SET last_price_eth = $2, volume_eth_24h = $3, trade_count = $4, holder_count = $5
           WHERE address = $1`,
        [
          token,
          pt ? pt.lastPrice : null,
          (volume24h.get(token) ?? 0n).toString(),
          pt ? pt.tradeCount : 0,
          ledger.getHolderCount(token),
        ],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error("[rebuild] DATABASE_URL is required");
  const schema = config.databaseSchema ?? "public";
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO "${schema}"`);
      console.log("[rebuild] loading raw trades + transfers…");
      const { trades, transfers } = await fetchAll(client);
      console.log(`[rebuild] replaying ${trades.length} trades + ${transfers.length} transfers…`);
      const result = replay(trades, transfers);
      await writeBack(client, result);
      console.log("[rebuild] OK — candles/balances/token counters rebuilt from raw events.");
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

// Only run when invoked directly (the `replay` export is imported by tests).
if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
