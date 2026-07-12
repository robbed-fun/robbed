import { formatPercent, percentRoundsToZero } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * Signed percentage delta (ROBBED_ Phase F): `+41.2%` green / `−1.8%` red /
 * zero muted, per the mockup tape + trending cards. `value` is a SUPPLIED
 * indexer/API percentage — never computed here (§2). `null` renders the
 * `placeholder` (the mockup shows faint "new" for just-launched rows).
 */
export function Delta({
  value,
  placeholder = "—",
  className,
  ...props
}: React.ComponentProps<"span"> & {
  /** Percentage points, e.g. 41.2 for +41.2%. */
  value: number | null;
  placeholder?: string;
}) {
  if (value === null || !Number.isFinite(value)) {
    return (
      <span className={cn("text-sm text-faint tabular-nums", className)} {...props}>
        {placeholder}
      </span>
    );
  }
  // Tone follows the ROUNDED display value (review fix 2026-07-11): −0.04
  // renders "0.0%" and must tint neutral — never a red/green zero.
  const tone = percentRoundsToZero(value)
    ? "text-muted"
    : value > 0
      ? "text-green"
      : "text-red";
  return (
    <span className={cn("text-sm tabular-nums", tone, className)} {...props}>
      {formatPercent(value, { signed: true })}
    </span>
  );
}
