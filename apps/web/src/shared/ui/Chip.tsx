"use client";

import { cn } from "@/shared/lib/utils";

/**
 * Terminal chip (ROBBED_ Phase F). Two mockup uses, two variants:
 *  - `fill`   — tape filter chips (ALL/LAUNCHES/…): active = solid `bg-active`
 *               fill, inactive = muted text, no border. Sampled padding
 *               5px 10px @ 11px.
 *  - `outline`— quick-amount chips (0.1/0.5/1/MAX) on AmountInput: hairline
 *               border at rest, green border + green text when active.
 * Square corners (radius tokens are 0), mono, uppercase-agnostic (callers pass
 * the exact label).
 */
export function Chip({
  active = false,
  variant = "fill",
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & {
  active?: boolean;
  variant?: "fill" | "outline";
}) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap px-2.5 py-[5px] text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variant === "fill" &&
          (active ? "bg-active text-text" : "text-muted hover:text-text"),
        variant === "outline" &&
          (active
            ? "border border-green text-green"
            : "border border-border text-muted hover:text-text"),
        className,
      )}
      {...props}
    />
  );
}
