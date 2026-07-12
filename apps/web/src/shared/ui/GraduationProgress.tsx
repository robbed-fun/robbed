import type { ReactNode } from "react";

import { Badge } from "./kit/badge";
import { ProgressBar } from "./ProgressBar";
import { formatEthFromWei } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * GraduationProgress (§5.1 card / §5.2 token detail) — the ONE presentational
 * graduation/venue-lifecycle indicator, shared by the Discover card (compact) and
 * the token-detail SafetyStrip (full).
 *
 * PURELY PRESENTATIONAL: it NEVER fetches or reads on-chain — every value arrives
 * via props so each call site owns its data source (the SafetyStrip feeds it LIVE
 * `useCurveReads` reserves ÷ live threshold per spec §5.2; the card feeds the
 * indexer's cached `progressPct`). The graduation threshold is NEVER hardcoded —
 * `graduationEth` comes from the caller (spec §2: no inlined market metric).
 *
 * PLACEMENT (FSD decision rule): business-agnostic → `shared`. It cannot live in
 * `entities/curve` because it is consumed by BOTH `entities/token/TokenCard` (a
 * SIBLING entity) and `widgets/safety-strip`; an entity→sibling-entity import is
 * rejected by the enforced FSD boundary lint (tests/copy-lint.test.ts). The curve
 * entity keeps the on-chain READS; only this render is shared. (Flagged for the
 * architect — the task suggested `entities/curve`, which the lint forbids here.)
 *
 * Status → indicator (`tokenStatusSchema`):
 *   - `graduated`  → a "Graduated" verdict (migrated to Uniswap V3).
 *   - `graduating` → the §12.12 ready-to-graduate / lock-window pill ("Graduating").
 *   - `curve`      → the in-progress bar + percentage.
 *
 * a11y: the bar is a Radix progressbar (`role="progressbar"` + `aria-valuenow`).
 */

export type GraduationStatus = "curve" | "graduating" | "graduated";

export interface GraduationProgressProps {
  /**
   * Graduation progress, 0–100. Drives the bar geometry + the "%" text (clamped
   * for geometry only). On cards this is the indexer's `progressPct`; on token
   * detail it is the LIVE-computed reserves ÷ threshold.
   */
  progressPct: number;
  /** Venue/lifecycle status (shared `tokenStatusSchema`). */
  status: GraduationStatus;
  /** FULL variant only: raised ETH (wei). `null` while a live read is unavailable. */
  raisedEth?: string | bigint | null;
  /** FULL variant only: graduation threshold (wei) — NEVER hardcoded, from props. */
  graduationEth?: string | bigint | null;
  /** `full` = token-detail (raised/threshold label); `compact` = list card. */
  variant?: "full" | "compact";
  /** FULL variant only: a live read is still in flight → "reading chain…". */
  loading?: boolean;
  /** FULL/graduated only: optional right-aligned slot (e.g. a V3 pool link). */
  trailing?: ReactNode;
  className?: string;
}

function toBigintOrNull(v: string | bigint | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  try {
    return typeof v === "bigint" ? v : BigInt(v);
  } catch {
    return null;
  }
}

const clampPct = (p: number) => Math.max(0, Math.min(100, Number.isFinite(p) ? p : 0));
/** 1-decimal graduation percent, clamped (mockup: "43.3%"). */
const pctText = (p: number) => `${clampPct(p).toFixed(1)}%`;

export function GraduationProgress({
  progressPct,
  status,
  raisedEth,
  graduationEth,
  variant = "full",
  loading = false,
  trailing,
  className,
}: GraduationProgressProps) {
  const compact = variant === "compact";

  // ── graduated → verdict (no live progress; curve is retired) ────────────────
  if (status === "graduated") {
    if (compact) {
      return (
        <div className={cn("flex items-center gap-2", className)}>
          <div className="min-w-0 flex-1">
            <ProgressBar pct={100} graduated showValue={false} />
          </div>
          <Badge variant="finalized" className="shrink-0">
            Graduated
          </Badge>
        </div>
      );
    }
    return (
      <div className={cn("flex items-center justify-between text-xs", className)}>
        <span className="text-green">Graduated ✓ → Uniswap V3</span>
        {trailing}
      </div>
    );
  }

  const graduating = status === "graduating";

  // ── full variant: loading / unavailable gates, then the raised-label bar ─────
  if (!compact) {
    const raised = toBigintOrNull(raisedEth);
    const grad = toBigintOrNull(graduationEth);
    const dataReady = raised !== null && grad !== null && grad > 0n;

    // Mirrors the SafetyStrip contract EXACTLY (spec §5.2): a settled read with no
    // value degrades to "unavailable" — NEVER a cached API value substituted in.
    if (!dataReady) {
      return (
        <p className={cn("text-xs text-muted-foreground", className)}>
          {loading ? "reading chain…" : "on-chain read unavailable — retry"}
        </p>
      );
    }

    return (
      <div className={cn("flex flex-col gap-1", className)}>
        {graduating && (
          <Badge variant="posted" className="self-start">
            Graduating
          </Badge>
        )}
        <ProgressBar pct={progressPct} showValue={false} />
        <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
          <span>
            {formatEthFromWei(raised)} / {formatEthFromWei(grad)} ETH raised
          </span>
          <span>{pctText(progressPct)}</span>
        </div>
      </div>
    );
  }

  // ── compact variant (curve / graduating): slim bar + % or lock-window pill ───
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="min-w-0 flex-1">
        <ProgressBar pct={progressPct} showValue={false} />
      </div>
      {graduating ? (
        <Badge variant="posted" className="shrink-0">
          Graduating
        </Badge>
      ) : (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {pctText(progressPct)}
        </span>
      )}
    </div>
  );
}
