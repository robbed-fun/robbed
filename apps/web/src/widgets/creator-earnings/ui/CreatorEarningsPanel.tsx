"use client";

import type {
  CreatorClaimable,
  CreatorCurveClaimable,
  TokenCard as TokenCardDto,
  UsdValue,
  WsMessage,
} from "@robbed/shared";
import { tokenEvents } from "@robbed/shared";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatEther } from "viem";

import {
  type ClaimState,
  type CreatorTokenBucket,
  bucketFromApiRow,
  hasClaimable,
  sortBuckets,
  useClaimCreatorFee,
  useClaimCreatorTokenFees,
  useCreatorClaimable,
  useCreatorCurveClaimable,
  useCreatorTokenClaimable,
  useOnchainCreatorTokenBuckets,
} from "@/entities/creator";
import {
  ConfirmationBadge,
  type TradeDisplayState,
  displayStateForIndexed,
} from "@/entities/trade";
import { TokenCard as TokenCardView } from "@/entities/token";
import { Button, MonoLabel, MonoText, UsdAmount } from "@/shared/ui";
import { WETH } from "@/shared/config/addresses";
import { qk } from "@/shared/lib/query-keys";
import { formatEthFromWei, formatTokenFromWei, shortAddress } from "@/shared/lib/format";
import { useWsChannel } from "@/shared/lib/ws";

import { isCreatorFeeUpdateFor } from "../model/ws";

/**
 * Creator earnings widget — rendered on the Portfolio
 * CREATED tab for the CONNECTED user's OWN address only (`isSelf`). It surfaces
 * BOTH legs of the venue-invariant 0.5% creator fee:
 *
 *  - PRE-GRAD (curve, native ETH): `CreatorVault.claim(creator)` — the live
 * `balanceOf` roll-up (`useCreatorClaimable`), unchanged from.
 * - POST-GRAD (V3 LP fees) per-`(creator, ERC20)` buckets — the
 *    aggregated WETH leg + each graduated launch-token leg — shown under one
 *    section-level action that submits the needed `CreatorVault.claimERC20`
 *    calls. Buckets come from the API `token-claimable` endpoint
 *    (AUTHORITATIVE), falling back to on-chain `tokenBalanceOf` for older stacks.
 *
 * Every claim surfaces the shared confirmation TIERS via the reused
 * `ConfirmationBadge` (never final while soft-confirmed).
 *
 * LIVE: it subscribes to each graduated token's `:events` channel and refetches
 * the authoritative claimable on a `creator_fee_split` / `creator_fee_claimed`
 * for this creator (reconcile-to-indexed-truth; `model/ws`).
 *
 * GUARDS: hidden entirely unless `isSelf`; renders nothing when there is no vault
 * (treasury-only deployments). A vault with zero pre-grad balance renders a
 * disabled "Nothing to claim" button, so creators can see where claims will appear.
 * Every claim button is disabled while its tx is pending. It never blocks anything else.
 */
