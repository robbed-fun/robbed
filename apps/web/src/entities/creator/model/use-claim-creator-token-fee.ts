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
 * Post-graduation creator-fee CLAIM → `CreatorVault.claimERC20(creator,
 * token)`, the single-ERC20 analog of the pre-grad `claim(creator)`
 * (`use-claim-creator-fee`). One claim per `(creator, token)` bucket — the
 * aggregated WETH leg or a graduated launch-token leg.
 *
 * It reuses the pre-grad hook's `ClaimState` and the SHARED confirmation TIERS
 * verbatim: the tier is derived from the INDEXED block via the live
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
  return useClaimCreatorTokenFees([meta]);
}

export function useClaimCreatorTokenFees(metas: ClaimCreatorTokenFeeTxMeta[]): {
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
    try {
      // Validate every shared tx-metadata shape before asking the wallet to sign.
      const parsedMetas = metas.map((m) => claimCreatorTokenFeeTxMetaSchema.parse(m));
      if (parsedMetas.length === 0) return;

      let lastBlock: number | null = null;
      for (const parsed of parsedMetas) {
        setState({ ...INITIAL, phase: "signing", step: "claim" });
        const hash = await writeContractAsync({
          address: parsed.vault as Address,
          abi: creatorVaultAbi,
          functionName: "claimERC20",
          args: [parsed.creator as Address, parsed.token as Address],
        });
        setState((s) => ({ ...s, phase: "pending", step: "claim", txHash: hash }));

        const receipt = await publicClient?.waitForTransactionReceipt({ hash });
        if (receipt && receipt.status === "success") {
          lastBlock = Number(receipt.blockNumber);
        } else {
          setState((s) => ({ ...s, phase: "error", error: "Claim reverted." }));
          return;
        }
      }

      setState((s) => ({ ...s, phase: "confirmed", step: "claim", blockNumber: lastBlock }));
    } catch (e) {
      setState((s) => ({ ...s, phase: "error", error: humanizeClaimError(e) }));
    }
  }, [metas, publicClient, writeContractAsync]);

  // Derive the live tier from the indexed block via the watermark (never self-reported).
  const confirmationState: ConfirmationState | null =
    state.phase === "confirmed" && state.blockNumber !== null
      ? stateForBlock(state.blockNumber, watermarks)
      : null;

  return { claim, reset, state: { ...state, confirmationState } };
}
