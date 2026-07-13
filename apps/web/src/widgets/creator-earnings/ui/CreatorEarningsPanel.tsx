"use client";

import type { CreatorClaimable } from "@robbed/shared";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useClaimCreatorFee, useCreatorClaimable } from "@/entities/creator";
import {
  ConfirmationBadge,
  type TradeDisplayState,
  displayStateForIndexed,
} from "@/entities/trade";
import { Button, MonoLabel, MonoText, UsdAmount } from "@/shared/ui";
import { qk } from "@/shared/lib/query-keys";
import { formatEthFromWei } from "@/shared/lib/format";
import type { ClaimState } from "@/entities/creator";

/**
 * Creator earnings widget (§7 / §12.63) — rendered on the Portfolio CREATED tab
 * for the CONNECTED user's OWN address only (`isSelf`). Shows the live claimable
 * balance (+ USD) and lifetime accrued/claimed, with a CLAIM button that calls
 * `CreatorVault.claim(creator)` and surfaces the shared confirmation TIERS via the
 * reused `ConfirmationBadge`.
 *
 * GUARDS (task): hidden entirely unless `isSelf`; hidden when there is no vault on
 * the deployment (the API 404 → `null` claimable, treasury-only); the CLAIM
 * button is disabled when `claimableEth === 0`. Never blocks anything else.
 */
export function CreatorEarningsPanel({
  address,
  isSelf,
}: {
  address: string;
  isSelf: boolean;
}) {
  const { data } = useCreatorClaimable(isSelf ? address : undefined);

  // Only the owner sees their claim surface; no vault / never-accrued ⇒ nothing here.
  if (!isSelf || !data) return null;
  return <EarningsCard address={address} claimable={data} />;
}

function EarningsCard({
  address,
  claimable,
}: {
  address: string;
  claimable: CreatorClaimable;
}) {
  const queryClient = useQueryClient();
  const { claim, state } = useClaimCreatorFee({
    type: "CLAIM_CREATOR_FEE",
    creator: claimable.creator,
    vault: claimable.vault,
    amountEth: claimable.claimableEth,
  });

  // On a confirmed claim, refetch the roll-up so the balance settles to 0.
  useEffect(() => {
    if (state.phase === "confirmed") {
      void queryClient.invalidateQueries({ queryKey: qk.creatorClaimable(address) });
    }
  }, [state.phase, queryClient, address]);

  const nothingToClaim = BigInt(claimable.claimableEth) === 0n;
  const busy = state.phase === "signing" || state.phase === "pending";
  const badgeState = claimDisplayState(state);

  return (
    <div className="mx-4 mt-4 flex flex-col gap-3 border border-border bg-surface-2 px-4 py-4 md:mx-6">
      <div className="flex items-center justify-between">
        <MonoLabel size="2xs" className="text-text-tertiary">
          Creator earnings
        </MonoLabel>
        {badgeState && <ConfirmationBadge state={badgeState} />}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <MonoLabel size="2xs">Claimable</MonoLabel>
          <MonoText numeric size="lg" className="font-semibold">
            {formatEthFromWei(claimable.claimableEth)} ETH
          </MonoText>
          <UsdAmount value={claimable.claimable} className="text-xs text-muted" />
        </div>
        <div className="flex flex-col gap-0.5 text-right">
          <MonoText tone="faint" size="xs" numeric>
            {formatEthFromWei(claimable.totalAccruedEth)} ETH accrued
          </MonoText>
          <MonoText tone="faint" size="xs" numeric>
            {formatEthFromWei(claimable.totalClaimedEth)} ETH claimed
          </MonoText>
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        disabled={nothingToClaim || busy}
        onClick={() => void claim()}
      >
        {claimLabel(state, nothingToClaim, claimable.claimableEth)}
      </Button>

      {state.phase === "error" && state.error && (
        <MonoText tone="red" size="xs">
          {state.error}
        </MonoText>
      )}
    </div>
  );
}

/** Claim tx phase → the shared §4 display node (reuses the trade badge). */
export function claimDisplayState(state: ClaimState): TradeDisplayState | null {
  switch (state.phase) {
    case "idle":
      return null;
    case "signing":
      return "submitted";
    case "pending":
      return "optimistic:pending";
    case "error":
      return "failed";
    case "confirmed":
      // Tier from the indexed block via the watermark — soft-confirmed shows no
      // chip (§12.56); posted/finalized surface the shared badge.
      return state.confirmationState
        ? displayStateForIndexed(state.confirmationState)
        : "optimistic:soft-confirmed";
  }
}

function claimLabel(state: ClaimState, nothingToClaim: boolean, claimableEth: string): string {
  if (state.phase === "signing") return "Confirm in wallet…";
  if (state.phase === "pending") return "Claiming…";
  if (state.phase === "confirmed") return "Claimed";
  if (nothingToClaim) return "Nothing to claim";
  return `Claim ${formatEthFromWei(claimableEth)} ETH`;
}
