import type { Metadata } from "next";

import "@/app/globals.css";
import { plexMono } from "@/app/fonts";
import { Providers } from "@/app/providers";

/**
 * Root layout (web.md). Dark-only: `<html class="dark">` is
 * hard-set — no toggle, zero flash-of-light by construction.
 *
 * ROBBED_ redesign (Phase F): the app font is IBM Plex Mono, self-hosted via
 * `next/font/local` (src/app/fonts.ts — no external fetch, CSP-safe) and exposed
 * as `--font-plex-mono`, which the `@theme` mono/sans tokens consume.
 */
const SITE_URL = "https://robbed.fun";
const SITE_DESCRIPTION =
  "Soft-confirmed trading on Robinhood Chain — launch and trade tokens on a bonding-curve AMM.";
// Static ROBBED_ brand share card in R2 (1200×630). Per-token pages override
// og:image with the API-rendered card (/v1/og/:address.png); this is the
// site-wide default + fallback so any link preview renders a branded card.
const OG_IMAGE =
  "https://pub-1f7ef06884964a2f82e21cd86e1893b0.r2.dev/og/robbed-default.png";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "ROBBED_",
  title: {
    default: "ROBBED_",
    template: "%s · ROBBED_",
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "ROBBED_",
    url: SITE_URL,
    title: "ROBBED_",
    description: SITE_DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "ROBBED_" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ROBBED_",
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${plexMono.variable}`} suppressHydrationWarning>
      {/* Base text = the secondary token (mockup page-wrapper color); bright text is opt-in. */}
      <body className="min-h-dvh bg-bg font-mono text-text-secondary antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
