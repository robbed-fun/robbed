/**
 * Public API for the `creator` entity (FSD reference/public-api) — the
 * creator-fee domain : claimable reads (pre-grad ETH leg +
 * post-grad per-`(creator, ERC20)` legs) + the two CLAIM tx models.
 *
 * The CLAIM UI (with the shared ConfirmationBadge) lives in
 * `widgets/creator-earnings`, NOT here: the badge is in `entities/trade` and an
 * entity may not import a sibling entity, so the widget composes the two.
 */
export { getCreatorClaimable, useCreatorClaimable } from "./api/claimable";
export { getCreatorCurveClaimable, useCreatorCurveClaimable } from "./api/curve-claimable";
export {
  getCreatorTokenClaimable,
  useCreatorTokenClaimable,
} from "./api/token-claimable";
export { useOnchainCreatorTokenBuckets } from "./api/onchain-token-claimable";
export {
  useClaimCreatorFee,
  humanizeClaimError,
  type ClaimPhase,
  type ClaimState,
} from "./model/use-claim-creator-fee";
export {
  useClaimCreatorTokenFee,
  useClaimCreatorTokenFees,
} from "./model/use-claim-creator-token-fee";
export {
  type CreatorTokenBucket,
  bucketFromApiRow,
  hasClaimable,
  sortBuckets,
} from "./lib/token-bucket";
