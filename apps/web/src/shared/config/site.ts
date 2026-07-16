import { BRAND } from "./copy";

export const SITE_ORIGIN = "https://robbed.fun" as const;
export const SITE_NAME = BRAND;
export const SITE_DESCRIPTION =
  "Launch, trade, and graduate memecoins on Robinhood Chain through a bonding-curve AMM with soft-confirmed UX and permissionless graduation." as const;

// Static ROBBED_ brand share card in R2 (1200x630). Per-token pages override
// og:image with the API-rendered card (/v1/og/:address.png).
export const SITE_OG_IMAGE =
  "https://pub-1f7ef06884964a2f82e21cd86e1893b0.r2.dev/og/robbed-default.png" as const;
export const SITE_MANIFEST_BACKGROUND_COLOR = "#0B0D0B" as const;
export const SITE_MANIFEST_THEME_COLOR = "#00F58C" as const;

export function siteUrl(path = "/"): string {
  return new URL(path, SITE_ORIGIN).toString();
}