export function CreatorEarningsPanel({
  address,
  isSelf,
  createdTokens = [],
}: {
  address: string;
  isSelf: boolean;
  createdTokens?: TokenCardDto[];
}) {
  const ethLeg = useCreatorClaimable(isSelf ? address : undefined);
  const curveFees = useCreatorCurveClaimable(isSelf ? address : undefined);

  // Post-grad buckets: API first, on-chain tokenBalanceOf fallback in dev.
  const tokenApi = useCreatorTokenClaimable(isSelf ? address : undefined);
  const apiUp = tokenApi.isSuccess && tokenApi.data !== null;
  const apiBuckets = useMemo<CreatorTokenBucket[]>(
    () => (apiUp ? (tokenApi.data ?? []).map((r) => bucketFromApiRow(r, WETH)) : []),
    [apiUp, tokenApi.data],
  );

  const graduatedTokens = useMemo(
    () => createdTokens.filter((t) => t.graduated).map((t) => t.address),
    [createdTokens],
  );

  const apiBucketTokens = useMemo(
    () => new Set(apiBuckets.map((b) => b.token.toLowerCase())),
    [apiBuckets],
  );
  const expectedBucketTokens = useMemo(() => {
    const set = new Set<string>([WETH.toLowerCase()]);
    for (const token of graduatedTokens) set.add(token.toLowerCase());
    return [...set];
  }, [graduatedTokens]);
  const shouldReadChainBuckets =
    isSelf &&
    graduatedTokens.length > 0 &&
    (!apiUp || expectedBucketTokens.some((token) => !apiBucketTokens.has(token)));
  const { buckets: chainBuckets } = useOnchainCreatorTokenBuckets({
    creator: isSelf ? address : undefined,
    tokens: graduatedTokens,
    enabled: shouldReadChainBuckets,
  });

  const buckets = useMemo<CreatorTokenBucket[]>(() => {
    const byToken = new Map<string, CreatorTokenBucket>();
    for (const bucket of chainBuckets) byToken.set(bucket.token.toLowerCase(), bucket);
    for (const bucket of apiBuckets) byToken.set(bucket.token.toLowerCase(), bucket);
    return sortBuckets([...byToken.values()]);
  }, [apiBuckets, chainBuckets]);

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

  const hasEth = !!ethLeg.data;
  const vaultFallback = buckets[0]?.vault ?? ethLeg.data?.vault ?? null;
  const curveFeeRows = curveFees.data ?? [];
  const postGradRows = useMemo(
    () =>
      buildPostGradRows({
        creator: address,
        createdTokens,
        buckets,
        vaultFallback,
      }),
    [address, createdTokens, buckets, vaultFallback],
  );
  const tokenClaimRows = useMemo(
    () =>
      buildTokenClaimRows({
        creator: address,
        createdTokens,
        buckets,
        curveFees: curveFeeRows,
        vaultFallback,
      }),
    [address, createdTokens, buckets, curveFeeRows, vaultFallback],
  );
  const hasBuckets = postGradRows.length > 0;
  const hasTokens = createdTokens.length > 0;
  const hasClaimSurface = hasEth || hasBuckets;

  if (!isSelf) return null;

  // WS subscriptions stay mounted even when the card is empty, so the FIRST
  // accrual/claim surfaces without a reload (one child per graduated token — a
  // stable, hooks-safe subscription-per-child pattern).
  const subscriptions = graduatedTokens.map((t) => (
    <CreatorFeeEventsSubscription key={t} token={t} onEvent={onCreatorFeeEvent} />
  ));

  // No vault and no created-token list → no visible card (subscriptions stay live
  // for the first event). A vault with zero pre-grad balance still returns
  // `ethLeg.data` and renders a disabled "Nothing to claim" button.
  if (!hasTokens && !hasClaimSurface) return <>{subscriptions}</>;

  return (
    <div className="mx-4 mt-4 flex flex-col gap-3 md:mx-6">
      {subscriptions}
      {hasClaimSurface && (
        <MonoLabel size="2xs" className="text-text-tertiary">
          Creator earnings
        </MonoLabel>
      )}

      {hasTokens ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tokenClaimRows.map((row) => (
            <TokenCardView key={row.token.address} token={row.token}>
              {hasClaimSurface && (
                <TokenClaimSections
                  address={address}
                  ethClaimable={row.showEthLeg ? (ethLeg.data ?? null) : null}
                  curveFees={row.curveFees}
                  postGradRows={row.postGradRows}
                />
              )}
            </TokenCardView>
          ))}
        </div>
      ) : (
        <StandaloneClaimSections
          address={address}
          ethClaimable={ethLeg.data ?? null}
          curveFees={curveFeeRows}
          postGradRows={postGradRows}
        />
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
 * Pre-graduation ETH leg (curve fee) — the live `claim(creator)` roll-up.
 * A section within the panel (no own border/margins), labelled to make the
 * venue-invariant "0.5% before AND after graduation" story legible next to the
 * post-grad buckets below it.
 */
function EthLegCard({
  address,
  claimable,
  curveFees,
}: {
  address: string;
  claimable: CreatorClaimable;
  curveFees: CreatorCurveClaimable[];
}) {
  const queryClient = useQueryClient();
  const pendingSweepEth = useMemo(
    () => sumWei(curveFees.map((row) => row.unsweptEth)),
    [curveFees],
  );
  const sweepCurves = useMemo(
    () => curveFees.filter((row) => safeBigInt(row.unsweptEth) > 0n).map((row) => row.curve),
    [curveFees],
  );
  const totalClaimableEth = (BigInt(claimable.claimableEth) + pendingSweepEth).toString();
  const { claim, state } = useClaimCreatorFee(
    {
      type: "CLAIM_CREATOR_FEE",
      creator: claimable.creator,
      vault: claimable.vault,
      amountEth: totalClaimableEth,
    },
    { sweepCurves },
  );

  // On a confirmed claim, refetch the roll-up so the balance settles to 0.
  useEffect(() => {
    if (state.phase === "confirmed") {
      void queryClient.invalidateQueries({ queryKey: qk.creatorClaimable(address) });
      void queryClient.invalidateQueries({ queryKey: qk.creatorCurveClaimable(address) });
    }
  }, [state.phase, queryClient, address]);

  const nothingToClaim = BigInt(totalClaimableEth) === 0n;
  const busy = state.phase === "signing" || state.phase === "pending";
  const pendingSweepCount = sweepCurves.length;
  const displayUsd = usdForEthWei(totalClaimableEth, claimable.claimable);

  return (
    <ClaimSectionFrame
      title="Pre-graduation (curve)"
      action={
        <ClaimAction
          assetLabel="ETH"
          state={state}
          disabled={nothingToClaim || busy}
          nothingToClaim={nothingToClaim}
          hasSweep={pendingSweepCount > 0}
          onClaim={() => void claim()}
        />
      }
    >
      <ClaimMetric
        label="Claimable"
        value={`${formatEthFromWei(totalClaimableEth)} ETH`}
        usd={displayUsd}
        emphasis
      />
      {pendingSweepEth > 0n && (
        <ClaimMetric label="Pending sweep" value={`${formatEthFromWei(pendingSweepEth)} ETH`} />
      )}
    </ClaimSectionFrame>
  );
}

interface PostGradClaimRow {
  key: string;
  title: string;
  subtitle: string;
  ticker: string;
  bucket: CreatorTokenBucket;
}

interface TokenClaimRow {
  token: TokenCardDto;
  curveFees: CreatorCurveClaimable[];
  showEthLeg: boolean;
  postGradRows: PostGradClaimRow[];
}

function TokenClaimSections({
  address,
  ethClaimable,
  curveFees,
  postGradRows,
}: {
  address: string;
  ethClaimable: CreatorClaimable | null;
  curveFees: CreatorCurveClaimable[];
  postGradRows: PostGradClaimRow[];
}) {
  if (!ethClaimable && postGradRows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {ethClaimable && (
        <EthLegCard address={address} claimable={ethClaimable} curveFees={curveFees} />
      )}
      {postGradRows.length > 0 && <PostGradClaimSection rows={postGradRows} />}
    </div>
  );
}

function StandaloneClaimSections({
  address,
  ethClaimable,
  curveFees,
  postGradRows,
}: {
  address: string;
  ethClaimable: CreatorClaimable | null;
  curveFees: CreatorCurveClaimable[];
  postGradRows: PostGradClaimRow[];
}) {
  return (
    <div className="border border-border bg-surface-2 px-4 py-4">
      <TokenClaimSections
        address={address}
        ethClaimable={ethClaimable}
        curveFees={curveFees}
        postGradRows={postGradRows}
      />
    </div>
  );
}

/** D-78: WETH + launch-token buckets, one visible post-grad claim action. */
function PostGradClaimSection({ rows }: { rows: PostGradClaimRow[] }) {
  const queryClient = useQueryClient();
  const claimableRows = useMemo(() => rows.filter((row) => hasClaimable(row.bucket)), [rows]);
  const claimMetas = useMemo(
    () =>
      claimableRows.map((row) => ({
        type: "CLAIM_CREATOR_TOKEN_FEE" as const,
        creator: row.bucket.creator,
        token: row.bucket.token,
        vault: row.bucket.vault,
        amount: row.bucket.claimable,
      })),
    [claimableRows],
  );
  const { claim, state } = useClaimCreatorTokenFees(claimMetas);
  const creator = rows[0]?.bucket.creator ?? null;

  useEffect(() => {
    if (state.phase === "confirmed" && creator) {
      void queryClient.invalidateQueries({ queryKey: qk.creatorTokenClaimable(creator) });
      void queryClient.invalidateQueries({
        queryKey: qk.creatorTokenClaimableChain(creator),
      });
    }
  }, [state.phase, queryClient, creator]);

  const busy = state.phase === "signing" || state.phase === "pending";
  const nothingToClaim = claimableRows.length === 0;

  return (
    <ClaimSectionFrame
      title="Post-graduation LP fees"
      action={
        <ClaimAction
          assetLabel="post-graduation LP fees"
          state={state}
          disabled={nothingToClaim || busy}
          nothingToClaim={nothingToClaim}
          onClaim={() => void claim()}
        />
      }
    >
      {rows.map((row) => (
        <ClaimBucketMetrics key={row.key} row={row} />
      ))}
    </ClaimSectionFrame>
  );
}

function ClaimBucketMetrics({ row }: { row: PostGradClaimRow }) {
  const { bucket } = row;

  return (
    <div className="min-w-0">
      <ClaimMetric
        label={row.title}
        value={formatBucketAmount(bucket, row.ticker)}
        usd={bucket.claimableUsd}
        emphasis
      />
    </div>
  );
}

function ClaimSectionFrame({
  title,
  action,
  children,
}: {
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border/70 pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <MonoText size="sm" className="truncate font-semibold">
            {title}
          </MonoText>
        </div>
        {action}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

function ClaimMetric({
  label,
  value,
  usd,
  emphasis = false,
}: {
  label: string;
  value: string;
  usd?: UsdValue | null;
  emphasis?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <MonoLabel size="2xs" className="text-text-tertiary">
        {label}
      </MonoLabel>
      <MonoText numeric size={emphasis ? "lg" : "sm"} className={emphasis ? "font-semibold" : ""}>
        {value}
      </MonoText>
      {usd && <UsdAmount value={usd} className="text-xs text-muted" />}
    </div>
  );
}

function buildTokenClaimRows({
  creator,
  createdTokens,
  buckets,
  curveFees,
  vaultFallback,
}: {
  creator: string;
  createdTokens: TokenCardDto[];
  buckets: CreatorTokenBucket[];
  curveFees: CreatorCurveClaimable[];
  vaultFallback: string | null;
}): TokenClaimRow[] {
  const byToken = new Map<string, CreatorTokenBucket>();
  for (const bucket of buckets) byToken.set(bucket.token.toLowerCase(), bucket);

  const curveFeesByToken = new Map<string, CreatorCurveClaimable[]>();
  for (const row of curveFees) {
    const key = row.token.toLowerCase();
    curveFeesByToken.set(key, [...(curveFeesByToken.get(key) ?? []), row]);
  }

  const wethKey = WETH.toLowerCase();
  const hasWethBucket = buckets.some((bucket) => bucket.isWeth);
  let wethAttached = false;

  return createdTokens.map((token, index) => {
    const tokenKey = token.address.toLowerCase();
    const tokenCurveFees = curveFeesByToken.get(tokenKey) ?? [];
    const graduated = token.graduated || token.status === "graduated";
    const postGradRows: PostGradClaimRow[] = [];

    if (graduated && !wethAttached) {
      const wethBucket =
        byToken.get(wethKey) ??
        makeZeroBucket({ creator, token: WETH, vault: vaultFallback, isWeth: true });
      if (wethBucket && (hasWethBucket || vaultFallback)) {
        postGradRows.push({
          key: `postgrad:${tokenKey}:${wethKey}`,
          title: "WETH",
          subtitle: "Shared LP fees",
          ticker: "WETH",
          bucket: wethBucket,
        });
        wethAttached = true;
      }
    }

    if (graduated) {
      const bucket =
        byToken.get(tokenKey) ??
        makeZeroBucket({ creator, token: token.address, vault: vaultFallback, isWeth: false });
      if (bucket) {
        postGradRows.push({
          key: `postgrad:${tokenKey}`,
          title: token.ticker,
          subtitle: "Launch token fees",
          ticker: token.ticker,
          bucket,
        });
      }
    }

    return {
      token,
      curveFees: tokenCurveFees,
      showEthLeg: index === 0 || tokenCurveFees.length > 0,
      postGradRows,
    };
  });
}

function buildPostGradRows({
  creator,
  createdTokens,
  buckets,
  vaultFallback,
}: {
  creator: string;
  createdTokens: TokenCardDto[];
  buckets: CreatorTokenBucket[];
  vaultFallback: string | null;
}): PostGradClaimRow[] {
  const byToken = new Map<string, CreatorTokenBucket>();
  for (const bucket of buckets) byToken.set(bucket.token.toLowerCase(), bucket);

  const graduated = createdTokens.filter((token) => token.graduated);
  const rows: PostGradClaimRow[] = [];
  const used = new Set<string>();
  const wethKey = WETH.toLowerCase();
  const wethBucket =
    byToken.get(wethKey) ??
    makeZeroBucket({ creator, token: WETH, vault: vaultFallback, isWeth: true });

  if (wethBucket && (buckets.some((bucket) => bucket.isWeth) || graduated.length > 0)) {
    rows.push({
      key: `postgrad:${wethKey}`,
      title: "WETH",
      subtitle: "Shared LP fees",
      ticker: "WETH",
      bucket: wethBucket,
    });
    used.add(wethKey);
  }

  for (const token of graduated) {
    const key = token.address.toLowerCase();
    const bucket =
      byToken.get(key) ??
      makeZeroBucket({ creator, token: token.address, vault: vaultFallback, isWeth: false });
    if (!bucket) continue;
    rows.push({
      key: `postgrad:${key}`,
      title: token.ticker,
      subtitle: "Launch token fees",
      ticker: token.ticker,
      bucket,
    });
    used.add(key);
  }

  for (const bucket of buckets) {
    const key = bucket.token.toLowerCase();
    if (used.has(key)) continue;
    const ticker = bucket.isWeth ? "WETH" : shortAddress(bucket.token);
    rows.push({
      key: `postgrad:${key}`,
      title: ticker,
      subtitle: bucket.isWeth ? "Shared LP fees" : "Launch token fees",
      ticker,
      bucket,
    });
    used.add(key);
  }

  return rows;
}

function makeZeroBucket({
  creator,
  token,
  vault,
  isWeth,
}: {
  creator: string;
  token: string;
  vault: string | null;
  isWeth: boolean;
}): CreatorTokenBucket | null {
  if (!vault) return null;
  return {
    creator,
    token,
    vault,
    claimable: "0",
    claimableUsd: null,
    totalAccrued: null,
    totalClaimed: null,
    isWeth,
  };
}

function formatBucketAmount(
  bucket: CreatorTokenBucket,
  ticker: string,
): string {
  const amount = bucket.isWeth ? formatEthFromWei(bucket.claimable) : formatTokenFromWei(bucket.claimable);
  return `${amount} ${ticker}`;
}

function ClaimAction({
  assetLabel,
  state,
  disabled,
  nothingToClaim,
  hasSweep = false,
  onClaim,
}: {
  assetLabel: string;
  state: ClaimState;
  disabled: boolean;
  nothingToClaim: boolean;
  hasSweep?: boolean;
  onClaim: () => void;
}) {
  const badgeState = claimDisplayState(state);
  const label = claimActionLabel(state, { nothingToClaim, hasSweep });

  return (
    <div className="flex min-w-[128px] flex-col items-start gap-1.5 sm:items-end">
      <div className="flex items-center gap-2">
        {badgeState && <ConfirmationBadge state={badgeState} />}
        <Button
          size="sm"
          variant="outline"
          className="min-w-32"
          aria-label={claimActionAriaLabel(label, assetLabel)}
          disabled={disabled}
          onClick={onClaim}
        >
          {label}
        </Button>
      </div>
      {state.phase === "error" && state.error && (
        <MonoText tone="red" size="xs" className="max-w-56 text-left sm:text-right">
          {state.error}
        </MonoText>
      )}
    </div>
  );
}

function claimActionAriaLabel(label: string, assetLabel: string): string {
  if (label === "Claim" || label === "Nothing to claim" || label === "Sweep + claim") {
    return `${label} ${assetLabel}`;
  }
  return label;
}

/** Claim tx phase → the shared display node (reuses the trade badge). */
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
      // chip; posted/finalized surface the shared badge.
      return state.confirmationState
        ? displayStateForIndexed(state.confirmationState)
        : "optimistic:soft-confirmed";
  }
}

function claimActionLabel(
  state: ClaimState,
  {
    nothingToClaim,
    hasSweep = false,
  }: {
    nothingToClaim: boolean;
    hasSweep?: boolean;
  },
): string {
  if (state.phase === "signing") {
    if (state.step === "sweep") return "Confirm sweep…";
    if (state.step === "claim") return "Confirm claim…";
    return "Confirm in wallet…";
  }
  if (state.phase === "pending") {
    if (state.step === "sweep") return "Sweeping…";
    return "Claiming…";
  }
  if (state.phase === "confirmed") return "Claimed";
  if (nothingToClaim) return "Nothing to claim";
  if (hasSweep) return "Sweep + claim";
  return "Claim";
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function sumWei(values: string[]): bigint {
  return values.reduce((acc, value) => acc + safeBigInt(value), 0n);
}

function usdForEthWei(wei: string, base: UsdValue): UsdValue {
  const eth = Number(formatEther(BigInt(wei)));
  const ethUsd = Number(base.ethUsd);
  return {
    ...base,
    usd: Number.isFinite(eth) && Number.isFinite(ethUsd) ? String(eth * ethUsd) : "0",
  };
}
