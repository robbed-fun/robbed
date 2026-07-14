import * as React from "react";

import { cn } from "@/shared/lib/utils";

/**
 * Vendored shadcn/ui Textarea — code we own, restyled to the ROBBED_
 * terminal tokens (Phase F): square, hairline border, mono 13px, faint
 * placeholder (matches the mockup's DESCRIPTION field).
 */
function TextArea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full rounded-none border border-input bg-transparent px-3 py-2 text-base text-foreground transition-colors placeholder:text-faint focus-visible:border-green focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { TextArea };
