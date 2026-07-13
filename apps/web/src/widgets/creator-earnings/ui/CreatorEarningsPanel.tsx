"use client";

import type { CreatorClaimable, TokenCard, WsMessage } from "@robbed/shared";
import { tokenEvents } from "@robbed/shared";
import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  type ClaimState,
  type CreatorTokenBucket,
  bucketFromApiRow,
  hasClaimable,
  sortBuckets,
  useClaimCreatorFee,
  useClaimCreatorTokenFee,
  useCreatorClaimable,
  useCreatorTokenClaimable,
  useOnchainCreatorTokenBuckets,
} from "@/entities/creator";
import {
  ConfirmationBadge,
  type TradeDisplayState,
  displayStateForIndexed,
} from "@/entities/trade";
import { Button, MonoLabel, MonoText, TokenAvatar, UsdAmount } from "@/shared/ui";
import { WETH } from "@/shared/config/addresses";
import { qk } from "@/shared/lib/query-keys";
import { formatEthFromWei, formatTokenFromWei, shortAddress } from "@/shared/lib/format";
import { useWsChannel } from "@/shared/lib/ws";

import { isCreatorFeeUpdateFor } from "../model/ws";

/**
 * Creator earnings widget (§7 / §12.63 / §12.69) — rendered on the Portfolio
 * CREATED tab for the CONNECTED user's OWN address only (`isSelf`). It surfaces
 * BOTH legs of the venue-invariant 0.5% creator fee:
 *
 *  - PRE-GRAD (curve, native ETH): `CreatorVault.claim(creator)` — the live
 *    `balanceOf` roll-up (`useCreatorClaimable`), unchanged from §12.63.
 *  - POST-GRAD (V3 LP fees, §12.69): per-`(creator, ERC20)` buckets — the
 *    aggregated WETH leg + each graduated launch-token leg — each pulled with
 *    `CreatorVault.claimERC20(creator, token)`. Buckets come from the indexer
 *    `token-claimable` endpoint (AUTHORITATIVE), falling back to on-chain
 *    `tokenBalanceOf` (over the creator's graduated tokens) until that lands.
 *
 * Every claim surfaces the shared confirmation TIERS via the reused
 * `ConfirmationBadge` (never final while soft-confirmed, §2.1/§12.56).
 *
 * LIVE: it subscribes to each graduated token's `:events` channel and refetches
 * the authoritative claimable on a `creator_fee_split` / `creator_fee_claimed`
 * for this creator (reconcile-to-indexed-truth; `model/ws`).
 *
 * GUARDS: hidden entirely unless `isSelf`; renders nothing when there is no vault
 * / nothing accrued on either leg (treasury-only deployments have no vault). Every
 * claim button is disabled when its balance is 0. It never blocks anything else.
 */
