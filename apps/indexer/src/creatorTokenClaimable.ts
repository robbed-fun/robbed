/**
 * Post-graduation creator-fee split roll-up — PURE aggregation logic.
 *
 * The pre-grad creator leg (native ETH, `creatorClaimable.ts`) has a
 * POST-GRAD half: the graduated V3 pool's 1% fees are split 50/50 creator/treasury
 * at `LPFeeVault.collect(tokenId)`. Custody is Option B (LANDED) the
 * creator share is credited in the pull-payment `CreatorVault` as a per-`(creator,
 * ERC20-token)` balance via `depositERC20(creator, token, share)`, where `token` is
 * a graduated LAUNCH TOKEN (sell-leg) or canonical WETH (buy-leg) — NOT unwrapped to
 * ETH. Claimed per ERC20 via `claimERC20(creator, token)`; read live via
 * `tokenBalanceOf(creator, token)`.
 *
 * This module maintains the reorg-tracked Ponder table `creator_token_claimable`
 * (ponder.schema.ts), materializing the shared `CreatorTokenClaimableRow`
 * (@robbed/shared) per `(creator, token)`:
 *   total_accrued = Σ CreatorTokenDeposited.amount   (the split's landing per leg)
 *   total_claimed = Σ CreatorTokenClaimed.amount     (the pull-payment payout)
 *   claimable     = accrued − claimed                (event-derived MIRROR; the API
 *                   serves the live `tokenBalanceOf` as the authoritative value)
 *
 * DECISION (decide-it-yourself; basis recorded) — the ACCRUED source is
 * `CreatorTokenDeposited`, NOT `FeesSplit`. `FeesSplit` (LPFeeVault) carries the
 * creator legs in RAW pool ordering aggregated per V3 position; `CreatorTokenDeposited`
 * (CreatorVault) already carries the CONCRETE per-`(creator, token)` ERC20 amount that
 * the claim entrypoint keys on 1:1 — so summing it needs no orientation resolution and
 * matches `CreatorTokenClaimableRow`'s documented definition byte-for-byte. `FeesSplit`
 * fires in the SAME transaction and is used ONLY to publish the aggregated
 * `creator_fee_split` WS message (both beneficiaries, token/weth legs); it never feeds
 * this ledger, so no double-count is possible. Contrast the pre-grad leg, where
 * `CreatorFeesSwept` (not the vault deposit) was chosen as accrued because the deposit
 * there was a redundant same-tx corroboration — here the deposit IS the concrete,
 * non-redundant per-token credit.
 *
 * A reorg reverts the table via Ponder's own onchainTable handling, so no offchain
 * job can leave it stale — the boring, can't-silently-corrupt choice. PURE +
 * unit-tested: no Ponder/DB imports. Reuses the pre-grad leg's `computeClaimable` /
 * `isoFromUnix` (anti-drift: one flooring + timestamp convention across both legs).
 */
import { computeClaimable, isoFromUnix } from "./creatorClaimable";

/** In-memory shape of one `creator_token_claimable` row (camelCase JS keys, as Ponder rows). */
export interface CreatorTokenClaimableState {
  creator: string;
  token: string;
  vault: string;
  totalAccrued: bigint;
  totalClaimed: bigint;
  claimable: bigint;
  lastClaimAt: bigint | null;
  updatedAt: string;
}

/**
 * `CreatorTokenDeposited` (LPFeeVault split → CreatorVault) — ACCRUED source for the
 * `(creator, token)` bucket. `vault` is the emitting CreatorVault (`event.log.address`).
 * Creates the row when absent (prev = null).
 */
export function applyDeposit(
  prev: CreatorTokenClaimableState | null,
  creator: string,
  token: string,
  vault: string,
  amount: bigint,
  tsSec: bigint,
): CreatorTokenClaimableState {
  const totalAccrued = (prev?.totalAccrued ?? 0n) + amount;
  const totalClaimed = prev?.totalClaimed ?? 0n;
  return {
    creator,
    token,
    vault,
    totalAccrued,
    totalClaimed,
    claimable: computeClaimable(totalAccrued, totalClaimed),
    lastClaimAt: prev?.lastClaimAt ?? null,
    updatedAt: isoFromUnix(tsSec),
  };
}

/**
 * `CreatorTokenClaimed` (vault ERC20 payout) — CLAIMED source; stamps `last_claim_at`.
 * `vault` is the emitting CreatorVault (`event.log.address`); the prior row's vault
 * wins if the row already exists (a claim never redefines the custody address).
 */
export function applyClaim(
  prev: CreatorTokenClaimableState | null,
  creator: string,
  token: string,
  vault: string,
  amount: bigint,
  tsSec: bigint,
): CreatorTokenClaimableState {
  const totalAccrued = prev?.totalAccrued ?? 0n;
  const totalClaimed = (prev?.totalClaimed ?? 0n) + amount;
  return {
    creator,
    token,
    vault: prev?.vault ?? vault,
    totalAccrued,
    totalClaimed,
    claimable: computeClaimable(totalAccrued, totalClaimed),
    lastClaimAt: tsSec,
    updatedAt: isoFromUnix(tsSec),
  };
}

/** The non-PK columns of a state — what `onConflictDoUpdate` returns (`(creator, token)` is the PK). */
export function updateColumns(s: CreatorTokenClaimableState) {
  return {
    vault: s.vault,
    totalAccrued: s.totalAccrued,
    totalClaimed: s.totalClaimed,
    claimable: s.claimable,
    lastClaimAt: s.lastClaimAt,
    updatedAt: s.updatedAt,
  };
}

/** The four per-leg split amounts resolved from RAW pool ordering to token/weth. */
export interface ResolvedSplitLegs {
  creatorAmountToken: bigint;
  creatorAmountWeth: bigint;
  treasuryAmountToken: bigint;
  treasuryAmountWeth: bigint;
}

/**
 * Resolve a `FeesSplit`'s raw `{treasury,creator}{0,1}` legs to token/weth using the
 * token's cached `token_is_token0` orientation (the same orientation the V3 `Collect`
 * handler uses). When the launch token is token0, leg0 is the token leg and leg1 is
 * the WETH leg; otherwise the mapping flips. PURE (unit-tested) so the sign is pinned
 * by a test rather than asserted in prose.
 */
export function resolveSplitLegs(
  tokenIsToken0: boolean,
  legs: { treasury0: bigint; creator0: bigint; treasury1: bigint; creator1: bigint },
): ResolvedSplitLegs {
  return tokenIsToken0
    ? {
        creatorAmountToken: legs.creator0,
        creatorAmountWeth: legs.creator1,
        treasuryAmountToken: legs.treasury0,
        treasuryAmountWeth: legs.treasury1,
      }
    : {
        creatorAmountToken: legs.creator1,
        creatorAmountWeth: legs.creator0,
        treasuryAmountToken: legs.treasury1,
        treasuryAmountWeth: legs.treasury0,
      };
}
