"use client";

import { cn } from "@/shared/lib/utils";

/**
 * Flat terminal tab strip (ROBBED_ Phase F) — the mockup's ALL/LAUNCHES/TRADES/
 * GRADUATIONS and HOLDINGS/ACTIVITY/CREATED rows, and the chart's 1H/4H/1D/ALL.
 * Active = solid `bg-active` fill; inactive = muted text. Sampled 11px,
 * padding 5px 10px, square corners.
 *
 * Deliberately NOT Radix Tabs (kit/tabs stays for panel-switching semantics):
 * these are filter tabs whose state lives in the URL / parent — a styled button
 * row with `role="tablist"` is the entire contract.
 */
export function TabBar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-1 overflow-x-auto", className)}
      {...props}
    />
  );
}

export function Tab({
  active = false,
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type={type}
      role="tab"
      aria-selected={active}
      className={cn(
        "whitespace-nowrap px-2.5 py-[5px] text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-active text-text" : "text-muted hover:text-text",
        className,
      )}
      {...props}
    />
  );
}
