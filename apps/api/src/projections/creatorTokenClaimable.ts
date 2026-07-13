/**
 * `creator_token_claimable` roll-up + live vault ERC20 balance → the shared
 * `CreatorTokenClaimable` DTO (spec §12.69). The AUTHORITATIVE `claimable` is the live
 * `CreatorVault.tokenBalanceOf(creator, token)`; when unavailable (no RPC / read
 * failed) it falls back to the event-derived MIRROR (accrued − claimed, floored at 0)
 * so a figure is always served. `claimableUsd` is populated ONLY for the WETH leg
 * (ETH-priced, derived at request time §2) — a launch-token leg is an unpriceable
 * ERC20 ⇒ null (never a constant). Wire shape single-sourced in @robbed/shared
 * (`creatorTokenClaimableSchema`), never redeclared.
 */
import type { CreatorTokenClaimable, CreatorTokenClaimableRow, UsdValue } from "@robbed/shared";

/** accrued − claimed, floored at 0 (mirror of the on-chain `tokenBalanceOf`). */
export function claimableMirror(accrued: string, claimed: string): string {
  const c = BigInt(accrued || "0") - BigInt(claimed || "0");
  return (c > 0n ? c : 0n).toString();
}

export function toCreatorTokenClaimable(input: {
  creator: string;
  token: string;
  vault: string;
  row: CreatorTokenClaimableRow | null;
  /** Live `tokenBalanceOf` wei string, or null → fall back to the mirror. */
  liveClaimable: string | null;
  /** True iff `token` is the chain WETH — the only leg carrying a USD figure. */
  isWeth: boolean;
  /** Wei → USD (only invoked for the WETH leg). */
  usd: (claimable: string) => UsdValue;
  asOf: string;
}): CreatorTokenClaimable {
  const accrued = input.row?.total_accrued ?? "0";
  const claimed = input.row?.total_claimed ?? "0";
  const claimable = input.liveClaimable ?? claimableMirror(accrued, claimed);
  return {
    creator: input.creator.toLowerCase(),
    token: input.token.toLowerCase(),
    vault: input.vault.toLowerCase(),
    claimable,
    claimableUsd: input.isWeth ? input.usd(claimable) : null,
    totalAccrued: accrued,
    totalClaimed: claimed,
    asOf: input.asOf,
  };
}
