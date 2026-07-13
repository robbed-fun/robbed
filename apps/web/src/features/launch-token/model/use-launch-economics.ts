"use client";

import { curveFactoryAbi } from "@robbed/shared/abi";
import { useReadContracts } from "wagmi";

import { ROBBED, isPlaceholder } from "@/shared/config/addresses";

/**
 * Live economics read from the CurveFactory (§5.3 "economics displayed plainly").
 * Every number the EconomicsPanel shows is READ LIVE from chain — the deploy fee,
 * the graduation threshold (ETH), the trade-fee bps — never a constant (§2,
 * CLAUDE.md). `pauseCreates` gates the submit button (granular flag, §6.5 — this
 * NEVER affects sells elsewhere).
 *
 * LAUNCH-2 fix (2026-07-12): the curve seed values come from
 * `CurveFactory.curveDefaults()` — the zero-input view returning
 * `(virtualEth0, virtualToken0, curveSupply, lpTranche, graduationEth)` —
 * NEVER from `curveParameters()`, which is a deploy-transient handoff slot that
 * reads as all zeros outside `createToken` and broke the Create-page preview.
 * Fees + pause come from the `config()` tuple (tradeFeeBps / creationFee /
 * pauseCreates) — two eth_calls total.
 *
 * The factory address is the generated `ROBBED.curveFactory`, a zero sentinel
 * until the M1-14 deploy codegen lands; while it is the placeholder the reads are
 * DISABLED and `available` is false, so the panel renders its labels + the LP
 * sentence + fee copy and shows "read on-chain" for the live numbers rather than a
 * fabricated value. `allowFailure` degrades a single reverting read to `null`.
 */
export interface LaunchEconomics {
  /** FactoryConfig.creationFee — the deploy fee, wei. */
  deployFeeWei: bigint | null;
  /** CurveDefaults.graduationEth — the graduation threshold, wei. */
  graduationEthWei: bigint | null;
  /** FactoryConfig.tradeFeeBps — TREASURY portion of the trade fee, live. */
  tradeFeeBps: number | null;
  /** FactoryConfig.creatorFeeBps — CREATOR portion (§12.63), live; 0 in v1. */
  creatorFeeBps: number | null;
  /** CurveDefaults.virtualEth0 — seed virtual ETH reserve; seeds the M3-6 preview. */
  virtualEth0: bigint | null;
  /** CurveDefaults.virtualToken0 — seed virtual token reserve; seeds the M3-6 preview. */
  virtualToken0: bigint | null;
  /** FactoryConfig.pauseCreates — disables submit when true (§6.5). */
  pauseCreates: boolean | null;
  /** False while the factory address is still the M3-3 placeholder stub. */
  available: boolean;
  isLoading: boolean;
  isError: boolean;
}

const toBig = (v: unknown): bigint | null =>
  typeof v === "bigint" ? v : typeof v === "number" ? BigInt(v) : null;

export function useLaunchEconomics(): LaunchEconomics {
  const available = !isPlaceholder(ROBBED.curveFactory);
  const factory = ROBBED.curveFactory;

  const { data, isLoading, isError } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: factory, abi: curveFactoryAbi, functionName: "curveDefaults" },
      { address: factory, abi: curveFactoryAbi, functionName: "config" },
    ],
    query: {
      enabled: available,
      refetchInterval: 8_000,
      staleTime: 4_000,
    },
  });

  const at = (i: number): unknown => {
    const cell = data?.[i];
    return cell && cell.status === "success" ? cell.result : undefined;
  };

  // viem decodes the named single-tuple outputs as objects (ICurveFactory
  // structs in the generated ABI — packages/shared/src/abi).
  const defaults = at(0) as
    | { virtualEth0?: bigint; virtualToken0?: bigint; graduationEth?: bigint }
    | undefined;
  const config = at(1) as
    | {
        tradeFeeBps?: number | bigint;
        creatorFeeBps?: number | bigint;
        creationFee?: bigint;
        pauseCreates?: boolean;
      }
    | undefined;

  const toBps = (v: unknown): number | null =>
    typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : null;

  return {
    deployFeeWei: config ? toBig(config.creationFee) : null,
    graduationEthWei: defaults ? toBig(defaults.graduationEth) : null,
    tradeFeeBps: config ? toBps(config.tradeFeeBps) : null,
    creatorFeeBps: config ? toBps(config.creatorFeeBps) : null,
    virtualEth0: defaults ? toBig(defaults.virtualEth0) : null,
    virtualToken0: defaults ? toBig(defaults.virtualToken0) : null,
    pauseCreates: typeof config?.pauseCreates === "boolean" ? config.pauseCreates : null,
    available,
    isLoading: available && isLoading,
    isError: available && isError,
  };
}
