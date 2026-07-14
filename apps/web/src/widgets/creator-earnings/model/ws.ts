import type { WsMessage } from "@robbed/shared";

/**
 * Pure reconcile decision for the post-graduation creator-fee WS types (spec
 * ) `creator_fee_split` (accrual changed at `LPFeeVault.collect()`) and
 * `creator_fee_claimed` (a bucket was pulled). Returns TRUE only when the message
 * concerns THIS creator.
 *
 * Reconcile-to-indexed-truth: on TRUE the widget refetches the AUTHORITATIVE
 * claimable (the `tokenBalanceOf` mirror), reconciling any optimistic claim state
 * to indexed truth — an accrual bumps the balance up, a confirmed claim settles it
 * down. A split/claim for a DIFFERENT creator is ignored so it can never clobber
 * the subject's cache; any other message type is ignored. Kept pure so the
 * reconcile rule is unit-provable without React/WS wiring.
 */
export function isCreatorFeeUpdateFor(msg: WsMessage, creator: string): boolean {
  if (msg.type !== "creator_fee_split" && msg.type !== "creator_fee_claimed") return false;
  return msg.data.creator.toLowerCase() === creator.toLowerCase();
}
