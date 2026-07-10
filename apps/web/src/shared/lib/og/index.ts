/**
 * Public API — OG render infrastructure (business-agnostic; web.md §6). The
 * `token-og` widget composes the card element and calls `renderOgPng`; the
 * `app/t/[address]/opengraph-image.tsx` route consumes the widget. Layer rule:
 * shared imports nothing above it.
 */
export { renderOgPng } from "./render";
export type { FontOptions, RenderOptions } from "./render";
export { OG_FONTS, OG_FONT_FAMILY } from "./fonts";
export {
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_HEIGHT,
  OG_SIZE,
  OG_WIDTH,
} from "./theme";
export { sparklineDataUri, sparklineSvg } from "./sparkline";
export type { SparklineOptions } from "./sparkline";
export { fetchImageDataUri } from "./image-data-uri";
