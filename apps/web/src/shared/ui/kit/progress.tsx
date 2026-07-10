"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/shared/lib/utils";

/**
 * Vendored shadcn/ui Progress (new-york, Radix) — code we own (§12.24).
 * Used by the graduation ProgressBar (§5.1/§5.2). Indicator color is token-backed
 * (bg-primary); callers may override to buy/etc via className, never raw hex.
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
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
