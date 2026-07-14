/**
 * Creator-fee claimable roll-up — PURE aggregation logic.
 *
 * Per-creator pull-payment ledger, rebuildable from the on-chain creator-fee
 * events, maintained in the reorg-tracked Ponder table `creator_claimable`
 * (ponder.schema.ts). Materializes the shared `CreatorClaimableRow`:
 *   total_accrued_eth = Σ accrued  (from `CreatorFeesSwept`, the curve→vault push)
 *   total_claimed_eth = Σ claimed  (from `CreatorFeeClaimed`, the payout)
 *   claimable_eth     = accrued − claimed   (event-derived MIRROR; the API serves
 *                       the live `CreatorVault.balanceOf` as the authoritative value)
 *
 * DECISION (decide-it-yourself; basis recorded) — the accrued source is
 * `CreatorFeesSwept` (task item 2), NOT `CreatorFeeDeposited`. The two are equal
 * by contract design (a sweep calls `vault.deposit`, so Σ swept == Σ deposited —
 * db-rows.ts) and fire in the SAME transaction, so summing EITHER is correct;
 * summing BOTH would double-count. We pick ONE (`CreatorFeesSwept`) for accrued
 * and treat `CreatorFeeDeposited` as vault-address corroboration only (see
 * `applyDeposit`). Either choice yields `claimable_eth == balanceOf` because
 * both reduce to Σswept − Σclaimed. Flagged for the architect: the db-rows
 * comment's PRIMARY wording is Σ `CreatorFeeDeposited` — same value, different
 * summation source; noted, not self-diverged.
 *
 * A reorg reverts this table with Ponder's own handling (it is an onchainTable),
 * so no offchain rollup job can leave it stale — the boring, can't-silently-
 * corrupt choice over an offchain-maintained aggregate.
 *
 * PURE + unit-tested: no Ponder/DB imports. Handlers (handlers/creatorFees.ts)
 * feed the previous row state in and persist the returned next state.
 */

/** In-memory shape of one `creator_claimable` row (camelCase JS keys, as Ponder rows). */
export interface CreatorClaimableState {
  creator: string;
  vault: string;
  totalAccruedEth: bigint;
  totalClaimedEth: bigint;
  claimableEth: bigint;
  lastClaimAt: bigint | null;
  updatedAt: string;
}

/** Block-timestamp (unix seconds) → ISO-8601 — deterministic (no wall clock ⇒ replay-stable). */
export function isoFromUnix(tsSec: bigint): string {
  return new Date(Number(tsSec) * 1000).toISOString();
}

/** accrued − claimed, floored at 0 (a paid-out balance can never read negative). */
export function computeClaimable(accrued: bigint, claimed: bigint): bigint {
  const c = accrued - claimed;
  return c > 0n ? c : 0n;
}

/**
 * `CreatorFeesSwept` (curve → vault) — ACCRUED source. `vault` is the event's
 * indexed `vault` arg. Creates the row when absent (prev = null).
 */
export function applySweep(
  prev: CreatorClaimableState | null,
  creator: string,
  vault: string,
  amount: bigint,
  tsSec: bigint,
): CreatorClaimableState {
  const totalAccruedEth = (prev?.totalAccruedEth ?? 0n) + amount;
  const totalClaimedEth = prev?.totalClaimedEth ?? 0n;
  return {
    creator,
    vault, // the sweep names its destination vault
    totalAccruedEth,
    totalClaimedEth,
    claimableEth: computeClaimable(totalAccruedEth, totalClaimedEth),
    lastClaimAt: prev?.lastClaimAt ?? null,
    updatedAt: isoFromUnix(tsSec),
  };
}

/**
 * `CreatorFeeClaimed` (vault payout) — CLAIMED source; stamps `last_claim_at`.
 * `vault` is the emitting vault (`event.log.address`).
 */
export function applyClaim(
  prev: CreatorClaimableState | null,
  creator: string,
  vault: string,
  amount: bigint,
  tsSec: bigint,
): CreatorClaimableState {
  const totalAccruedEth = prev?.totalAccruedEth ?? 0n;
  const totalClaimedEth = (prev?.totalClaimedEth ?? 0n) + amount;
  return {
    creator,
    vault: prev?.vault ?? vault,
    totalAccruedEth,
    totalClaimedEth,
    claimableEth: computeClaimable(totalAccruedEth, totalClaimedEth),
    lastClaimAt: tsSec,
    updatedAt: isoFromUnix(tsSec),
  };
}

/**
 * `CreatorFeeDeposited` (vault ledger credit) — vault-address CORROBORATION
 * only; does NOT change accrued (that is `CreatorFeesSwept`'s job — avoids
 * double-counting the equal-by-design amount). Ensures the row + authoritative
 * vault address exist even if a deposit is observed before its sweep (they share
 * a tx; log order is not guaranteed).
 */
export function applyDeposit(
  prev: CreatorClaimableState | null,
  creator: string,
  vault: string,
  tsSec: bigint,
): CreatorClaimableState {
  const totalAccruedEth = prev?.totalAccruedEth ?? 0n;
  const totalClaimedEth = prev?.totalClaimedEth ?? 0n;
  return {
    creator,
    vault, // authoritative: the emitting vault
    totalAccruedEth,
    totalClaimedEth,
    claimableEth: computeClaimable(totalAccruedEth, totalClaimedEth),
    lastClaimAt: prev?.lastClaimAt ?? null,
    updatedAt: isoFromUnix(tsSec),
  };
}

/** The non-PK columns of a state — what `onConflictDoUpdate` returns (creator is the PK). */
export function updateColumns(s: CreatorClaimableState) {
  return {
    vault: s.vault,
    totalAccruedEth: s.totalAccruedEth,
    totalClaimedEth: s.totalClaimedEth,
    claimableEth: s.claimableEth,
    lastClaimAt: s.lastClaimAt,
    updatedAt: s.updatedAt,
  };
}
