/**
 * Creator-fee handlers (spec §7 / §12.63, ADDITIVE Phase-2 leg). Maintains the
 * reorg-tracked `creator_claimable` roll-up from the on-chain creator-fee events.
 *
 *   BondingCurve:CreatorFeesSwept  → ACCRUED   (always registered — curve source)
 *   CreatorVault:CreatorFeeClaimed → CLAIMED   (vault source; optional)
 *   CreatorVault:CreatorFeeDeposited → vault corroboration (vault source; optional)
 *
 * The CreatorVault source is registered ONLY when `config.creatorVault` resolves
 * (absent on v1 deployments — see ponder.config.ts). The handler bindings are
 * guarded by the SAME condition so a treasury-only deployment never binds a
 * handler to an unregistered contract (which Ponder would reject at startup):
 * `ponder.on("CreatorVault:…")` is called only inside `if (config.creatorVault)`.
 *
 * All accrual math is the PURE `creatorClaimable.ts` ledger (unit-tested); this
 * file is thin wiring + the idempotent upsert. Dedup/idempotency is inherent: the
 * aggregate is a monotonic Σ maintained via `onConflictDoUpdate`, and Ponder
 * reverts the whole table on reorg (rebuildable from events).
 */
import { ponder } from "ponder:registry";
import { creatorClaimable } from "ponder:schema";
import type { CreatorFeeClaimedEvent, CreatorFeeDepositedEvent } from "@robbed/shared";
import { config } from "../runtime";
import { lower } from "../ids";
import {
  type CreatorClaimableState,
  applyClaim,
  applyDeposit,
  applySweep,
  updateColumns,
} from "../creatorClaimable";

/** Ponder row (camelCase columns) → the pure ledger's in-memory state. */
function toState(row: {
  creator: string;
  vault: string;
  totalAccruedEth: bigint;
  totalClaimedEth: bigint;
  claimableEth: bigint;
  lastClaimAt: bigint | null;
  updatedAt: string;
}): CreatorClaimableState {
  return {
    creator: row.creator,
    vault: row.vault,
    totalAccruedEth: row.totalAccruedEth,
    totalClaimedEth: row.totalClaimedEth,
    claimableEth: row.claimableEth,
    lastClaimAt: row.lastClaimAt,
    updatedAt: row.updatedAt,
  };
}

// ── CreatorFeesSwept — accrued source (BondingCurve, always registered) ──────
ponder.on("BondingCurve:CreatorFeesSwept", async ({ event, context }) => {
  const creator = lower(event.args.creator);
  const vault = lower(event.args.vault);
  const amount = event.args.amount;
  const ts = event.block.timestamp;
  await context.db
    .insert(creatorClaimable)
    .values(applySweep(null, creator, vault, amount, ts))
    .onConflictDoUpdate((row) => updateColumns(applySweep(toState(row), creator, vault, amount, ts)));
});

// ── CreatorVault leg — registered ONLY when the vault address resolves ───────
// NOTE (types): the CreatorVault source is OPTIONAL in ponder.config.ts, so its
// entry is a union member and Ponder types these two events' `event.args`
// loosely (`Record<string, unknown> | unknown[]`). We anchor the args to the
// AUTHORITATIVE shared decoded structs (`CreatorFeeDepositedEvent` /
// `CreatorFeeClaimedEvent`, transcribed from the ABI in @robbed/shared) rather
// than re-typing — the shape stays single-sourced; the cast is the only seam the
// optional-source pattern needs. `event.log.address` / `event.block` stay typed.
if (config.creatorVault) {
  // CreatorFeeDeposited — vault ledger credit; corroborates the vault address
  // (event.log.address) without changing accrued (avoids double-count with the
  // sweep, the accrued source of record). See creatorClaimable.ts decision note.
  ponder.on("CreatorVault:CreatorFeeDeposited", async ({ event, context }) => {
    const args = event.args as unknown as CreatorFeeDepositedEvent;
    const creator = lower(args.creator);
    const vault = lower(event.log.address);
    const ts = event.block.timestamp;
    await context.db
      .insert(creatorClaimable)
      .values(applyDeposit(null, creator, vault, ts))
      .onConflictDoUpdate((row) => updateColumns(applyDeposit(toState(row), creator, vault, ts)));
  });

  // CreatorFeeClaimed — payout; debits claimed + stamps last_claim_at.
  ponder.on("CreatorVault:CreatorFeeClaimed", async ({ event, context }) => {
    const args = event.args as unknown as CreatorFeeClaimedEvent;
    const creator = lower(args.creator);
    const vault = lower(event.log.address);
    const amount = args.amount;
    const ts = event.block.timestamp;
    await context.db
      .insert(creatorClaimable)
      .values(applyClaim(null, creator, vault, amount, ts))
      .onConflictDoUpdate((row) => updateColumns(applyClaim(toState(row), creator, vault, amount, ts)));
  });
}
