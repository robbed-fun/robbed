/**
 * Public API — per-token OG image widget (web.md §6). The
 * `app/t/[address]/opengraph-image.tsx` route imports downward from here; the
 * layout/render internals stay private to the slice.
 */
export { renderTokenOgImage } from "./model/render-token-og";
export { buildTokenOgCard } from "./ui/token-og-card";
export { getTokenOgData } from "./api/get-og-data";
export type { TokenOgData } from "./api/get-og-data";
export { ogCandleWindow, OG_CANDLE_INTERVAL } from "./model/window";
// Re-export the OG image-metadata config the route needs (from shared/lib/og).
export { OG_CONTENT_TYPE, OG_SIZE } from "@/shared/lib/og";
