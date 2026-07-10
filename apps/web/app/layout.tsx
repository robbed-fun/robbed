import type { Metadata } from "next";

import "@/app/globals.css";
import { plexMono } from "@/app/fonts";
import { Providers } from "@/app/providers";

/**
 * Root layout (spec §9; web.md §2.1). Dark-only: `<html class="dark">` is
 * hard-set (§12.23) — no toggle, zero flash-of-light by construction.
 *
 * ROBBED_ redesign (Phase F): the app font is IBM Plex Mono, self-hosted via
 * `next/font/local` (src/app/fonts.ts — no external fetch, CSP-safe) and exposed
 * as `--font-plex-mono`, which the `@theme` mono/sans tokens consume.
 */
export const metadata: Metadata = {
  title: {
    default: "ROBBED_",
    template: "%s · ROBBED_",
  },
  description:
    "Soft-confirmed trading on Robinhood Chain — launch and trade tokens on a bonding-curve AMM.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${plexMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh bg-bg font-mono text-text antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
