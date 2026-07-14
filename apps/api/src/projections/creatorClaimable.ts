/**
 * `creator_claimable` roll-up + live vault balance → the shared `CreatorClaimable`
 * DTO. The AUTHORITATIVE `claimableEth` is the live
 * `CreatorVault.balanceOf(creator)`; when unavailable (no RPC / read failed) it
 * falls back to the event-derived MIRROR (accrued − claimed, floored at 0) so a
 * figure is always served. USD is computed at request time from the latest
 * eth/usd snapshot — never a constant. Wire shape single-sourced in
 * @robbed/shared (`creatorClaimableSchema`), never redeclared.
 */
import type { CreatorClaimable, CreatorClaimableRow, UsdValue } from "@robbed/shared";

/** accrued − claimed, floored at 0 (mirror of the on-chain balance). */
export function claimableMirror(accruedEth: string, claimedEth: string): string {
  const c = BigInt(accruedEth || "0") - BigInt(claimedEth || "0");
  return (c > 0n ? c : 0n).toString();
}

export function toCreatorClaimable(input: {
  creator: string;
  vault: string;
  row: CreatorClaimableRow | null;
  /** Live `balanceOf` wei string, or null → fall back to the mirror. */
  liveBalanceEth: string | null;
  usd: (claimableEth: string) => UsdValue;
  asOf: string;
}): CreatorClaimable {
  const accrued = input.row?.total_accrued_eth ?? "0";
  const claimed = input.row?.total_claimed_eth ?? "0";
  const claimableEth = input.liveBalanceEth ?? claimableMirror(accrued, claimed);
  return {
    creator: input.creator.toLowerCase(),
    vault: input.vault.toLowerCase(),
    claimableEth,
    claimable: input.usd(claimableEth),
    totalAccruedEth: accrued,
    totalClaimedEth: claimed,
    asOf: input.asOf,
  };
}
