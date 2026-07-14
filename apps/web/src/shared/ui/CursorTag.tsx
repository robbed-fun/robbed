import { cn } from "@/shared/lib/utils";

/**
 * The trailing blinking-cursor `_` motif (ROBBED_ Phase F) — e.g. `ROBBED_`.
 * Mockup taglines are 11px faint; the cursor inherits the
 * tagline color there and is GREEN only in the wordmark, so `cursor="green"` is
 * opt-in. Blink respects the CSS `--animate-blink` token (steps, 1.1s).
 */
export function CursorTag({
  cursor = "inherit",
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { cursor?: "inherit" | "green" }) {
  return (
    <span className={cn("text-xs text-faint", className)} {...props}>
      {children}
      <span
        aria-hidden
        className={cn("animate-blink", cursor === "green" && "text-green")}
      >
        _
      </span>
    </span>
  );
}
