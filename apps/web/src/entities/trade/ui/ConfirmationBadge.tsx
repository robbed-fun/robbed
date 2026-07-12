"use client";

import type { ConfirmationState } from "@robbed/shared";

import { Badge } from "@/shared/ui";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui";
import { cn } from "@/shared/lib/utils";

import type { TradeDisplayState } from "../model/trades";

/**
 * The single confirmation-tier badge (§2.1/§2.1.1-3, web.md §4.2). One component
 * renders every SURFACED tier so the semantics are product-wide and can't drift:
 *   (soft-confirmed → no chip) → posted (blue) → finalized (green).
 *
 * §12.56 (USER-DIRECTED 2026-07-12): the user-facing "Soft-confirmed" chip + its
 * L2-finality tooltip are REMOVED — the soft-confirmed display states render NO
 * badge. The tier MACHINERY is UNCHANGED and still binding: the reducer/reconcile
 * still tracks soft-confirmed, the §12.20 `global:confirmations` watermark still
 * upgrades rows, and the never-final-while-soft rule holds trivially (no chip is
 * shown until an indexed higher tier — posted/finalized — arrives). Only tier
 * (1)'s VISIBLE badge is dropped; posted/finalized surfacing stays.
 *
 * HARD RULES it enforces (proven in tests/confirmation-badge.test.tsx):
 * - A soft-confirmed trade NEVER renders as unqualified-"final"/"confirmed": it
 *   renders no settlement chip at all until it upgrades.
 * - The posted/finalized tooltips still disclose the single-sequencer dependency
 *   (§10.10) — soft confirmation is sequencer inclusion, not L1 settlement.
 */

type BadgeVariant =
  | "secondary"
  | "soft-confirmed"
  | "posted"
  | "finalized"
  | "sell";

interface BadgeMeta {
  label: string;
  variant: BadgeVariant;
  pulse: boolean;
  tooltip: string;
}

const SEQUENCER_NOTE =
  "ROBBED_ settles on a single-sequencer L2 (§10.10) — soft confirmation is FCFS sequencer inclusion, not L1 finality.";

/** Pure map from the §4 display node → badge presentation. */
export function confirmationBadgeMeta(state: TradeDisplayState): BadgeMeta | null {
  switch (state) {
    case "submitted":
      return {
        label: "Submitting",
        variant: "secondary",
        pulse: true,
        tooltip: "Sent to your wallet — waiting for you to sign.",
      };
    case "optimistic:pending":
      return {
        label: "Pending",
        variant: "soft-confirmed",
        pulse: true,
        tooltip: `Broadcast — awaiting sequencer inclusion. ${SEQUENCER_NOTE}`,
      };
    case "optimistic:soft-confirmed":
    case "indexed:soft-confirmed":
      // §12.56: the soft-confirmed tier renders NO visible chip/tooltip. The
      // state itself is unchanged (reconcile + watermark upgrades still fire);
      // the badge simply appears once the row upgrades to posted/finalized.
      return null;
    case "indexed:posted-to-l1":
      return {
        label: "Posted to L1",
        variant: "posted",
        pulse: false,
        tooltip:
          "The batch containing this trade has been posted to Ethereum L1 (safe), pending finalization.",
      };
    case "indexed:finalized":
      return {
        label: "Finalized",
        variant: "finalized",
        pulse: false,
        tooltip: "Finalized on Ethereum L1 — irreversible.",
      };
    case "failed":
      return {
        label: "Failed",
        variant: "sell",
        pulse: false,
        tooltip: "This transaction reverted or was not found by the indexer.",
      };
    case "removed":
      return null;
  }
}

/** Map a plain indexed `ConfirmationState` (a reconciled feed row) to a display node. */
export function displayStateForIndexed(state: ConfirmationState): TradeDisplayState {
  switch (state) {
    case "soft_confirmed":
      return "indexed:soft-confirmed";
    case "posted_to_l1":
      return "indexed:posted-to-l1";
    case "finalized":
      return "indexed:finalized";
  }
}

export function ConfirmationBadge({
  state,
  awaitingIndex = false,
  className,
}: {
  state: TradeDisplayState;
  /** WS-silence flag — appends an "awaiting index" note (web.md §4.5). */
  awaitingIndex?: boolean;
  className?: string;
}) {
  const meta = confirmationBadgeMeta(state);
  if (!meta) return null;
  const tooltip = awaitingIndex
    ? `${meta.tooltip} Awaiting the indexer — retrying.`
    : meta.tooltip;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={meta.variant}
            className={cn(
              "gap-1",
              meta.pulse && "animate-pulse",
              awaitingIndex && "opacity-80",
              className,
            )}
          >
            {meta.pulse && (
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-current"
              />
            )}
            {meta.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
