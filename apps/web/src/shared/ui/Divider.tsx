import { cn } from "@/shared/lib/utils";

/**
 * Hairline rule (ROBBED_ Phase F) — the mockup's row/table dividers are 1px of
 * the `border-soft` token, one shade below control borders. `strong` bumps to
 * the control-border tone for section breaks.
 */
export function Divider({
  orientation = "horizontal",
  strong = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  orientation?: "horizontal" | "vertical";
  strong?: boolean;
}) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        strong ? "bg-border" : "bg-border-soft",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px self-stretch",
        className,
      )}
      {...props}
    />
  );
}
