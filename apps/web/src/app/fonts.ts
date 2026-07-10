import localFont from "next/font/local";

/**
 * ROBBED_ display font — IBM Plex Mono, self-hosted (see ./fonts/NOTICE.md).
 * The mockup (docs/Robbed.html) is IBM Plex Mono throughout; weights used there
 * are 400 (body/rows), 500 (+ CREATE), 600 (wordmark, token names, action
 * buttons). Exposed as `--font-plex-mono`, consumed by the `@theme` `--font-mono`
 * / `--font-sans` tokens in globals.css so BOTH stacks resolve to the terminal
 * mono (mono-everywhere design).
 *
 * FSD: this is app-layer config (root font setup), imported only by
 * `app/layout.tsx`.
 */
export const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/IBMPlexMono-SemiBold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});
