"use client";

import { bondingCurveAbi } from "@robbed/shared/abi";
import { useReadContract } from "wagmi";
import type { Address } from "viem";

/**
 * Curve quote model (§5.2 TradeWidget). The QUOTE is an on-chain view — the
 * source of truth is `BondingCurve.quoteBuy/quoteSell` (contracts.md §2.3), read
 * live; the shared curve math is only a display fallback/oracle. This module owns
 * the pure DISPLAY math around that quote (slippage floor, price impact, deadline)
 * and the read hook.
 *
 * None of these are market metrics (§2): slippage/deadline are user settings and
 * price impact is a ratio of the live quote to the live spot — no constant ETH/USD
 * or price is ever inlined.
 *
 * DECISIONS (hoodpad-frontend):
 * - Quote reads use `useReadContract` keyed by (curve, side, amount): TanStack
 *   Query's key-based caching discards a superseded response automatically, so a
 *   stale quote can never overwrite a newer one (the epoch guard is the query
 *   key). The widget additionally DEBOUNCES the amount (~250ms) before it reaches
 *   this hook to avoid a read per keystroke (web.md decide-yourself "quote
 *   debounce").
 * - The DEADLINE is recomputed at submit time from the CHAIN's latest block
 *   timestamp (`computeChainDeadline`), never from the quote timestamp and never
 *   from the browser clock: the contract's deadline guard compares against
 *   `block.timestamp`, so a machine clock lagging the chain by more than the
 *   window would ship an already-expired deadline → "Deadline expired" on the
 *   estimate/tx (the diagnosed root cause). Reading chain time removes the
 *   dependency on the user's clock. `computeDeadline` (browser clock) survives as
 *   the fallback when no client is present or the read throws.
 */

/** Default slippage tolerance — 2% (§5.2). */
export const DEFAULT_SLIPPAGE_BPS = 200;
/** Above this, the widget warns (§5.2 "warnings >5%"). */
export const SLIPPAGE_WARN_BPS = 500;
export const SLIPPAGE_MIN_BPS = 10; // 0.1%
export const SLIPPAGE_MAX_BPS = 5000; // 50%
/**
 * Default trade deadline window — now + 20 min (§5.2, "deadline on every trade").
 * 20 (bumped from 10) is belt-and-suspenders headroom on top of the real fix
 * (`computeChainDeadline`, which derives the absolute deadline from chain time,
 * not the browser clock).
 */
export const DEFAULT_DEADLINE_MINUTES = 20;

export type TradeSide = "buy" | "sell";

