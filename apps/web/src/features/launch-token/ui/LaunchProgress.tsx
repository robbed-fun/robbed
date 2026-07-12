"use client";

import Link from "next/link";
import type { Address } from "viem";

import { ConfirmationBadge, type TrackedTrade, tradeDisplayState } from "@/entities/trade";
import { Button, Card } from "@/shared/ui";
import { cn } from "@/shared/lib/utils";

import {
  type LaunchStep,
  LAUNCH_STEP_ORDER,
  launchStepLabel,
} from "../model/steps";

/**
 * Post-submit stepper (§5.3: "form → upload/pin → sign → live"). The soft-confirmed
 * tier is shown via the SHARED `ConfirmationBadge` (driven by the optimistic
 * reducer's display state) so the launch tx renders the exact same confirmation
 * semantics as every trade — never an unqualified "confirmed" (§2.1).
 */
export function LaunchProgress({
  step,
  error,
  tokenAddress,
  optimisticTrade,
}: {
  step: LaunchStep;
  error: string | null;
  tokenAddress: Address | null;
  optimisticTrade: TrackedTrade | null;
}) {
  if (step === "idle") return null;

  const activeIndex = LAUNCH_STEP_ORDER.indexOf(
    step === "indexing" || step === "live-unindexed" ? "soft-confirmed" : step,
  );

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Launching</h3>
        {optimisticTrade && (step === "pending" || step === "soft-confirmed" || step === "indexing" || step === "live-unindexed" || step === "live") && (
          <ConfirmationBadge state={tradeDisplayState(optimisticTrade)} />
        )}
      </div>

      <ol className="flex flex-col gap-1.5">
        {LAUNCH_STEP_ORDER.map((node, i) => {
          const done = activeIndex > i || step === "live";
          const active = activeIndex === i && step !== "live";
          return (
            <li key={node} className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]",
                  done
                    ? "bg-buy text-white"
                    : active
                      ? "bg-soft-confirmed text-white"
                      : "bg-secondary text-muted-foreground",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={cn(active ? "text-foreground" : "text-muted-foreground")}>
                {launchStepLabel(node)}
                {active && node !== "soft-confirmed" && "…"}
              </span>
            </li>
          );
        })}
      </ol>

      {step === "verify-failed" && (
        <p className="rounded-md border border-sell/40 bg-sell/10 p-2 text-xs text-sell">
          {error}
        </p>
      )}

      {step === "error" && error && (
        <p className="rounded-md border border-sell/40 bg-sell/10 p-2 text-xs text-sell">
          {error}
        </p>
      )}

      {step === "live-unindexed" && tokenAddress && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Your token is live and tradeable. The indexer is still catching
            up — open it directly:
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href={`/t/${tokenAddress}`}>Open your token ↗</Link>
          </Button>
        </div>
      )}

      {step === "live" && (
        <p className="text-xs text-muted-foreground">Opening your token…</p>
      )}
    </Card>
  );
}
