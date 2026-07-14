/**
 * Fixed Token-Detail hero height (layout — 2026-07-12 revision, supersedes
 * the viewport-fill approach).
 *
 * DECISION (robbed-frontend, recorded per web workflow):
 * the hero row (chart LEFT | trade form RIGHT) is a FIXED pixel height, NOT a
 * `100dvh - header` calc and NOT the measuring `useViewportFillHeight` hook that
 * used to drive it. Rationale for reverting to a constant:
 *   - Simpler + deterministic: no ResizeObserver / innerHeight measurement, no
 *     `null`-until-first-frame fallback, no feedback-loop reasoning.
 *   - The chart must NOT grow/shrink with the window — a fixed height keeps the
 *     terminal chart panel a stable size regardless of viewport (the whole point
 *     of dropping the calc).
 *   - Chosen to fit a MacBook 13" (1440×900 / 1512×982) FIRST SCREEN: the usable
 *     content height below the app header + banners + the token identity row is
 *     ~700px there, so 600px leaves the chart + trade form fully visible with no
 *     page scroll, plus headroom for the banners that mount conditionally.
 *
 * SINGLE TUNABLE KNOB: `TD_HERO_HEIGHT_PX` is the only number to change. It is
 * published to CSS as the `--td-hero-h` custom property on the hero row; BOTH
 * columns take `lg:h-full`, so the chart box and the trade-form box are exactly
 * equal-height (aligned top and bottom). The queued token-detail redesign (Top
 * Holders on the right, no Trust panel) reuses the same var to stay aligned.
 *
 * Scoped to `lg:` only — the mobile stacked layout keeps its own heights.
 */
export const TD_HERO_HEIGHT_PX = 600;

/** `TD_HERO_HEIGHT_PX` as a CSS length, for the `--td-hero-h` custom property. */
export const TD_HERO_HEIGHT = `${TD_HERO_HEIGHT_PX}px`;
