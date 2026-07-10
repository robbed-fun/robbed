"use client";

import { curveFactoryAbi } from "@robbed/shared/abi";
import { useReadContract } from "wagmi";

import { ROBBED, isPlaceholder } from "@/shared/config/addresses";

/**
 * Live `pauseBuys` read from the CurveFactory config (§6.5). This ONLY ever gates
 * the BUY tab — the sell path must never read it (spec §6.5/§12.25: "sells always
 * open", no flag can block a curve sell). Keeping this in its own hook makes the
 * boundary explicit and grep-auditable: the Sell UI never imports it.
 *
 * The factory address is the generated (currently placeholder) `ROBBED.curveFactory`;
 * until the M1-14 deploy codegen lands it is the zero sentinel, so the read is
 * DISABLED and returns `undefined` (unknown). We never claim buys are paused from a
 * value we couldn't read — an unknown pause state leaves the Buy tab enabled and
 * lets the contract itself reject a genuinely-paused buy.
 */
export function usePauseBuys(): { pauseBuys: boolean | undefined; isError: boolean } {
  const enabled = !isPlaceholder(ROBBED.curveFactory);
  const { data, isError } = useReadContract({
    address: ROBBED.curveFactory,
    abi: curveFactoryAbi,
    functionName: "pauseBuys",
    query: { enabled, refetchInterval: 8_000 },
  });
  return { pauseBuys: typeof data === "boolean" ? data : undefined, isError };
}
