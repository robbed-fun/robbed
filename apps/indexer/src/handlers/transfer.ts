/**
 * LaunchToken Transfer handler — the SOLE source of balance truth (indexer.md
 *, M2-5 sub-task 5f; X-5).
 *
 * The emitting contract IS the token (`event.log.address`), so no lookup is
 * needed. The `transfers` row (keyed on the (tx,log) id) is the dedup anchor:
 * balance deltas + holder_count transitions run in the SAME handler, guarded by
 * that row's existence, so a re-delivered log is a no-op and the increments run
 * exactly once. This handler is the ONLY writer of `balances.balance` and
 * `tokens.holder_count`; Trade/Swap write only cost-basis (X-4). The zero
 * address is never tracked as a holder (mint source / burn sink).
 */
import { ponder } from "ponder:registry";
import { balances, tokens, transfers } from "ponder:schema";
import { eventId, lower } from "../ids";
import { holderCountDelta, isZeroAddress } from "../balances";

ponder.on("LaunchToken:Transfer", async ({ event, context }) => {
  const id = eventId(event.transaction.hash, event.log.logIndex);

  // Dedup anchor (X-5): if the transfer is already recorded, the balance
  // mutation already ran — no-op.
  const existing = await context.db.find(transfers, { id });
  if (existing) return;

  const tokenAddress = lower(event.log.address);
  const from = lower(event.args.from);
  const to = lower(event.args.to);
  const value = event.args.value;
  const ts = event.block.timestamp;

  await context.db.insert(transfers).values({
    id,
    tokenAddress,
    fromAddress: from,
    toAddress: to,
    value,
    blockNumber: event.block.number,
    blockTimestamp: ts,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  });

  let holderDelta = 0;

  // Debit sender (skip mint source).
  if (!isZeroAddress(from)) {
    const prev = await context.db.find(balances, { tokenAddress, holder: from });
    const prevBal = prev ? prev.balance : 0n;
    const nextBal = prevBal - value;
    holderDelta += holderCountDelta(prevBal, nextBal);
    if (prev) {
      await context.db
        .update(balances, { tokenAddress, holder: from })
        .set({ balance: nextBal, lastActiveAt: ts });
    } else {
      await context.db.insert(balances).values({
        tokenAddress,
        holder: from,
        balance: nextBal,
        firstSeenAt: ts,
        lastActiveAt: ts,
      });
    }
  }

  // Credit receiver (skip burn-to-zero sink).
  if (!isZeroAddress(to)) {
    const prev = await context.db.find(balances, { tokenAddress, holder: to });
    const prevBal = prev ? prev.balance : 0n;
    const nextBal = prevBal + value;
    holderDelta += holderCountDelta(prevBal, nextBal);
    if (prev) {
      await context.db
        .update(balances, { tokenAddress, holder: to })
        .set({ balance: nextBal, lastActiveAt: ts });
    } else {
      await context.db.insert(balances).values({
        tokenAddress,
        holder: to,
        balance: nextBal,
        firstSeenAt: ts,
        lastActiveAt: ts,
      });
    }
  }

  // holder_count is maintained ONLY here (X-4). Guard on the token existing.
  if (holderDelta !== 0) {
    const tk = await context.db.find(tokens, { address: tokenAddress });
    if (tk) {
      await context.db
        .update(tokens, { address: tokenAddress })
        .set({ holderCount: tk.holderCount + holderDelta });
    }
  }
});
