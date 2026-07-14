import type { CreatorTokenClaimable, UsdValue } from "@robbed/shared";

/**
 * A single post-graduation creator-fee bucket to render + claim.
 * Post-grad V3 fees are split 50/50 treasury/creator at `LPFeeVault.collect()`
 * and credited in the pull-payment `CreatorVault` as a per-`(creator, ERC20)`
 * balance — the aggregated WETH leg (buy-side) OR a graduated launch-token leg
 * (sell-side), each claimed on its own via `claimERC20(creator, token)`.
 *
 * Both the API rows (`creatorTokenClaimableSchema`) and the on-chain
 * `tokenBalanceOf` fallback map to THIS view shape so the widget renders one way.
 * It is a presentation projection, NOT a redeclaration of the shared wire schema
 * (anti-drift rule 2): the authoritative row shape stays `CreatorTokenClaimable`.
 */
export interface CreatorTokenBucket {
  creator: string;
  /** ERC20 the balance is denominated in — a graduated launch token OR canonical WETH. */
  token: string;
  /** The `CreatorVault` custodying the balance. */
  vault: string;
  /** Live claimable, wei of `token` (`CreatorVault.tokenBalanceOf`, AUTHORITATIVE). */
  claimable: string;
  /** USD mirror — populated only for the WETH leg; null for launch-token legs. */
  claimableUsd: UsdValue | null;
  /** True when `token` is canonical WETH (the aggregated buy-leg bucket). */
  isWeth: boolean;
}

/** Project an API `CreatorTokenClaimable` row onto the render/claim view shape. */
export function bucketFromApiRow(row: CreatorTokenClaimable, weth: string): CreatorTokenBucket {
  return {
    creator: row.creator,
    token: row.token,
    vault: row.vault,
    claimable: row.claimable,
    claimableUsd: row.claimableUsd,
    isWeth: row.token.toLowerCase() === weth.toLowerCase(),
  };
}

/** True when a bucket has a nonzero live balance — zero-balance buckets are hidden. */
export function hasClaimable(b: CreatorTokenBucket): boolean {
  try {
    return BigInt(b.claimable) > 0n;
  } catch {
    return false;
  }
}

/** Stable display order: the aggregated WETH leg first, then launch-token legs. */
export function sortBuckets(rows: CreatorTokenBucket[]): CreatorTokenBucket[] {
  return [...rows].sort((a, b) => (a.isWeth === b.isWeth ? 0 : a.isWeth ? -1 : 1));
}
