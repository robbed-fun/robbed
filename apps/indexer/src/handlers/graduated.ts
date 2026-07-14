/**
 * Graduated handler (indexer.md, M2-5 sub-task 5c).
 *
 * Inserts the `graduations` row (single-fire per token — dedup on the
 * `token_address` PK, so a second `Graduated` is a no-op), flips `tokens.
 * graduated`/`v3_pool_address`/`graduated_at`, caches `token_is_token0`
 * (`token < WETH`, X-2 orientation), and registers the pool in the in-memory
 * routing registry for the Swap/Collect handlers. Ponder itself begins indexing
 * the pool's Swaps via the `factory(Graduated.pool)` source in ponder.config.ts.
 */
import { ponder } from "ponder:registry";
import { graduations, tokens } from "ponder:schema";
// Chain's WETH from the registry-resolved config — the shared
// WETH_ADDRESS constant is mainnet-only and MUST NOT decide token0 ordering here.
import { config } from "../runtime";
import { eventId, lower } from "../ids";
import { tokenIsToken0 } from "../price";
import { graduationRegistry } from "../graduationRegistry";
import { publishGraduated } from "../publish";
import { incGraduationDoubleFire } from "../metrics";

ponder.on("V3Migrator:Graduated", async ({ event, context }) => {
  const tokenAddress = lower(event.args.token);

  // Single-fire: a second Graduated for the same token is a no-op (gate-2).
  const existing = await context.db.find(graduations, { tokenAddress });
  if (existing) {
    incGraduationDoubleFire(); // gate-7 invariant page — advisory metric only
    return;
  }

  const poolAddress = lower(event.args.pool);
  const isToken0 = tokenIsToken0(tokenAddress, config.weth);

  await context.db.insert(graduations).values({
    tokenAddress,
    poolAddress,
    lpTokenId: event.args.tokenId,
    tokenIsToken0: isToken0,
    ethToLp: event.args.wethInPosition,
    tokensToLp: event.args.tokensInPosition,
    graduationFeeEth: event.args.graduationFee,
    caller: lower(event.args.caller),
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  });

  await context.db.update(tokens, { address: tokenAddress }).set({
    graduated: true,
    v3PoolAddress: poolAddress,
    graduatedAt: event.block.timestamp,
  });

  graduationRegistry.register({
    tokenAddress,
    poolAddress,
    lpTokenId: event.args.tokenId,
    tokenIsToken0: isToken0,
  });

  // Redis publish → Trust panel venue switch + Discover.
  publishGraduated({
    token: tokenAddress,
    pool: poolAddress,
    blockNumber: Number(event.block.number),
    ts: Number(event.block.timestamp),
  });
});
