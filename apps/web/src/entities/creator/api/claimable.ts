"use client";

import { type CreatorClaimable, creatorClaimableSchema } from "@robbed/shared";
import { useQuery } from "@tanstack/react-query";

import { ApiError, apiGet } from "@/shared/api";
import { qk } from "@/shared/lib/query-keys";

/**
 * Creator-fee claimable read. `GET /v1/creators/:address/claimable`
 * → the shared `CreatorClaimable` DTO (live `CreatorVault.balanceOf` +
 * accrued/claimed roll-up + USD mirror). A treasury-only deployment (no vault) or
 * a creator who never accrued 404s — surfaced as `null` (nothing to claim), NEVER
 * an error the widget has to special-case.
 *
 * Read-only + public (no cookie) → the normal cross-origin `apiGet`, not the
 * same-origin authed transport.
 */
export async function getCreatorClaimable(
  address: string,
): Promise<CreatorClaimable | null> {
  try {
    return await apiGet(
      `/v1/creators/${address.toLowerCase()}/claimable`,
      creatorClaimableSchema,
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.code === "not_found")) return null;
    throw e;
  }
}

/**
 * TanStack Query binding. `enabled` only when an address is provided; refetched on
 * a modest interval so a fresh claim's balance settles to 0 without a manual
 * reload. `null` data = no vault / nothing accrued.
 */
export function useCreatorClaimable(address: string | undefined) {
  return useQuery({
    queryKey: qk.creatorClaimable(address ?? ""),
    queryFn: () => getCreatorClaimable(address as string),
    enabled: !!address,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
