"use client";

import { type CreatorTokenClaimable, creatorTokenClaimableSchema } from "@robbed/shared";
import { useQuery } from "@tanstack/react-query";

import { ApiError, apiGet } from "@/shared/api";
import { qk } from "@/shared/lib/query-keys";

/**
 * Post-graduation creator LP-fee claimable rows (spec §12.69). Each row is one
 * per-`(creator, ERC20-token)` bucket — a graduated launch-token leg or the
 * aggregated WETH leg — served by the endpoint robbed-indexer is adding, which
 * serves the shared `creatorTokenClaimableSchema`. The array response is COMPOSED
 * from the shared row schema (`.array()`), never a redeclared shape (anti-drift
 * rule 2): the authoritative wire shape stays `CreatorTokenClaimable`.
 *
 * GAP / DOC-LOCKSTEP (reported to robbed-indexer + architect): the endpoint PATH
 * and its `openapi.yaml` entry are not yet ratified (api.md §3 addition). This
 * targets the plausible `GET /v1/creators/:address/token-claimable`. A missing
 * route (404) or a creator who never accrued surfaces as `null` — NEVER an error
 * the widget must special-case — so the on-chain `tokenBalanceOf` fallback
 * (`useOnchainCreatorTokenBuckets`) takes over until the endpoint lands.
 *
 * TODO(api): once the endpoint is live, this API read is the AUTHORITATIVE source
 * (it enumerates every bucket server-side, incl. graduated tokens the client has
 * no local list of) and the on-chain multicall drops to a dev-only fallback.
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
 * invalidate it live on top). `null` data = endpoint absent / nothing accrued —
 * the caller then reads the on-chain fallback. `retry: false` so a not-yet-live
 * endpoint fails fast to that fallback instead of retry-storming.
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
