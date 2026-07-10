import type { NextConfig } from "next";

/**
 * Next.js 16 config (spec §12.37 — Next 16 + React 19, exact majors, no ranges).
 * Docs-first basis: nextjs.org/docs/app + context7 /vercel/next.js (16.2.x),
 * verified 2026-07-10.
 *
 * We self-host on Bun (§9) — no Edge-runtime assumptions anywhere (web.md §6).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Token images are served from the R2 public CDN; host comes from env so no
  // origin is ever hardcoded (§2). `next/image` remote allowlist is host-only.
  images: {
    remotePatterns: process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL
      ? [
          {
            protocol: "https",
            hostname: new URL(process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL).hostname,
          },
        ]
      : [],
  },
  // `@robbed/shared` is a workspace TS package (no build step) — transpile it
  // through the Next pipeline so its `.ts` sources resolve in RSC + client.
  transpilePackages: ["@robbed/shared"],
  // ROBBED_ redesign (Phase F): the Launch route was renamed to /create
  // (user-directed; §12 deviation). Non-permanent redirect keeps old deep links
  // working while the rename settles (nextjs.org/docs .../redirects, verified
  // 2026-07-10).
  async redirects() {
    return [{ source: "/launch", destination: "/create", permanent: false }];
  },
  // OG renderer: the raster backend moved from native `@resvg/resvg-js` to Next's
  // `next/og` `ImageResponse` (satori → resvg-WASM, bundled) because the deploy
  // target is Cloudflare Workers via OpenNext, and workerd cannot load native
  // N-API addons (deploy-komodo-cloudflare.md Part B §B.6, spec §12.45). `next/og`
  // needs no `serverExternalPackages` entry (Next handles its own WASM), so the
  // previous native-addon opt-out is gone.
};

export default nextConfig;

/**
 * OpenNext Cloudflare dev hook (opennext.js.org/cloudflare, verified 2026-07-10):
 * exposes the Worker's bindings (R2 `NEXT_INC_CACHE_R2_BUCKET`/`ASSETS_BUCKET`,
 * etc.) inside `next dev` so local dev matches the Workers runtime. Guarded to
 * dev only — it must never run during `next build` / `opennextjs-cloudflare
 * build` (self-no-ops in production, but we gate it explicitly).
 */
if (process.env.NODE_ENV !== "production") {
  void import("@opennextjs/cloudflare").then(({ initOpenNextCloudflareForDev }) =>
    initOpenNextCloudflareForDev(),
  );
}
