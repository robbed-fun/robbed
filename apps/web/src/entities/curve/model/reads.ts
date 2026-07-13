"use client";

import { bondingCurveAbi, launchTokenAbi } from "@robbed/shared/abi";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";

/**
 * Live on-chain curve state for the Trust panel (§5.2 rows 2/3/4/6) and the
 * anti-sniper cap surface (§6.5). These are the values the Trust panel promises
 * are read FROM CHAIN, never the API's cached copies (spec §5.2, web.md §3.2).
 *
 * DECISION (hoodpad-frontend; basis: viem.sh multicall + M3-1 web-7 finding):
 * `useReadContracts` batches via Multicall3 WHEN the chain advertises one
 * (`chain.contracts.multicall3`). Chain 4663's config intentionally omits it
 * pending the M3-1 confirmation, so wagmi core `readContracts` transparently
 * falls back to parallel `readContract` eth_calls — no code change needed either
 * way (web.md decide-yourself "Live on-chain reads"). `allowFailure: true` so a
 * single reverting read degrades ONE row to "unavailable" instead of blanking the
 * whole panel; a failed read is NEVER substituted with the API's cached value.
 *
 * The curve/token addresses come from the per-token `TokenDetail` (real, indexed)
 * — NOT from the placeholder `shared/config/addresses.ts` — so these reads work
 * before the M1-14 deploy codegen lands.
 */

export interface CurveReserves {
  virtualEth: bigint;
  virtualToken: bigint;
  realEth: bigint;
  realToken: bigint;
}

export interface CurveReads {
  /** LaunchToken.totalSupply() — must equal 1e27 wei (§6.1). */
  totalSupply: bigint | null;
  /** BondingCurve.reserves() — live ETH + token reserves (§5.2 row 3). */
  reserves: CurveReserves | null;
  /** BondingCurve.GRADUATION_ETH() — threshold constant (§6.2, row 4). */
  graduationEth: bigint | null;
  /** BondingCurve.TRADE_FEE_BPS() — TREASURY portion of the trade fee, live (row 6). */
  tradeFeeBps: number | null;
  /** BondingCurve.CREATOR_FEE_BPS() — CREATOR portion of the trade fee, live (§12.63). */
  creatorFeeBps: number | null;
  /** BondingCurve.EARLY_WINDOW_END() — anti-sniper window end (unix, §6.5). */
  earlyWindowEnd: bigint | null;
  /** BondingCurve.MAX_EARLY_BUY() — per-tx early-buy cap, wei (§6.5). */
  maxEarlyBuyWei: bigint | null;
  /** True while at least one read is in flight (initial load). */
  isLoading: boolean;
  /** True when the whole batch failed (RPC down) — show "read unavailable". */
  isError: boolean;
  refetch: () => void;
}

const toBig = (v: unknown): bigint | null =>
  typeof v === "bigint" ? v : typeof v === "number" ? BigInt(v) : null;

/**
 * Batched live reads. Polls every ~5s and is refetched by the caller on each WS
 * trade (web.md §3.2 "refresh on each WS trade"). `token` is the LaunchToken
 * address, `curve` the BondingCurve address (both from TokenDetail).
 */
export function useCurveReads(
  token: Address | undefined,
  curve: Address | undefined,
  opts: { pollMs?: number } = {},
): CurveReads {
  const enabled = !!token && !!curve;
  const { data, isLoading, isError, refetch } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: token, abi: launchTokenAbi, functionName: "totalSupply" },
      { address: curve, abi: bondingCurveAbi, functionName: "reserves" },
      { address: curve, abi: bondingCurveAbi, functionName: "GRADUATION_ETH" },
      { address: curve, abi: bondingCurveAbi, functionName: "TRADE_FEE_BPS" },
      { address: curve, abi: bondingCurveAbi, functionName: "EARLY_WINDOW_END" },
      { address: curve, abi: bondingCurveAbi, functionName: "MAX_EARLY_BUY" },
      { address: curve, abi: bondingCurveAbi, functionName: "CREATOR_FEE_BPS" },
    ],
    query: {
      enabled,
      refetchInterval: opts.pollMs ?? 5_000,
      staleTime: 2_000,
    },
  });

  return {
    ...parseCurveReads(data),
    isLoading: enabled && isLoading,
    isError: enabled && isError,
    refetch: () => void refetch(),
  };
}

type ReadResult = { status: "success" | "failure"; result?: unknown } | undefined;

/** Pure parser over the `useReadContracts` result array (unit-testable). */
export function parseCurveReads(
  data: readonly ReadResult[] | undefined,
): Pick<
  CurveReads,
  | "totalSupply"
  | "reserves"
  | "graduationEth"
  | "tradeFeeBps"
  | "creatorFeeBps"
  | "earlyWindowEnd"
  | "maxEarlyBuyWei"
> {
  const at = (i: number): unknown => {
    const cell = data?.[i];
    return cell && cell.status === "success" ? cell.result : undefined;
  };

  const toBps = (v: unknown): number | null =>
    typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : null;

  const reservesRaw = at(1);
  let reserves: CurveReserves | null = null;
  if (Array.isArray(reservesRaw) && reservesRaw.length >= 4) {
    const [ve, vt, re, rt] = reservesRaw as readonly unknown[];
    const v = [toBig(ve), toBig(vt), toBig(re), toBig(rt)];
    if (v.every((x) => x !== null)) {
      reserves = {
        virtualEth: v[0]!,
        virtualToken: v[1]!,
        realEth: v[2]!,
        realToken: v[3]!,
      };
    }
  }

  return {
    totalSupply: toBig(at(0)),
    reserves,
    graduationEth: toBig(at(2)),
    tradeFeeBps: toBps(at(3)),
    earlyWindowEnd: toBig(at(4)),
    maxEarlyBuyWei: toBig(at(5)),
    creatorFeeBps: toBps(at(6)),
  };
}

/** True while `now` is inside the anti-sniper early window (§6.5). */
export function isInEarlyWindow(
  earlyWindowEnd: bigint | null,
  nowMs = Date.now(),
): boolean {
  if (earlyWindowEnd === null) return false;
  return BigInt(Math.floor(nowMs / 1000)) < earlyWindowEnd;
}
