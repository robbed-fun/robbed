/**
 * V3 Collect handler (indexer.md §3.5, M2-5 sub-task 5e).
 *
 * The NonfungiblePositionManager is shared and emits `Collect` for EVERY
 * position on chain, so the handler filters to `tokenId ∈ graduations.
 * lp_token_id` (our LPFeeVault positions) via the in-memory registry — zero
 * per-event DB reads in steady state. Amounts are oriented via the cached
 * `token_is_token0`. Feeds the treasury fee-accrual dashboard (§6.4, §8).
 *
 * M2-8: publishes `fee_collected` (X-6, `token:{addr}:events`) for the treasury
 * fee-accrual dashboard live updates, and raises the gate-7 `recipient !=
 * treasury` alert (§9.4) via the pure `feeRecipientAlert` decision.
 */
import { ponder } from "ponder:registry";
import { feeCollections, graduations } from "ponder:schema";
import { eventId, lower } from "../ids";
import { config } from "../runtime";
import { graduationRegistry } from "../graduationRegistry";
import { feeRecipientAlert } from "../alerts";
import { publishFeeCollected } from "../publish";
import { incFeeRecipientMismatch } from "../metrics";

ponder.on("V3PositionManager:Collect", async ({ event, context }) => {
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

  const grad = graduationRegistry.lookupByLpTokenId(event.args.tokenId);
  if (!grad) return; // not one of our LPFeeVault positions — ignore.

  const id = eventId(event.transaction.hash, event.log.logIndex);
  const existing = await context.db.find(feeCollections, { id });
  if (existing) return;

  // Orient collected amounts by cached pool orientation (X-2).
  const amountToken = grad.tokenIsToken0 ? event.args.amount0 : event.args.amount1;
  const amountWeth = grad.tokenIsToken0 ? event.args.amount1 : event.args.amount0;
  const recipient = lower(event.args.recipient);

  await context.db.insert(feeCollections).values({
    id,
    tokenAddress: grad.tokenAddress,
    poolAddress: grad.poolAddress,
    lpTokenId: event.args.tokenId,
    recipient,
    amountToken,
    amountWeth,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  });

  // Gate-7: a Collect to any non-treasury recipient pages immediately (§9.4).
  const alert = feeRecipientAlert(recipient, config.treasury, {
    token: grad.tokenAddress,
    txHash: event.transaction.hash,
  });
  if (alert) {
    incFeeRecipientMismatch(); // gate-7 metric (§9.4)
    console.error(alert.message);
  } else if (!config.treasury) {
    console.warn(`[gate-7] TREASURY_ADDRESS unset — Collect recipient ${recipient} not verified (token ${grad.tokenAddress})`);
  }

  // Redis publish → treasury fee-accrual dashboard live update (X-6, §3.5).
  publishFeeCollected({
    token: grad.tokenAddress,
    recipient,
    amountToken,
    amountWeth,
    blockNumber: Number(event.block.number),
    blockTimestamp: Number(event.block.timestamp),
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    confirmationState: "soft_confirmed",
  });
});