/** Floor an amount by a slippage tolerance in bps: `amount * (1 - bps/1e4)`. */
export function applySlippageFloor(amount: bigint, slippageBps: number): bigint {
  const bps = clampSlippageBps(slippageBps);
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

export function clampSlippageBps(bps: number): number {
  if (!Number.isFinite(bps)) return DEFAULT_SLIPPAGE_BPS;
  return Math.max(SLIPPAGE_MIN_BPS, Math.min(SLIPPAGE_MAX_BPS, Math.round(bps)));
}

/**
 * Absolute deadline (unix seconds, as bigint) from the BROWSER clock. Retained as
 * the fallback for {@link computeChainDeadline} and for the pure display/unit
 * tests; prefer the chain-derived value at submit time.
 */
export function computeDeadline(
  nowMs = Date.now(),
  minutes = DEFAULT_DEADLINE_MINUTES,
): bigint {
  return BigInt(Math.floor(nowMs / 1000) + minutes * 60);
}

/**
 * A minimal structural view of the viem public client — just the ability to read
 * the latest block's timestamp. Kept structural (not the full `PublicClient`) so
 * this entity stays free of a wagmi/viem client-type dependency and is trivially
 * fakeable in unit tests.
 */
export interface ChainTimeClient {
  getBlock: () => Promise<{ timestamp: bigint }>;
}

/**
 * Absolute deadline (unix seconds, as bigint) derived from the CHAIN's own clock
 * — the real fix for spurious "Deadline expired" reverts. viem
 * `publicClient.getBlock()` with no args returns the LATEST block, whose
 * `timestamp` is a bigint in unix SECONDS — the exact unit the contract's
 * deadline guard compares against `block.timestamp` (docs verified via
 * context7/viem, 2026-07-13). Deriving the deadline from that value makes it
 * independent of the user's machine clock, which — if it lags the chain by more
 * than the window — otherwise ships an already-past deadline that reverts on the
 * estimate and the tx.
 *
 * Falls back to the browser-clock {@link computeDeadline} when no client is
 * present or `getBlock()` throws, so the deadline is NEVER left undefined.
 */
export async function computeChainDeadline(
  client: ChainTimeClient | null | undefined,
  minutes = DEFAULT_DEADLINE_MINUTES,
): Promise<bigint> {
  if (!client) return computeDeadline(undefined, minutes);
  try {
    const block = await client.getBlock();
    return block.timestamp + BigInt(minutes * 60);
  } catch {
    return computeDeadline(undefined, minutes);
  }
}

/**
 * Price impact of a trade vs the curve spot price, as a percent (display-only).
 * Spot = virtualEth / virtualToken (the marginal price). Effective = the actual
 * ETH-per-token the fill delivers. Returns null when inputs are unusable.
 */
export function priceImpactPct(args: {
  side: TradeSide;
  /** Gross ETH in (buy) or ETH out (sell), as a float. */
  eth: number;
  /** Tokens out (buy) or tokens in (sell), as a float. */
  tokens: number;
  virtualEth: number;
  virtualToken: number;
}): number | null {
  const { eth, tokens, virtualEth, virtualToken } = args;
  if (tokens <= 0 || virtualToken <= 0 || virtualEth <= 0) return null;
  const spot = virtualEth / virtualToken; // ETH per token
  const effective = eth / tokens;
  if (!Number.isFinite(spot) || spot <= 0) return null;
  // Buying pushes price up (effective > spot); selling down. Report magnitude.
  return Math.abs((effective - spot) / spot) * 100;
}

/** Parsed curve quote — normalized across buy/sell. */
export interface CurveQuote {
  side: TradeSide;
  /** Tokens received (buy) or ETH received (sell), wei. */
  amountOut: bigint;
  /** In-contract fee, wei (ETH leg). */
  feeEth: bigint;
  /** Buy only: gross ETH actually accepted after graduation-clamp. */
  acceptedEthGross?: bigint;
  /** Buy only: ETH refunded by the graduation clamp (§12.11). */
  refund?: bigint;
}

/**
 * Live curve quote. `amountWei` is ETH-in (buy) or token-in (sell). Disabled when
 * the venue is not the curve, the amount is null/zero, or `enabled` is false.
 */
export function useCurveQuote(args: {
  curve: Address | undefined;
  side: TradeSide;
  amountWei: bigint | null;
  enabled?: boolean;
}): { quote: CurveQuote | null; isFetching: boolean; isError: boolean } {
  const { curve, side, amountWei, enabled = true } = args;
  const active = enabled && !!curve && amountWei !== null && amountWei > 0n;

  const read = useReadContract({
    address: curve,
    abi: bondingCurveAbi,
    functionName: side === "buy" ? "quoteBuy" : "quoteSell",
    args: amountWei !== null ? [amountWei] : undefined,
    query: {
      enabled: active,
      // A quote is inherently short-lived; keep it fresh but don't hammer.
      staleTime: 2_000,
      gcTime: 5_000,
    },
  });

  const quote = parseQuote(side, read.data);
  return { quote, isFetching: read.isFetching, isError: read.isError };
}

/** Normalize the raw view tuple into `CurveQuote`. */
export function parseQuote(side: TradeSide, data: unknown): CurveQuote | null {
  if (!Array.isArray(data)) return null;
  if (side === "buy") {
    // quoteBuy -> [tokensOut, fee, acceptedEthGross, refund]
    const [tokensOut, fee, acceptedEthGross, refund] = data as readonly bigint[];
    if (tokensOut === undefined) return null;
    return {
      side,
      amountOut: BigInt(tokensOut),
      feeEth: BigInt(fee ?? 0n),
      acceptedEthGross: acceptedEthGross === undefined ? undefined : BigInt(acceptedEthGross),
      refund: refund === undefined ? undefined : BigInt(refund),
    };
  }
  // quoteSell -> [ethOut, fee]
  const [ethOut, fee] = data as readonly bigint[];
  if (ethOut === undefined) return null;
  return { side, amountOut: BigInt(ethOut), feeEth: BigInt(fee ?? 0n) };
}
