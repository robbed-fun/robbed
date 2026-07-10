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
 * Brand accent is a PLACEHOLDER (§13 name/brand pending — NEEDS-USER final art).
 */
export const OG_COLORS = {
  bg: "#0a0c10",
  surface: "#11151c",
  surface2: "#161b24",
  border: "#232a36",
  text: "#e6e9ef",
  muted: "#8b93a3",
  buy: "#22c55e",
  sell: "#ef4444",
  // §13 brand pending — placeholder violet, mirrors --color-accent.
  accent: "#7c3aed",
  accentForeground: "#ffffff",
  softConfirmed: "#f59e0b",
} as const;

/** Fixed OG canvas (web.md §6): 1200×630, the X/Telegram/Discord share unit. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_SIZE = { width: OG_WIDTH, height: OG_HEIGHT } as const;
export const OG_CONTENT_TYPE = "image/png";
