/**
 * Post-graduation creator-fee split handlers (spec §12.69, ADDITIVE Phase-2 leg).
 *
 *   LPFeeVault:FeesSplit            → creator_fee_split WS (per launch token)  [WS-only]
 *   CreatorVault:CreatorTokenDeposited → ACCRUED  → creator_token_claimable roll-up
 *   CreatorVault:CreatorTokenClaimed   → CLAIMED  → roll-up + creator_fee_claimed WS
 *
 * All three sources are registered ONLY when `config.creatorVault` resolves (see
 * ponder.config.ts). The handler bindings are guarded by the SAME condition so a
 * treasury-only / v1 deployment never binds a handler to an unregistered contract
 * (Ponder rejects that at startup): `ponder.on(...)` is called only inside
 * `if (config.creatorVault)`.
 *
 * `FeesSplit` is WS-ONLY (no DB write): the roll-up's accrued source is the concrete
 * per-`(creator, token)` `CreatorTokenDeposited` (fires in the same tx), so persisting
 * the split too would be redundant — the split exists only to publish the aggregated
 * token/weth announcement. The launch token (channel key) + orientation are resolved
 * from `FeesSplit.tokenId` via the in-memory `graduationRegistry` (lp_token_id →
 * {token, token_is_token0}) — the SAME zero-DB-read routing the V3 `Collect` handler
 * uses; a one-time hydration covers a process restart.
 *
 * Accrual math is the PURE `creatorTokenClaimable.ts` ledger (unit-tested); this file
 * is thin wiring + the idempotent Σ upsert (`onConflictDoUpdate`, reverted whole on
 * reorg by Ponder — rebuildable from events).
 */
import { ponder } from "ponder:registry";
import { creatorTokenClaimable, graduations } from "ponder:schema";
import type {
  CreatorTokenClaimedEvent,
  CreatorTokenDepositedEvent,
  FeesSplitEvent,
} from "@robbed/shared";
import { config } from "../runtime";
import { lower } from "../ids";
import { graduationRegistry } from "../graduationRegistry";
import {
  type CreatorTokenClaimableState,
  applyClaim,
  applyDeposit,
  resolveSplitLegs,
  updateColumns,
} from "../creatorTokenClaimable";
import { publishCreatorFeeClaimed, publishCreatorFeeSplit } from "../publish";

/** Ponder row (camelCase columns) → the pure ledger's in-memory state. */
function toState(row: {
  creator: string;
  token: string;
  vault: string;
  totalAccrued: bigint;
  totalClaimed: bigint;
  claimable: bigint;
  lastClaimAt: bigint | null;
  updatedAt: string;
}): CreatorTokenClaimableState {
  return {
    creator: row.creator,
    token: row.token,
    vault: row.vault,
    totalAccrued: row.totalAccrued,
    totalClaimed: row.totalClaimed,
    claimable: row.claimable,
    lastClaimAt: row.lastClaimAt,
    updatedAt: row.updatedAt,
  };
}

// Sources are optional union members (ponder.config.ts), so Ponder types their
// `event.args` loosely. We anchor to the AUTHORITATIVE shared decoded structs rather
// than re-typing — single-sourced shapes; the cast is the only seam the optional-source
// pattern needs. `event.log`/`event.block`/`event.transaction` stay typed.
if (config.creatorVault) {
  // ── LPFeeVault:FeesSplit — the 50/50 split announcement (WS-only) ──────────
  ponder.on("LPFeeVault:FeesSplit", async ({ event, context }) => {
    const args = event.args as unknown as FeesSplitEvent;

    // Route lp_token_id → {launch token, orientation} with zero steady-state DB
    // reads (registry hydrated once from `graduations` on the first split/swap/
    // collect after a restart — Ponder resumes from a checkpoint, not old events).
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

    const grad = graduationRegistry.lookupByLpTokenId(args.tokenId);
    if (!grad) return; // not one of our LPFeeVault positions — ignore.

    // Resolve RAW pool ordering → token/weth via the cached orientation (X-2).
    const legs = resolveSplitLegs(grad.tokenIsToken0, {
      treasury0: args.treasury0,
      creator0: args.creator0,
      treasury1: args.treasury1,
      creator1: args.creator1,
    });

    publishCreatorFeeSplit({
      token: grad.tokenAddress,
      creator: lower(args.creator),
      creatorAmountToken: legs.creatorAmountToken,
      creatorAmountWeth: legs.creatorAmountWeth,
      treasuryAmountToken: legs.treasuryAmountToken,
      treasuryAmountWeth: legs.treasuryAmountWeth,
      blockNumber: Number(event.block.number),
      blockTimestamp: Number(event.block.timestamp),
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      confirmationState: "soft_confirmed",
    });
  });

  // ── CreatorVault:CreatorTokenDeposited — ACCRUED source for (creator, token) ─
  ponder.on("CreatorVault:CreatorTokenDeposited", async ({ event, context }) => {
    const args = event.args as unknown as CreatorTokenDepositedEvent;
    const creator = lower(args.creator);
    const token = lower(args.token);
    const vault = lower(event.log.address);
    const ts = event.block.timestamp;
    await context.db
      .insert(creatorTokenClaimable)
      .values(applyDeposit(null, creator, token, vault, args.amount, ts))
      .onConflictDoUpdate((row) =>
        updateColumns(applyDeposit(toState(row), creator, token, vault, args.amount, ts)),
      );
  });

  // ── CreatorVault:CreatorTokenClaimed — CLAIMED + creator_fee_claimed WS ─────
  ponder.on("CreatorVault:CreatorTokenClaimed", async ({ event, context }) => {
    const args = event.args as unknown as CreatorTokenClaimedEvent;
    const creator = lower(args.creator);
    const token = lower(args.token);
    const vault = lower(event.log.address);
    const ts = event.block.timestamp;
    await context.db
      .insert(creatorTokenClaimable)
      .values(applyClaim(null, creator, token, vault, args.amount, ts))
      .onConflictDoUpdate((row) =>
        updateColumns(applyClaim(toState(row), creator, token, vault, args.amount, ts)),
      );

    publishCreatorFeeClaimed({
      creator,
      token,
      amount: args.amount,
      blockNumber: Number(event.block.number),
      blockTimestamp: Number(event.block.timestamp),
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      confirmationState: "soft_confirmed",
    });
  });
}
