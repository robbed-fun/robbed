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
  // DEV-ONLY: `next dev` (16.x) blocks cross-origin requests to dev assets/HMR
  // ("Unauthorized"/403) unless the origin is allowlisted. The Cloudflare-Tunnel
  // stacks (robbed.fun → mainnet :4200, testnet.robbed.fun → testnet :4100) serve
  // `next dev` with Host = the tunnel hostname, so without this the client runtime
  // never hydrates (chunks/HMR rejected). Top-level `allowedDevOrigins`, hostname
  // strings, wildcard subdomains supported — nextjs.org/docs/app/api-reference/
  // config/next-config-js/allowedDevOrigins (v16.2.10, verified 2026-07-12).
  // Ignored by production builds — the P-3 prod images run `next build`/serve,
  // never `next dev`, so this knob disappears there. Override/extend via
  // NEXT_DEV_ALLOWED_ORIGINS (comma-separated hostnames) without a code edit.
  allowedDevOrigins: (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "robbed.fun,*.robbed.fun")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
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
  // SAME-ORIGIN PROXY for the SIWE-authed comment surface (spec §12.63b). The
  // comment author cookie (`robbed_user_session`, SameSite=Lax) is set by the API
  // on `/v1/auth/login`, and the API's CORS is credential-less by design — so the
  // browser must reach `/v1/auth/*` and the comment POST through THIS origin. A
  // Next rewrite proxies those relative paths to the API, forwarding the cookie
  // both ways ("frontend proxies same-origin, zero backend change"). Public reads
  // (tokens/trades/…) keep hitting the API cross-origin via absolute URLs and are
  // unaffected. Destination origin is a BUILD var (inlined) — when absent (bare
  // unit build) no proxy is emitted rather than a broken `undefined` destination.
  // Docs: nextjs.org/docs/app/api-reference/config/next-config-js/rewrites (v16.2).
  async rewrites() {
    const apiOrigin = (
      process.env.API_BASE_URL_INTERNAL ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      ""
    ).replace(/\/$/, "");
    if (!apiOrigin) return [];
    return [
      { source: "/v1/auth/:path*", destination: `${apiOrigin}/v1/auth/:path*` },
      {
        source: "/v1/tokens/:address/comments",
        destination: `${apiOrigin}/v1/tokens/:address/comments`,
      },
    ];
  },
  // OG images are NOT rendered by the web anymore: the API serves them at
  // `{API_ORIGIN}/v1/og/{address}.png` (R2-cached PNG) and the token-detail
  // metadata just references that absolute URL. This removed `next/og`
  // (`@vercel/og` → resvg/yoga WASM ≈ 1.5 MB raw) from the Cloudflare Worker
  // bundle so it fits under Cloudflare's 3 MiB (3072 KiB gzip) Free limit
  // (spec §12.45 (Cloudflare Workers/OpenNext)).
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
