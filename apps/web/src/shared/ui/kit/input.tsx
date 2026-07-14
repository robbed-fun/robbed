import * as React from "react";

import { cn } from "@/shared/lib/utils";

/**
 * Vendored shadcn/ui Input (new-york) — code we own, restyled to the
 * ROBBED_ terminal tokens (Phase F): square, hairline #1C221C border, mono 13px,
 * faint placeholder, green border on focus (mockup search/NAME/TICKER fields).
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-none border border-input bg-transparent px-3 py-1 text-base text-foreground transition-colors placeholder:text-faint focus-visible:border-green focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
