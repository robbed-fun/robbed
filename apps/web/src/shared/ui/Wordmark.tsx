import { cn } from "@/shared/lib/utils";

/**
 * The ROBBED_ wordmark (redesign Phase F). Sampled from the ratified redesign (spec §12.50):
 * 14px (`text-md`), weight 600, letter-spacing 0.12em (`tracking-label`),
 * primary text with a GREEN blinking `_` cursor. Rendered as static text +
 * cursor span so it works in RSC (no client JS; the blink is pure CSS).
 * Brand titles/strings elsewhere use `BRAND` from `@/shared/config/copy`.
 */
export function Wordmark({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("text-md font-semibold tracking-label text-text", className)}
      {...props}
    >
      ROBBED
      <span aria-hidden className="animate-blink text-green">
        _
      </span>
    </span>
  );
}
