import { cn } from "@/shared/lib/utils";

import styles from "./LootMascot.module.css";

/**
 * LOOT_ — the ROBBED_ mascot (design exploration 3a, the ratified winner:
 * "the money bag that stole itself"). See `docs/developers/mascot.md` and
 * `docs/developers/ROBBED Explorations.html` §3a for the concept + placement
 * lockups. A green sack in a permanent bandit mask with two darting pupils,
 * stamped with the brand `_`.
 *
 * VERBATIM GEOMETRY: the inline SVG below is the ratified design — the shape
 * coordinates AND the illustration fills are part of the brand asset, not
 * themeable UI, so this slice is exempt from the design-token colour lint the
 * same way `shared/ui/kit` is (recorded in `tests/copy-lint.test.ts`). Do not
 * re-map the fills to tokens; that changes the character.
 *
 * SSR-SAFE / PURE SVG: no "use client", no hooks, no client JS. Renders
 * identically on the server (favicon/OG/RSC 404) and the client; the idle
 * motion is 100% CSS (the sibling `.module.css`) so it costs zero hydration.
 *
 * ANIMATION (decision, robbed-frontend): the idle sway (`.figure`) is applied to
 * the OUTER `<svg>` element so its `translateY`/`rotate` resolve in CSS pixels —
 * a size-independent bob that matches the design exploration's div-based motion
 * at any `size`. The pupil dart (`.pupil`) is applied to the two `<circle>`s so
 * it resolves in SVG user units and therefore scales WITH the mascot (a favicon
 * shouldn't dart as far as the hero). Both keyframes self-disable under
 * `prefers-reduced-motion` (in the module). `animated={false}` drops both classes
 * for a fully static lockup (favicon / logo / OG image).
 */
export function LootMascot({
  size = 96,
  animated = true,
  className,
  label = "LOOT_ — the ROBBED_ mascot",
}: {
  /** Rendered width in px; height derives from the 232×222 viewBox. */
  size?: number;
  /** Idle motion on (default) or a static lockup (favicon/logo/OG). */
  animated?: boolean;
  className?: string;
  /**
   * Accessible name. Defaults to the mascot's name; pass `label=""` to mark the
   * mascot purely decorative (`aria-hidden`) when adjacent text already names it
   * (e.g. the `ROBBED_` wordmark in a lockup).
   */
  label?: string;
}) {
  const width = size;
  // viewBox is 232 wide × 222 tall (`-8 -4 232 222`); keep that aspect ratio.
  const height = (size * 222) / 232;
  const decorative = label === "";
  const pupilClass = animated ? styles.pupil : undefined;

  return (
    <svg
      viewBox="-8 -4 232 222"
      width={width}
      height={height}
      focusable="false"
      className={cn(animated && styles.figure, className)}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label })}
      style={{ display: "block", overflow: "visible" }}
    >
      {/* left + right sack-tie ears */}
      <ellipse cx="82" cy="20" rx="8" ry="14" transform="rotate(-24 82 20)" fill="#16A34A" />
      <ellipse cx="118" cy="20" rx="8" ry="14" transform="rotate(24 118 20)" fill="#16A34A" />
      {/* cinched neck knot */}
      <ellipse cx="100" cy="16" rx="9" ry="16" fill="#22C55E" />
      <rect x="77" y="26" width="46" height="24" rx="7" fill="#4ADE80" />
      {/* the bag body */}
      <ellipse cx="100" cy="128" rx="90" ry="76" fill="#4ADE80" />
      {/* drawstring band */}
      <rect x="70" y="44" width="60" height="13" rx="6.5" fill="#15803D" />
      {/* bandit mask + eyes (tilted, permanent) */}
      <g transform="rotate(-3 100 112)">
        <rect x="-2" y="92" width="204" height="40" rx="9" fill="#131A12" />
        <ellipse cx="69" cy="112" rx="13" ry="9" fill="#EDF3ED" />
        <ellipse cx="131" cy="112" rx="13" ry="9" fill="#EDF3ED" />
        <circle cx="69" cy="112" r="4" fill="#0B0D0B" data-loot-pupil className={pupilClass} />
        <circle cx="131" cy="112" r="4" fill="#0B0D0B" data-loot-pupil className={pupilClass} />
      </g>
      {/* the `$`-stamp band (brand underscore stand-in) */}
      <rect x="79" y="168" width="42" height="9" rx="3" fill="#15803D" />
    </svg>
  );
}
