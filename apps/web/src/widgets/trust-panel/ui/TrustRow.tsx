import { MonoLabel } from "@/shared/ui";
import { cn } from "@/shared/lib/utils";

/**
 * One Trust-panel row (§5.2) — ROBBED_ terminal skin: a tone-marked uppercase
 * micro-label over the value, split by hairline `border-soft` dividers. Purely
 * presentational — the panel decides sourcing.
 */
export type TrustTone = "ok" | "warn" | "neutral" | "pending";

const toneMark: Record<TrustTone, string> = {
  ok: "✓",
  warn: "⚠",
  neutral: "·",
  pending: "…",
};

const toneClass: Record<TrustTone, string> = {
  ok: "text-green",
  warn: "text-red",
  neutral: "text-muted",
  pending: "text-muted",
};

export function TrustRow({
  label,
  tone = "neutral",
  children,
  verify,
  className,
}: {
  label: string;
  tone?: TrustTone;
  children: React.ReactNode;
  /** Verify affordance (usually a Blockscout <AddressLink/>). */
  verify?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-b border-border-soft py-2.5 last:border-b-0",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className={cn("text-xs", toneClass[tone])} aria-hidden>
            {toneMark[tone]}
          </span>
          <MonoLabel size="2xs">{label}</MonoLabel>
        </span>
        {verify}
      </div>
      <div className="pl-4 text-sm text-text">{children}</div>
    </div>
  );
}
