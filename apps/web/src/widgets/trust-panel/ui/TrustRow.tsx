import { cn } from "@/shared/lib/utils";

/**
 * One Trust-panel row (§5.2): label + value + optional verify affordance, with a
 * verdict tone. Purely presentational — the panel decides sourcing.
 */
export type TrustTone = "ok" | "warn" | "neutral" | "pending";

const toneMark: Record<TrustTone, string> = {
  ok: "✓",
  warn: "⚠",
  neutral: "·",
  pending: "…",
};

const toneClass: Record<TrustTone, string> = {
  ok: "text-finalized",
  warn: "text-sell",
  neutral: "text-muted-foreground",
  pending: "text-muted-foreground",
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
        "flex flex-col gap-0.5 border-b border-border/60 py-2 last:border-b-0",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span className={cn("font-semibold", toneClass[tone])} aria-hidden>
            {toneMark[tone]}
          </span>
          {label}
        </span>
        {verify}
      </div>
      <div className="pl-4 text-sm text-foreground">{children}</div>
    </div>
  );
}
