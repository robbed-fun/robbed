"use client";

import { type CreatorTokenClaimable, creatorTokenClaimableSchema } from "@robbed/shared";
import { useQuery } from "@tanstack/react-query";

import { ApiError, apiGet } from "@/shared/api";
import { qk } from "@/shared/lib/query-keys";

/**
 * Post-graduation creator LP-fee claimable rows. Each row is one
 * per-`(creator, ERC20-token)` bucket — a graduated launch-token leg or the
 * aggregated WETH leg — served by `GET /v1/creators/:address/token-claimable`.
 * The array response is COMPOSED from the shared row schema (`.array()`), never a
 * redeclared shape (anti-drift rule 2): the authoritative wire shape stays
 * `CreatorTokenClaimable`.
 *
 * A missing route or a treasury-only deployment surfaces as `null` — NEVER an
 * error the widget must special-case — so older stacks still degrade to the
 * on-chain `tokenBalanceOf` fallback.
 */
const creatorTokenClaimableListSchema = creatorTokenClaimableSchema.array();

export async function getCreatorTokenClaimable(
  address: string,
): Promise<CreatorTokenClaimable[] | null> {
  try {
    return await apiGet(
      `/v1/creators/${address.toLowerCase()}/token-claimable`,
      creatorTokenClaimableListSchema,
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.code === "not_found")) return null;
    throw e;
  }
}

/**
 * TanStack Query binding. `enabled` only with an address; refetched on a modest
 * interval so a fresh split/claim settles without a manual reload (the WS types
 * invalidate it live on top). `null` data = endpoint absent / no creator-fee vault
 * — the caller then reads the on-chain fallback. `retry: false` so an older stack
 * fails fast to that fallback instead of retry-storming.
 */
export function useCreatorTokenClaimable(address: string | undefined) {
  return useQuery({
    queryKey: qk.creatorTokenClaimable(address ?? ""),
    queryFn: () => getCreatorTokenClaimable(address as string),
    enabled: !!address,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  });
}
