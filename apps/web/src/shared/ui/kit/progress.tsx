"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/shared/lib/utils";

/**
 * Vendored shadcn/ui Progress (new-york, Radix) — code we own.
 * Used by the graduation ProgressBar. Indicator color is token-backed
 * (bg-primary); callers may override to buy/etc via className, never raw hex.
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      // Pass `value` to the Root (not only the Indicator transform below) so the
      // primitive emits `aria-valuenow`/`aria-valuemin`/`aria-valuemax` — a
      // screen reader announces the graduation progress, not just an unlabelled
      // progressbar. Callers clamp to [0,100] (ProgressBar), so it is always valid.
      value={value}
      className={cn(
        // ROBBED_ terminal restyle (Phase F): flat 4px square bar, green fill
        // (bg-primary == the green accent token), surface-2 track.
        "relative h-1 w-full overflow-hidden rounded-none bg-secondary",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-transform"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
