"use client";

import {
  type ClaimCreatorFeeTxMeta,
  type ConfirmationState,
  claimCreatorFeeTxMetaSchema,
  stateForBlock,
} from "@robbed/shared";
import { creatorVaultAbi } from "@robbed/shared/abi";
import { useCallback, useState } from "react";
import type { Address } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";

import { useConfirmationWatermarks } from "@/shared/lib/ws";

/**
 * Creator-fee CLAIM (§7 / §12.63) → `CreatorVault.claim(creator)`, tracked through
 * the SHARED confirmation TIERS (§2.1/§12.20). This hook returns PRIMITIVE tier
 * info only — a `phase` + a derived `ConfirmationState` + the indexed block — and
 * NEVER imports `entities/trade` (a sibling entity): the widget maps this onto the
 * shared `ConfirmationBadge` (which lives in `entities/trade`) so the same
 * posted-to-L1 / finalized surfacing is reused, not reimplemented.
 *
 * Tier derivation matches the trade reducer's "never trust self" rule: the tier
 * comes from the INDEXED block via the live `global:confirmations` watermark
 * (`stateForBlock`), so a just-mined claim sits at `soft_confirmed` until the
 * watermark advances — it is never rendered as finalized prematurely.
 *
 * The `CLAIM_CREATOR_FEE` metadata (`claimCreatorFeeTxMetaSchema`) is validated and
 * attached as the label source (expected `amountEth`), shown optimistically until
 * the receipt confirms. Anyone may call `claim(creator)`; the widget still gates
 * the button to the connected user's OWN created-token earnings.
 */

export type ClaimPhase = "idle" | "signing" | "pending" | "confirmed" | "error";

export interface ClaimState {
  phase: ClaimPhase;
  txHash: `0x${string}` | null;
  /** Indexed block of the mined claim (drives the watermark tier). Null until mined. */
  blockNumber: number | null;
  /** Live tier for the mined claim; null until confirmed. */
  confirmationState: ConfirmationState | null;
  error: string | null;
}

const INITIAL: ClaimState = {
  phase: "idle",
  txHash: null,
  blockNumber: null,
  confirmationState: null,
  error: null,
};

export function useClaimCreatorFee(meta: ClaimCreatorFeeTxMeta): {
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
    // Validate the shared tx-metadata shape (fail loud on a malformed vault/creator).
    const parsed = claimCreatorFeeTxMetaSchema.parse(meta);
    setState({ ...INITIAL, phase: "signing" });
    try {
      const hash = await writeContractAsync({
        address: parsed.vault as Address,
        abi: creatorVaultAbi,
        functionName: "claim",
        args: [parsed.creator as Address],
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

function humanizeClaimError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|denied|rejected the request/i.test(msg)) {
    return "Claim rejected in wallet.";
  }
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
}
