import type { Metadata } from "next";

import "@/app/globals.css";
import { plexMono } from "@/app/fonts";
import { Providers } from "@/app/providers";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_OG_IMAGE,
  SITE_ORIGIN,
} from "@/shared/config/site";

/**
 * Root layout (web.md). Dark-only: `<html class="dark">` is
 * hard-set — no toggle, zero flash-of-light by construction.
 *
 * ROBBED_ redesign (Phase F): the app font is IBM Plex Mono, self-hosted via
 * `next/font/local` (src/app/fonts.ts — no external fetch, CSP-safe) and exposed
 * as `--font-plex-mono`, which the `@theme` mono/sans tokens consume.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  applicationName: SITE_NAME,
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  keywords: [
    "ROBBED",
    "Robinhood Chain",
    "memecoin launchpad",
    "bonding curve",
    "AMM",
    "Uniswap V3",
  ],
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_ORIGIN,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [{ url: SITE_OG_IMAGE, width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [SITE_OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
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
