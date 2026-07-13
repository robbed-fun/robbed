import { cn } from "@/shared/lib/utils";

/**
 * ROBBED_ terminal text atoms (redesign Phase F; ratified redesign, spec §12.50).
 *
 * `MonoText` — tone/size-tokenized inline text (everything is mono already via
 * the body font; these map the mockup's exact text ramp + accent hues).
 * `MonoLabel` — the uppercase micro-label (TRENDING, YOU PAY, PRICE, AGE …):
 * sampled 10.5–11px, the `faint` text token, letter-spacing 0.12em.
 */

const TONES = {
  default: "text-text",
  secondary: "text-text-secondary",
  tertiary: "text-text-tertiary",
  muted: "text-muted",
  faint: "text-faint",
  green: "text-green",
  red: "text-red",
  purple: "text-purple",
} as const;

const SIZES = {
  "2xs": "text-2xs",
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
} as const;

export type MonoTone = keyof typeof TONES;
export type MonoSize = keyof typeof SIZES;

export function MonoText({
  tone = "default",
  size = "base",
  numeric = false,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  tone?: MonoTone;
  size?: MonoSize;
  /** Tabular numerals — set on every numeric value (web.md §7). */
  numeric?: boolean;
}) {
  return (
    <span
      className={cn(SIZES[size], TONES[tone], numeric && "tabular-nums", className)}
      {...props}
    />
  );
}

export function MonoLabel({
  tone = "faint",
  size = "xs",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: MonoTone; size?: MonoSize }) {
  return (
    <span
      className={cn("uppercase tracking-label", SIZES[size], TONES[tone], className)}
      {...props}
    />
  );
}
