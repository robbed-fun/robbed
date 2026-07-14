import { cn } from "@/shared/lib/utils";

import { Wordmark } from "../Wordmark";
import { LootMascot } from "./LootMascot";

/**
 * The ROBBED_ brand LOCKUP (design exploration §3 / §4, "Loot adopted — brand
 * lockups"): the LOOT_ mascot beside the `ROBBED_` wordmark, as one unit. The
 * design's lockup is a scaled mascot + gap + `ROBBED` with the terminal `_` in
 * accent green — which is exactly what the shared `Wordmark` renders (the `_`
 * uses `text-green`, matching `copy.BRAND` and the `CursorTag` motif). This
 * component just composes the two so every surface renders an identical lockup.
 *
 * COMPOSITION, not a rebuild: `LootMascot` (the ratified inline-SVG asset) and
 * `Wordmark` (the ratified wordmark atom) are consumed verbatim — this file adds
 * no illustration geometry and no raw colour, only layout. The mascot is marked
 * DECORATIVE (`label=""`) because the adjacent `Wordmark` text already names the
 * brand for assistive tech (mascot.md).
 *
 * SSR-SAFE: pure presentational, no "use client" / hooks — both children are
 * server-renderable, so the lockup works in RSC headers and static shells.
 *
 * MOTION: `animated` mirrors `LootMascot` (idle sway + pupil dart, self-disabled
 * under `prefers-reduced-motion`). Pass `animated={false}` for the static logo
 * variant (headers / logo slots) so the brand mark never distracts; the default
 * matches the underlying mascot.
 */
export function MascotLockup({
  size = 28,
  animated = true,
  className,
  wordmarkClassName,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  /** Rendered width of the mascot in px; the wordmark keeps its atom size. */
  size?: number;
  /** Idle motion on (default) or a static lockup (header / logo). */
  animated?: boolean;
  /** Extra classes forwarded to the `Wordmark` (e.g. to scale the type). */
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} {...props}>
      <LootMascot size={size} animated={animated} label="" />
      <Wordmark className={wordmarkClassName} />
    </span>
  );
}
