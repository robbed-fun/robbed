import { cn } from "@/shared/lib/utils";

/**
 * Live indicator (ROBBED_ Phase F) — the tape's `● LIVE`: 7px green dot +
 * 11px green label (sampled). `pulse` can be disabled for a static
 * connected-state dot; `label=""` renders the dot alone.
 */
export function LiveDot({
  label = "LIVE",
  pulse = true,
  className,
  ...props
}: React.ComponentProps<"span"> & { label?: string; pulse?: boolean }) {
  return (
    <span
      className={cn("inline-flex items-center gap-[7px] text-xs text-green", className)}
      {...props}
    >
      <span
        aria-hidden
        className={cn("size-[7px] rounded-full bg-green", pulse && "animate-pulse")}
      />
      {label ? label : null}
    </span>
  );
}
