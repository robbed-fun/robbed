/**
 * OG-image palette + canvas dimensions (api.md §3 OG endpoint; spec §5.2 share
 * card). PORTED verbatim from the frontend's `apps/web/src/shared/lib/og/theme.ts`
 * — the ROBBED_ terminal palette sampled from the ratified redesign (spec §12.50) (dark `#0B0D0B`
 * canvas, green `#4ADE80` accent, the mono text ramp). The API is now the SINGLE
 * OG renderer (the web copy is being deleted), so this is the one place the OG
 * palette lives; there is no cross-service duplication once the port lands.
 *
 * These are literal render-time colors, NOT market metrics — the §2 "never
 * hardcode market metrics" rule is about prices/TVL/volumes (which the card pulls
 * live from the indexer), not brand color values.
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
  // ROBBED_ up/down candle fills (mini chart bars).
  candleUp: "#2E4A34",
  candleDown: "#4A2E2E",
  // Brand accent = ROBBED_ green.
  accent: "#4ADE80",
  accentForeground: "#0B0D0B",
  greenDim: "#16301F",
  softConfirmed: "#F59E0B",
  purple: "#A78BFA",
} as const;

/** satori/card font family; fonts.ts registers IBM Plex Mono under this name. */
export const OG_FONT_FAMILY = "IBM Plex Mono" as const;

/** Fixed OG canvas: 1200×630, the X/Telegram/Discord share unit. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_CONTENT_TYPE = "image/png";

/** The `rob responsibly` footer (frontend `TAGLINE_TRADE`); the `_` is appended
 * by the card to match the terminal wordmark treatment. */
export const OG_TAGLINE = "rob responsibly" as const;