export function CreatorEarningsPanel({
  address,
  isSelf,
  createdTokens = [],
}: {
  address: string;
  isSelf: boolean;
  createdTokens?: TokenCard[];
}) {
  const ethLeg = useCreatorClaimable(isSelf ? address : undefined);

  // Post-grad buckets: API first (§12.69), on-chain tokenBalanceOf fallback in dev.
  const tokenApi = useCreatorTokenClaimable(isSelf ? address : undefined);
  const apiUp = tokenApi.isSuccess && tokenApi.data !== null;

  const graduatedTokens = useMemo(
    () => createdTokens.filter((t) => t.graduated).map((t) => t.address),
    [createdTokens],
  );

  const { buckets: chainBuckets } = useOnchainCreatorTokenBuckets({
    creator: isSelf ? address : undefined,
    tokens: graduatedTokens,
    enabled: isSelf && !apiUp,
  });

  const buckets = useMemo<CreatorTokenBucket[]>(() => {
    const rows = apiUp
      ? (tokenApi.data ?? []).map((r) => bucketFromApiRow(r, WETH))
      : chainBuckets;
    return sortBuckets(rows.filter(hasClaimable));
  }, [apiUp, tokenApi.data, chainBuckets]);

  // Token display registry (ticker + avatar) from the creator's created tokens.
  const registry = useMemo(() => {
    const m = new Map<string, TokenCard>();
    for (const t of createdTokens) m.set(t.address.toLowerCase(), t);
    return m;
  }, [createdTokens]);

  // Live reconcile: a split/claim for THIS creator refetches the authoritative
  // claimable (never clobbers on another creator's event — see model/ws).
  const queryClient = useQueryClient();
  const onCreatorFeeEvent = useCallback(
    (msg: WsMessage) => {
      if (!isCreatorFeeUpdateFor(msg, address)) return;
      void queryClient.invalidateQueries({ queryKey: qk.creatorTokenClaimable(address) });
      void queryClient.invalidateQueries({ queryKey: qk.creatorTokenClaimableChain(address) });
    },
    [address, queryClient],
  );

  if (!isSelf) return null;

  // WS subscriptions stay mounted even when the card is empty, so the FIRST
  // accrual/claim surfaces without a reload (one child per graduated token — a
  // stable, hooks-safe subscription-per-child pattern).
  const subscriptions = graduatedTokens.map((t) => (
    <CreatorFeeEventsSubscription key={t} token={t} onEvent={onCreatorFeeEvent} />
  ));

  const hasEth = !!ethLeg.data;
  const hasBuckets = buckets.length > 0;

  // No vault / nothing accrued on either leg → no visible card (subscriptions
  // stay live for the first event).
  if (!hasEth && !hasBuckets) return <>{subscriptions}</>;

  return (
    <div className="mx-4 mt-4 flex flex-col gap-4 border border-border bg-surface-2 px-4 py-4 md:mx-6">
      {subscriptions}
      <MonoLabel size="2xs" className="text-text-tertiary">
        Creator earnings
      </MonoLabel>

      {hasEth && <EthLegCard address={address} claimable={ethLeg.data!} />}

      {hasBuckets && (
        <div className="flex flex-col gap-2.5">
          <MonoLabel size="2xs" className="text-text-tertiary">
            Post-graduation LP fees
          </MonoLabel>
          {buckets.map((b) => (
            <TokenBucketRow
              key={b.token}
              bucket={b}
              info={registry.get(b.token.toLowerCase())}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One graduated token's events channel → the creator-fee reconcile handler. */
function CreatorFeeEventsSubscription({
  token,
  onEvent,
}: {
  token: string;
  onEvent: (msg: WsMessage) => void;
}) {
  useWsChannel(tokenEvents(token), onEvent);
  return null;
}

/**
 * Pre-graduation ETH leg (curve fee, §12.63) — the live `claim(creator)` roll-up.
 * A section within the panel (no own border/margins), labelled to make the
 * venue-invariant "0.5% before AND after graduation" story legible next to the
 * post-grad buckets below it.
 */
function EthLegCard({
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
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <MonoLabel size="2xs" className="text-text-tertiary">
          Pre-graduation (curve)
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

/**
 * Post-grad per-`(creator, ERC20)` bucket (§12.69) — the WETH leg or a graduated
 * launch-token leg, each pulled with its own `claimERC20(creator, token)` tx and
 * its own confirmation-tier badge. Zero-balance buckets never reach here (filtered
 * by `hasClaimable`).
 */
function TokenBucketRow({
  bucket,
  info,
}: {
  bucket: CreatorTokenBucket;
  info?: TokenCard;
}) {
  const queryClient = useQueryClient();
  const { claim, state } = useClaimCreatorTokenFee({
    type: "CLAIM_CREATOR_TOKEN_FEE",
    creator: bucket.creator,
    token: bucket.token,
    vault: bucket.vault,
    amount: bucket.claimable,
  });

  useEffect(() => {
    if (state.phase === "confirmed") {
      void queryClient.invalidateQueries({ queryKey: qk.creatorTokenClaimable(bucket.creator) });
      void queryClient.invalidateQueries({
        queryKey: qk.creatorTokenClaimableChain(bucket.creator),
      });
    }
  }, [state.phase, queryClient, bucket.creator]);

  const busy = state.phase === "signing" || state.phase === "pending";
  const badgeState = claimDisplayState(state);
  const label = bucket.isWeth ? "WETH" : info?.ticker ?? shortAddress(bucket.token);
  const amountText = bucket.isWeth
    ? `${formatEthFromWei(bucket.claimable)} WETH`
    : `${formatTokenFromWei(bucket.claimable)} ${info?.ticker ?? ""}`.trim();

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <TokenAvatar
          imageUrl={bucket.isWeth ? null : info?.imageUrl ?? null}
          name={label}
          ticker={label}
          size={20}
        />
        <div className="flex min-w-0 flex-col">
          <MonoText numeric size="sm" className="truncate font-medium">
            {amountText}
          </MonoText>
          {bucket.claimableUsd && (
            <UsdAmount value={bucket.claimableUsd} className="text-2xs text-muted" />
          )}
        </div>
        {badgeState && <ConfirmationBadge state={badgeState} />}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void claim()}>
          {tokenClaimLabel(state, label)}
        </Button>
      </div>

      {state.phase === "error" && state.error && (
        <MonoText tone="red" size="xs" className="basis-full">
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

function tokenClaimLabel(state: ClaimState, label: string): string {
  if (state.phase === "signing") return "Confirm…";
  if (state.phase === "pending") return "Claiming…";
  if (state.phase === "confirmed") return "Claimed";
  return `Claim ${label}`;
}
