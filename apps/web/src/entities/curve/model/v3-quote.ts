"use client";

import { WETH_ADDRESS } from "@robbed/shared";
import { useSimulateContract } from "wagmi";
import type { Address } from "viem";

import { buildV3QuoteRequest } from "../lib/v3";
import type { TradeSide } from "./quote";

/**
 * Live Uniswap V3 quote for the post-graduation venue (§5.2 invisible venue
 * switch, M3-5). The QuoterV2 `quoteExactInputSingle` is a REVERT-QUOTER
 * (nonpayable) — it must be run through `simulateContract`, NOT `readContract`
 * (§12.28). wagmi's `useSimulateContract` does exactly that and returns the
 * decoded outputs on `data.result` (wagmi.sh/react/api/hooks/useSimulateContract,
 * verified 2026-07-10); `result[0]` is `amountOut`.
 *
 * This mirrors `useCurveQuote` for the curve venue so the TradeWidget consumes one
 * uniform quote surface across the graduation seam. Disabled when the amount is
 * null/zero or `enabled` is false; TanStack Query's key-based caching discards a
 * superseded response, so a stale quote can never overwrite a newer one.
 */
export interface V3Quote {
  /** Tokens out (buy) or ETH out (sell), wei. */
  amountOut: bigint | null;
  isFetching: boolean;
  isError: boolean;
}

export function useV3Quote(args: {
  token: Address | undefined;
  side: TradeSide;
  amountWei: bigint | null;
  enabled?: boolean;
}): V3Quote {
  const { token, side, amountWei, enabled = true } = args;
  const active = enabled && !!token && amountWei !== null && amountWei > 0n;

  // Build a CONCRETE request (typed against the shared quoter ABI) so the hook's
  // arg/return types infer; `enabled` gates whether it actually runs, so the
  // WETH/0 fallback used while inactive is never sent.
  const request = buildV3QuoteRequest({
    side,
    token: token ?? WETH_ADDRESS,
    amountWei: amountWei ?? 0n,
  });

  const sim = useSimulateContract({
    address: request.address,
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
    query: {
      enabled: active,
      // A quote is short-lived; keep it fresh without hammering the node.
      staleTime: 2_000,
      gcTime: 5_000,
    },
  });

  const result = sim.data?.result as readonly bigint[] | undefined;
  const amountOut = result && result[0] !== undefined ? BigInt(result[0]) : null;

  return { amountOut, isFetching: sim.isFetching, isError: sim.isError };
}
