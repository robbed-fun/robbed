/**
 * V3 Swap handler — graduated pools only (indexer.md, M2-5 sub-task 5d).
 *
 * Inserts a `trades` row (`venue='v3'`, `fee_eth=0`) into the SAME unified table
 * as curve trades → venue-continuous candles by construction. Price via X-2
 * orientation (`v3PriceEth`): raw `(sqrtPriceX96/2^96)^2` is WETH-per-token when
 * the token is token0, inverted when it is token1. Direction from the pool-side
 * `amount0/amount1` signs (negative = flowing OUT to the recipient). Cost-basis
 * is best-effort for the recipient (OI-5 — often a router); `balance`/
 * `holder_count` are NOT written here (the Transfer handler owns them, X-4).
 */
import { ponder } from "ponder:registry";
import { balances, graduations, tokens, trades } from "ponder:schema";
import { eventId, lower } from "../ids";
import { v3PriceEth } from "../price";
import { graduationRegistry } from "../graduationRegistry";
import { upsertCandlesForTrade } from "./candlesDb";
import { publishCandle, publishGate, publishTrade } from "../publish";
import { enqueueTokenMetrics } from "../tokenMetrics";
import { observePublishToHeadMs } from "../metrics";

function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

ponder.on("UniswapV3Pool:Swap", async ({ event, context }) => {
  const id = eventId(event.transaction.hash, event.log.logIndex);
  const existing = await context.db.find(trades, { id });
  if (existing) return;

  // Resolve pool → token (+ orientation). Hydrate once after a restart.
  await graduationRegistry.hydrateOnce(async () => {
    const rows = (await context.db.sql.select().from(graduations)) as Array<{
      tokenAddress: string;
      poolAddress: string;
      lpTokenId: bigint;
      tokenIsToken0: boolean;
    }>;
    return rows.map((r) => ({
      tokenAddress: r.tokenAddress,
      poolAddress: r.poolAddress,
      lpTokenId: r.lpTokenId,
      tokenIsToken0: r.tokenIsToken0,
    }));
  });
  const grad = graduationRegistry.lookupByPool(event.log.address);
  if (!grad) return; // pool not graduated / not ours — defensive.

  const price = v3PriceEth(event.args.sqrtPriceX96, grad.tokenIsToken0);

  // amount0/amount1 are pool-perspective: positive = into pool, negative = out.
  const tokenAmountSigned = grad.tokenIsToken0 ? event.args.amount0 : event.args.amount1;
  const ethAmountSigned = grad.tokenIsToken0 ? event.args.amount1 : event.args.amount0;
  const isBuy = tokenAmountSigned < 0n; // token flowing OUT to recipient = buy
  const tokenAmount = abs(tokenAmountSigned);
  const ethAmount = abs(ethAmountSigned);
  const trader = lower(event.args.recipient);
  const ts = event.block.timestamp;

  await context.db.insert(trades).values({
    id,
    tokenAddress: grad.tokenAddress,
    trader,
    venue: "v3",
    isBuy,
    ethAmount,
    tokenAmount,
    feeEth: 0n, // fee lives in the pool; Collect tracks treasury accrual
    priceEth: price,
    blockNumber: event.block.number,
    blockTimestamp: ts,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  });

  await context.db.update(tokens, { address: grad.tokenAddress }).set((row) => ({
    lastPriceEth: price,
    volumeEth24h: row.volumeEth24h + ethAmount,
    tradeCount: row.tradeCount + 1n,
  }));

  // Cost-basis best-effort (OI-5); disjoint from balance/holder_count.
  await context.db
    .insert(balances)
    .values({
      tokenAddress: grad.tokenAddress,
      holder: trader,
      balance: 0n,
      totalBoughtTokens: isBuy ? tokenAmount : 0n,
      totalSoldTokens: isBuy ? 0n : tokenAmount,
      totalEthIn: isBuy ? ethAmount : 0n,
      totalEthOut: isBuy ? 0n : ethAmount,
      firstSeenAt: ts,
      lastActiveAt: ts,
    })
    .onConflictDoUpdate((row) => ({
      totalBoughtTokens: isBuy ? row.totalBoughtTokens + tokenAmount : row.totalBoughtTokens,
      totalSoldTokens: isBuy ? row.totalSoldTokens : row.totalSoldTokens + tokenAmount,
      totalEthIn: isBuy ? row.totalEthIn + ethAmount : row.totalEthIn,
      totalEthOut: isBuy ? row.totalEthOut : row.totalEthOut + ethAmount,
      lastActiveAt: ts,
    }));

  const candleRows = await upsertCandlesForTrade(context.db, {
    tokenAddress: grad.tokenAddress,
    price,
    volumeEth: ethAmount,
    volumeToken: tokenAmount,
    blockNumber: Number(event.block.number),
    blockTimestamp: Number(ts),
    logIndex: event.log.logIndex,
  });

  // Redis publish — same unified `trade`/`candle` messages as the curve venue
  // (venue-continuous by construction), fire-and-forget, no DB read.
  publishTrade({
    token: grad.tokenAddress,
    trader,
    venue: "v3",
    isBuy,
    ethAmount,
    tokenAmount,
    feeEth: 0n,
    priceEth: price,
    blockNumber: Number(event.block.number),
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    blockTimestamp: Number(ts),
    confirmationState: "soft_confirmed",
  });
  // Gate-7 : observe publish→head latency, realtime only (backfill excluded).
  if (publishGate.enabled) observePublishToHeadMs(Date.now() - Number(ts) * 1000);
  // D-70: THE gap this closes — a post-graduation swap now refreshes the card's
  // live aggregates (mcap/price/change24h) on GLOBAL_METRICS, coalesced per token.
  enqueueTokenMetrics({
    token: grad.tokenAddress,
    blockNumber: Number(event.block.number),
    blockTimestamp: Number(ts),
  });
  for (const c of candleRows) {
    publishCandle({
      token: grad.tokenAddress,
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
