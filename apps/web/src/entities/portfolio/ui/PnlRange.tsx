import type { EthPnlRange } from "@robbed/shared";
import { formatEther } from "viem";

import { cn } from "@/shared/lib/utils";

import { pnlTone, signedEth } from "../lib/format";

/**
 * PnL display for an `EthPnlRange | null` (mockup: the PNL column + LOOT ALL-TIME
 * cell). Renders the API's shape HONESTLY (§5.2 — no false precision):
 *   - `null` (no cost basis)        → faint placeholder, NOT a "0" gain.
 *   - `low === high` (exact/known)  → a single signed value `+0.62`.
 *   - a true range                  → `low…high` (`+0.50…+0.70`).
 * Tone is committed only when the whole range shares a sign (see `pnlTone`); a
 * range straddling zero renders muted rather than guessing win vs loss. The
 * cost-basis `confidence` is disclosed on hover (native `title`).
 */

const TONE_CLASS: Record<"green" | "red" | "muted", string> = {
  green: "text-green",
  red: "text-red",
  muted: "text-muted",
};

export function PnlRange({
  range,
  placeholder = "—",
  unit = null,
  className,
}: {
  range: EthPnlRange | null;
  placeholder?: string;
  /** Optional unit suffix — LOOT ALL-TIME renders "+1.94 ETH" (template.html:505),
   * same color as the number; the holdings PNL column passes none. */
  unit?: string | null;
  className?: string;
}) {
  if (!range) {
    return (
      <span className={cn("tabular-nums text-faint", className)} title="no cost basis">
        {placeholder}
      </span>
    );
  }

  const low = Number(formatEther(BigInt(range.low)));
  const high = Number(formatEther(BigInt(range.high)));
  const single = range.low === range.high;
  const text = single ? signedEth(low) : `${signedEth(low)}…${signedEth(high)}`;
  const title =
    range.confidence === "estimated"
      ? "estimated — cost basis is best-effort"
      : "exact cost basis";

  return (
    <span
      className={cn("tabular-nums", TONE_CLASS[pnlTone(low, high)], className)}
      title={title}
    >
      {text}
      {/* Unit inherits the number's tone — one color, like EthAmount. */}
      {unit ? <span className="ml-1">{unit}</span> : null}
    </span>
  );
}
