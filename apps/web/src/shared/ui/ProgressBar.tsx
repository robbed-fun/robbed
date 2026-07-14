import { Progress } from "./kit/progress";
import { formatPercent } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * Graduation progress (card / Trust panel). `pct` is the indexer's
 * `progressPct` (real_eth_reserves / graduation_eth) — a supplied value, never
 * computed here. Clamped to [0,100] for the bar geometry only.
 */
export function ProgressBar({
  pct,
  label,
  showValue = true,
  className,
  graduated = false,
}: {
  pct: number;
  label?: string;
  showValue?: boolean;
  className?: string;
  graduated?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <div className={cn("w-full", className)}>
      {(label || showValue) && (
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          {showValue && (
            <span className="tabular-nums text-foreground">
              {graduated ? "Graduated" : formatPercent(clamped)}
            </span>
          )}
        </div>
      )}
      <Progress
        value={graduated ? 100 : clamped}
        className={graduated ? "[&>div]:bg-finalized" : undefined}
      />
    </div>
  );
}
