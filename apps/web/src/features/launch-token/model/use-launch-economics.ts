"use client";

import { curveFactoryAbi } from "@robbed/shared/abi";
import { useReadContracts } from "wagmi";

import { ROBBED, isPlaceholder } from "@/shared/config/addresses";
import { env } from "@/shared/lib/env";
import { mockLaunchEconomics } from "@/shared/mock/mock-api";

/**
 * Live economics read from the CurveFactory (§5.3 "economics displayed plainly").
 * Every number the EconomicsPanel shows is READ LIVE from chain — the deploy fee,
 * the graduation threshold (ETH), the trade-fee bps — never a constant (§2,
 * CLAUDE.md). `pauseCreates` gates the submit button (granular flag, §6.5 — this
 * NEVER affects sells elsewhere).
 *
 * The factory address is the generated `ROBBED.curveFactory`, a zero sentinel
 * until the M1-14 deploy codegen lands; while it is the placeholder the reads are
 * DISABLED and `available` is false, so the panel renders its labels + the LP
 * sentence + fee copy and shows "read on-chain" for the live numbers rather than a
 * fabricated value. `allowFailure` degrades a single reverting read to `null`.
 */
export interface LaunchEconomics {
  /** CurveFactory.creationFee() — the deploy fee, wei. */
  deployFeeWei: bigint | null;
  /** CurveParameters.graduationEth — the graduation threshold, wei. */
  graduationEthWei: bigint | null;
  /** CurveFactory.tradeFeeBps() — curve trade fee, rendered live. */
  tradeFeeBps: number | null;
  /** CurveParameters.virtualEth0 — seed virtual ETH reserve; seeds the M3-6 preview. */
  virtualEth0: bigint | null;
  /** CurveParameters.virtualToken0 — seed virtual token reserve; seeds the M3-6 preview. */
  virtualToken0: bigint | null;
  /** CurveFactory.pauseCreates() — disables submit when true (§6.5). */
  pauseCreates: boolean | null;
  /** False while the factory address is still the M3-3 placeholder stub. */
  available: boolean;
  isLoading: boolean;
  isError: boolean;
}

const toBig = (v: unknown): bigint | null =>
  typeof v === "bigint" ? v : typeof v === "number" ? BigInt(v) : null;

export function useLaunchEconomics(): LaunchEconomics {
  // DEMO MODE (Gap 1): the CurveFactory `eth_call`s are short-circuited to the
  // fixture so Create shows real Deploy cost / Starting price / Supply instead of
  // "read on-chain". The wagmi read is DISABLED but still called unconditionally
  // to keep hook order stable. Strictly gated — dead branch with the flag off.
  const mock = env.mockData();
  const available = mock || !isPlaceholder(ROBBED.curveFactory);
  const factory = ROBBED.curveFactory;

  const { data, isLoading, isError } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: factory, abi: curveFactoryAbi, functionName: "creationFee" },
      { address: factory, abi: curveFactoryAbi, functionName: "curveParameters" },
      { address: factory, abi: curveFactoryAbi, functionName: "tradeFeeBps" },
      { address: factory, abi: curveFactoryAbi, functionName: "pauseCreates" },
    ],
    query: {
      enabled: available && !mock,
      refetchInterval: 8_000,
      staleTime: 4_000,
    },
  });

  if (mock) {
    return {
      ...mockLaunchEconomics(),
      available: true,
      isLoading: false,
      isError: false,
    };
  }

  const at = (i: number): unknown => {
    const cell = data?.[i];
    return cell && cell.status === "success" ? cell.result : undefined;
  };

  const params = at(1) as
    | { graduationEth?: bigint; virtualEth0?: bigint; virtualToken0?: bigint }
    | undefined;
  const feeRaw = at(2);
  const pauseRaw = at(3);

  return {
    deployFeeWei: toBig(at(0)),
    graduationEthWei: params ? toBig(params.graduationEth) : null,
    tradeFeeBps:
      typeof feeRaw === "number"
        ? feeRaw
        : typeof feeRaw === "bigint"
          ? Number(feeRaw)
          : null,
    virtualEth0: params ? toBig(params.virtualEth0) : null,
    virtualToken0: params ? toBig(params.virtualToken0) : null,
    pauseCreates: typeof pauseRaw === "boolean" ? pauseRaw : null,
    available,
    isLoading: available && isLoading,
    isError: available && isError,
  };
}
