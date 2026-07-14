/**
 * Trade handler — curve child (indexer.md, M2-5 sub-task 5b).
 *
 * Inserts a `trades` row (`venue='curve'`), updates live `tokens` state, applies
 * X-4 `real_token_reserves` maintenance, writes ONLY cost-basis columns on
 * `balances` (never `balance`/`holder_count` — X-4 balance-write ownership; the
 * Transfer handler owns those), and folds the trade into all six candles.
 *
 * Price uses the POST-trade virtual reserves carried in the event → zero
 * hot-path RPC reads. Idempotent: dedup on the `trades` (tx,log) id so the
 * `tokens`/`balances`/candle increments run exactly once.
 */
import { ponder } from "ponder:registry";
import { balances, tokens, trades } from "ponder:schema";
import { config } from "../runtime";
import { curveRegistry } from "../curveRegistry";
import { eventId, lower } from "../ids";
import { curvePriceEth } from "../price";
import { upsertCandlesForTrade } from "./candlesDb";
import { publishCandle, publishGate, publishTrade } from "../publish";
import { observePublishToHeadMs } from "../metrics";

ponder.on("BondingCurve:Trade", async ({ event, context }) => {
  const id = eventId(event.transaction.hash, event.log.logIndex);

  // Dedup guard: re-delivery is a no-op (protects the derived increments).
  const existingTrade = await context.db.find(trades, { id });
  if (existingTrade) return;

  // Resolve token from the emitting curve (event.log.address).
  await curveRegistry.hydrateOnce(async () => {
    const rows = (await context.db.sql.select().from(tokens)) as Array<{ address: string; curveAddress: string }>;
    return rows.map((r) => ({ curve: r.curveAddress, token: r.address }));
  });
  const tokenAddress = curveRegistry.lookup(event.log.address);
  if (!tokenAddress) return; // factory guarantees this resolves; defensive skip.

  const trader = lower(event.args.trader);
  const isBuy = event.args.isBuy;
  const ethAmount = event.args.ethAmount; // GROSS (incl. fee)
  const tokenAmount = event.args.tokenAmount;
  const fee = event.args.fee;
  const virtualEth = event.args.virtualEthReserves;
  const virtualToken = event.args.virtualTokenReserves;
  const realEth = event.args.realEthReserves;
  const price = curvePriceEth(virtualEth, virtualToken);
  const ts = event.block.timestamp;

  await context.db.insert(trades).values({
    id,
    tokenAddress,
    trader,
    venue: "curve",
    isBuy,
    ethAmount,
    tokenAmount,
    feeEth: fee,
    priceEth: price,
    blockNumber: event.block.number,
    blockTimestamp: ts,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  });

  // Live curve state + X-4 real_token_reserves delta (−tokenAmount on buy).
  await context.db.update(tokens, { address: tokenAddress }).set((row) => ({
    virtualEth,
    virtualToken,
    realEthReserves: realEth,
    realTokenReserves: isBuy ? row.realTokenReserves - tokenAmount : row.realTokenReserves + tokenAmount,
    lastPriceEth: price,
    volumeEth24h: row.volumeEth24h + ethAmount, // best-effort live; decay job recomputes
    tradeCount: row.tradeCount + 1n,
  }));

  // Cost-basis ONLY (X-4). Disjoint columns from Transfer's balance/holder_count.
  const ethNet = ethAmount > fee ? ethAmount - fee : 0n;
  await context.db
    .insert(balances)
    .values({
      tokenAddress,
      holder: trader,
      balance: 0n, // never authoritative here; the Transfer handler owns `balance`
      totalBoughtTokens: isBuy ? tokenAmount : 0n,
      totalSoldTokens: isBuy ? 0n : tokenAmount,
      totalEthIn: isBuy ? ethAmount : 0n,
      totalEthOut: isBuy ? 0n : ethNet,
      firstSeenAt: ts,
      lastActiveAt: ts,
    })
    .onConflictDoUpdate((row) => ({
      totalBoughtTokens: isBuy ? row.totalBoughtTokens + tokenAmount : row.totalBoughtTokens,
      totalSoldTokens: isBuy ? row.totalSoldTokens : row.totalSoldTokens + tokenAmount,
      totalEthIn: isBuy ? row.totalEthIn + ethAmount : row.totalEthIn,
      totalEthOut: isBuy ? row.totalEthOut : row.totalEthOut + ethNet,
      lastActiveAt: ts,
    }));

  const candleRows = await upsertCandlesForTrade(context.db, {
    tokenAddress,
    price,
    volumeEth: ethAmount,
    volumeToken: tokenAmount,
    blockNumber: Number(event.block.number),
    blockTimestamp: Number(ts),
    logIndex: event.log.logIndex,
  });

  // Redis publish — fire-and-forget, gated to realtime, no DB read.
  publishTrade({
    token: tokenAddress,
    trader,
    venue: "curve",
    isBuy,
    ethAmount,
    tokenAmount,
    feeEth: fee,
    priceEth: price,
    blockNumber: Number(event.block.number),
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    blockTimestamp: Number(ts),
    confirmationState: "soft_confirmed",
  });
  // Gate-7 : observe publish→head latency, realtime only (backfill excluded).
  if (publishGate.enabled) observePublishToHeadMs(Date.now() - Number(ts) * 1000);
  for (const c of candleRows) {
    publishCandle({
      token: tokenAddress,
      interval: c.interval,
      bucketStart: c.bucket_start,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volumeEth: BigInt(c.volume_eth),
      tradeCount: c.trade_count,
      blockTimestamp: Number(ts),
    });
  }
});
