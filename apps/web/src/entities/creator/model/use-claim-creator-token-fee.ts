"use client";

import {
  type ClaimCreatorTokenFeeTxMeta,
  type ConfirmationState,
  claimCreatorTokenFeeTxMetaSchema,
  stateForBlock,
} from "@robbed/shared";
import { creatorVaultAbi } from "@robbed/shared/abi";
import { useCallback, useState } from "react";
import type { Address } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";

import { useConfirmationWatermarks } from "@/shared/lib/ws";

import { type ClaimState, humanizeClaimError } from "./use-claim-creator-fee";

/**
 * Post-graduation creator-fee CLAIM (spec §12.69) → `CreatorVault.claimERC20(creator,
 * token)`, the single-ERC20 analog of the pre-grad `claim(creator)`
 * (`use-claim-creator-fee`). One claim per `(creator, token)` bucket — the
 * aggregated WETH leg or a graduated launch-token leg.
 *
 * It reuses the pre-grad hook's `ClaimState` and the SHARED confirmation TIERS
 * (§2.1/§12.20) verbatim: the tier is derived from the INDEXED block via the live
 * `global:confirmations` watermark (`stateForBlock`), never self-reported, so a
 * just-mined claim sits at `soft_confirmed` and is NEVER rendered finalized
 * prematurely — the widget maps this through the same `ConfirmationBadge`.
 *
 * The `CLAIM_CREATOR_TOKEN_FEE` metadata (`claimCreatorTokenFeeTxMetaSchema`) is
 * validated and its `amount` is the optimistic expected payout, shown until the
 * receipt confirms the actual `CreatorTokenClaimed.amount`. `claimERC20` is
 * permissionless; the widget still gates the button to the connected creator's own
 * buckets.
 */
const INITIAL: ClaimState = {
  phase: "idle",
  txHash: null,
  blockNumber: null,
  confirmationState: null,
  error: null,
};

export function useClaimCreatorTokenFee(meta: ClaimCreatorTokenFeeTxMeta): {
  claim: () => Promise<void>;
  reset: () => void;
  state: ClaimState;
} {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const watermarks = useConfirmationWatermarks();
  const [state, setState] = useState<ClaimState>(INITIAL);

  const reset = useCallback(() => setState(INITIAL), []);

  const claim = useCallback(async () => {
    // Validate the shared tx-metadata shape (fail loud on a malformed vault/token).
    const parsed = claimCreatorTokenFeeTxMetaSchema.parse(meta);
    setState({ ...INITIAL, phase: "signing" });
    try {
      const hash = await writeContractAsync({
        address: parsed.vault as Address,
        abi: creatorVaultAbi,
        functionName: "claimERC20",
        args: [parsed.creator as Address, parsed.token as Address],
      });
      setState((s) => ({ ...s, phase: "pending", txHash: hash }));

      const receipt = await publicClient?.waitForTransactionReceipt({ hash });
      if (receipt && receipt.status === "success") {
        setState((s) => ({
          ...s,
          phase: "confirmed",
          blockNumber: Number(receipt.blockNumber),
        }));
      } else {
        setState((s) => ({ ...s, phase: "error", error: "Claim reverted." }));
      }
    } catch (e) {
      setState((s) => ({ ...s, phase: "error", error: humanizeClaimError(e) }));
    }
  }, [meta, publicClient, writeContractAsync]);

  // Derive the live tier from the indexed block via the watermark (never self-reported).
  const confirmationState: ConfirmationState | null =
    state.phase === "confirmed" && state.blockNumber !== null
      ? stateForBlock(state.blockNumber, watermarks)
      : null;

  return { claim, reset, state: { ...state, confirmationState } };
}
