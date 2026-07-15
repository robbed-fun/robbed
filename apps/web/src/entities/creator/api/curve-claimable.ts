"use client";

import { type CreatorCurveClaimable, creatorCurveClaimableSchema } from "@robbed/shared";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/shared/api";
import { qk } from "@/shared/lib/query-keys";

const creatorCurveClaimableListSchema = creatorCurveClaimableSchema.array();

/**
 * Pre-grad creator-fee escrows that are still on BondingCurve contracts and need
 * `sweepCreatorFees()` before `CreatorVault.claim(creator)` can withdraw them.
 */
export function getCreatorCurveClaimable(
  address: string,
): Promise<CreatorCurveClaimable[]> {
  return apiGet(
    `/v1/creators/${address.toLowerCase()}/curve-claimable`,
    creatorCurveClaimableListSchema,
  );
}

export function useCreatorCurveClaimable(address: string | undefined) {
  return useQuery({
    queryKey: qk.creatorCurveClaimable(address ?? ""),
    queryFn: () => getCreatorCurveClaimable(address as string),
    enabled: !!address,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
