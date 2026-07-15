/**
 * Live BondingCurve creator-fee escrow reader. Pre-grad creator fees accrue in
 * `BondingCurve.accruedCreatorFees()` first; they become claimable in the
 * CreatorVault only after `sweepCreatorFees()` is called. This cold RPC reader
 * lets the Portfolio claim card show and sweep that pending amount.
 */
import { type Address, createPublicClient, http } from "viem";
import { bondingCurveAbi } from "@robbed/shared/abi";

export interface CreatorCurveFeesReader {
  /** Live `accruedCreatorFees()` on a curve, wei decimal string; null if unavailable. */
  read(input: { curve: string }): Promise<string | null>;
}

export const nullCreatorCurveFees: CreatorCurveFeesReader = {
  async read() {
    return null;
  },
};

export function createRpcCreatorCurveFees(rpcUrl: string): CreatorCurveFeesReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    async read({ curve }): Promise<string | null> {
      try {
        const wei = (await client.readContract({
          abi: bondingCurveAbi,
          address: curve as Address,
          functionName: "accruedCreatorFees",
        })) as bigint;
        return wei.toString();
      } catch (err) {
        console.error("[creator-curve-fees] RPC accruedCreatorFees failed:", err);
        return null;
      }
    },
  };
}
