/**
 * OG-image palette + dimensions (web.md §6/§7). ── WHY THIS LIVES IN shared/lib ──
 *
 * The satori/resvg pipeline renders a standalone PNG with NO access to the DOM,
 * to Tailwind, or to the `globals.css` CSS custom properties (web.md §7). So the
 * OG card cannot consume the design tokens by name — it needs literal colors at
 * render time. To keep the design-token contract honest we mirror the semantic
 * token VALUES from `globals.css` here, in ONE place, and every OG component
 * imports named colors from this object (never a raw hex in a widget/view — the
 * token-bypass lint, tests/token-lint.test.ts, exempts `shared/lib` precisely so
 * this non-DOM render surface can hold the mirrored palette). Re-theming stays a
 * value swap: update `globals.css` and this mirror together.
 *
 * ROBBED_ terminal re-art (task A): these are the EXACT ROBBED_ token values
 * sampled from `docs/Robbed.html` (web.md §7) — dark `#0B0D0B` canvas, green
 * `#4ADE80` accent, the mono text ramp. The wordmark accent is now the brand
 * green (no longer a §13 placeholder violet).
 */
export const OG_COLORS = {
  bg: "#0B0D0B",
  surface: "#0F130F",
  surface2: "#141914",
  border: "#1C221C",
  borderSoft: "#141914",
  text: "#EDF3ED",
  textSecondary: "#C9D3C9",
  muted: "#6E7A6E",
  faint: "#54604F",
  buy: "#4ADE80",
  sell: "#F87171",
  // ROBBED_ up/down candle fills (mockup chart bars).
  candleUp: "#2E4A34",
  candleDown: "#4A2E2E",
  // Brand accent = ROBBED_ green (§13 brand resolved by the redesign direction).
  accent: "#4ADE80",
  accentForeground: "#0B0D0B",
  greenDim: "#16301F",
  softConfirmed: "#F59E0B",
  purple: "#A78BFA",
} as const;

/** Fixed OG canvas (web.md §6): 1200×630, the X/Telegram/Discord share unit. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_SIZE = { width: OG_WIDTH, height: OG_HEIGHT } as const;
export const OG_CONTENT_TYPE = "image/png";
