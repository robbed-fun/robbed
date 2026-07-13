/**
 * Public API for the `creator` entity (FSD reference/public-api) — the
 * creator-fee domain (§7 / §12.63): the claimable read + the CLAIM tx model.
 *
 * The CLAIM UI (with the shared ConfirmationBadge) lives in
 * `widgets/creator-earnings`, NOT here: the badge is in `entities/trade` and an
 * entity may not import a sibling entity, so the widget composes the two.
 */
export { getCreatorClaimable, useCreatorClaimable } from "./api/claimable";
export {
  useClaimCreatorFee,
  type ClaimPhase,
  type ClaimState,
} from "./model/use-claim-creator-fee";
