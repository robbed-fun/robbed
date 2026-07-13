"use client";

import { creatorVaultAbi } from "@robbed/shared/abi";
import { useMemo } from "react";
import { type Address, getAddress } from "viem";
import { useReadContracts } from "wagmi";

import { CREATOR_VAULT, WETH } from "@/shared/config/addresses";

import type { CreatorTokenBucket } from "../lib/token-bucket";

/**
 * ON-CHAIN FALLBACK (spec §12.69) for the post-grad creator buckets, used while
 * the indexer `token-claimable` endpoint isn't up yet (`useCreatorTokenClaimable`
 * returned `null`). Reads `CreatorVault.tokenBalanceOf(creator, token)` — the
 * value the shared schema documents as AUTHORITATIVE — for the aggregated WETH leg
 * plus each of the creator's graduated launch tokens, in ONE wagmi multicall
 * (`useReadContracts`; docs-verified wagmi v2 signature 2026-07-13).
 *
 * Bounded by design: the client can only enumerate the graduated tokens it already
 * has (the CreatorTab's created list), so this is a best-effort partial fallback —
 * the API read is the complete source (it enumerates buckets server-side). Enabled
 * only when a `CreatorVault` exists on the target chain (`CREATOR_VAULT` defined;
 * v1/treasury-only deployments have none). Zero-balance buckets are dropped by the
 * caller via `hasClaimable`. `claimableUsd` is null here (no ETH/USD source on this
 * path; the API row carries USD for the WETH leg, §2 — never a fabricated figure).
 */
export function useOnchainCreatorTokenBuckets({
  creator,
  tokens,
  enabled,
}: {
  creator: string | undefined;
  /** The creator's GRADUATED launch-token addresses (canonical WETH is added automatically). */
  tokens: string[];
  enabled: boolean;
}): { buckets: CreatorTokenBucket[]; isLoading: boolean } {
  const vault = CREATOR_VAULT;

  // Candidate ERC20s: the aggregated WETH leg first, then each graduated launch
  // token (deduped + checksum-normalized; malformed entries skipped).
  const candidates = useMemo<Address[]>(() => {
    const set = new Map<string, Address>();
    set.set(WETH.toLowerCase(), WETH);
    for (const t of tokens) {
      try {
        const a = getAddress(t);
        set.set(a.toLowerCase(), a);
      } catch {
        /* skip malformed */
      }
    }
    return [...set.values()];
  }, [tokens]);

  const on = enabled && !!vault && !!creator && candidates.length > 0;

  const { data, isLoading } = useReadContracts({
    contracts: on
      ? candidates.map((token) => ({
          address: vault as Address,
          abi: creatorVaultAbi,
          functionName: "tokenBalanceOf" as const,
          args: [creator as Address, token],
        }))
      : [],
    query: { enabled: on },
  });

  const buckets = useMemo<CreatorTokenBucket[]>(() => {
    if (!on || !data || !vault || !creator) return [];
    const wethLc = WETH.toLowerCase();
    return candidates.map((token, i) => {
      const cell = data[i];
      const raw = cell && cell.status === "success" ? (cell.result as bigint) : 0n;
      return {
        creator,
        token,
        vault,
        claimable: raw.toString(),
        claimableUsd: null,
        isWeth: token.toLowerCase() === wethLc,
      };
    });
  }, [on, data, candidates, vault, creator]);

  return { buckets, isLoading: on ? isLoading : false };
}
