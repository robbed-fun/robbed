import type { OrganicFlow } from "@robbed/shared";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui";
import { formatPercent } from "@/shared/lib/format";

import { TrustRow } from "./TrustRow";

/**
 * v1.2 organic-flow metrics (§5.2/§8.5) — appended to the Trust panel, sourced
 * ENTIRELY from the indexer's `trust.organic` feed (no new on-chain surface).
 *
 * HARD RULES (spec §5.2/§8.5), proven in tests/trust-panel.test.tsx:
 * - The organic-holder estimate is ALWAYS a RANGE ("~55–70%"), never a single
 *   false-precise number. When stats are absent (fresh token) it shows
 *   "estimating…".
 * - Everything here is an ADVISORY heuristic; copy frames it as such and it gates
 *   nothing. Flow-quality wording is neutral (no accusation).
 */
export function OrganicMetrics({ organic }: { organic: OrganicFlow | null }) {
  if (!organic || organic.updatedAt === null) {
    return (
      <>
        <TrustRow label="Organic holder estimate" tone="pending">
          <span className="text-muted-foreground">estimating…</span>
        </TrustRow>
        <TrustRow label="Flow quality (24h)" tone="pending">
          <span className="text-muted-foreground">estimating…</span>
        </TrustRow>
      </>
    );
  }

  const low = Math.round(organic.holderPctLow);
  const high = Math.round(organic.holderPctHigh);

  return (
    <>
      <TrustRow
        label="Organic holder estimate"
        tone="neutral"
        verify={
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-wide text-muted-foreground underline decoration-dotted underline-offset-2"
                >
                  methodology
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {organic.methodology} These are heuristic estimates, not exact
                figures, and gate nothing.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        }
      >
        <span className="tabular-nums">
          ~{low}–{high}%
        </span>{" "}
        <span className="text-xs text-muted-foreground">
          of holders look organic (heuristic)
        </span>
      </TrustRow>

      <TrustRow label="Flow quality (24h)" tone="neutral">
        <span className="tabular-nums">{formatPercent(organic.volumePct)}</span>{" "}
        <span className="text-xs text-muted-foreground">organic curve volume</span>
        <span className="mx-1 text-muted-foreground">·</span>
        <span className="tabular-nums">
          {formatPercent(organic.flaggedClusterVolPct24h)}
        </span>{" "}
        <span className="text-xs text-muted-foreground">from flagged clusters</span>
      </TrustRow>
    </>
  );
}
