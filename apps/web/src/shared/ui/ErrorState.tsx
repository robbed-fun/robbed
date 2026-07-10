"use client";

import { Button } from "./kit/button";
import { cn } from "@/shared/lib/utils";

/**
 * Inline error with retry (§5.1: "retry per section — hero failure must not
 * blank the grid and vice versa"). Section-scoped, never a full-page blank.
 */
export function ErrorState({
  title = "Couldn't load this",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-8 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
