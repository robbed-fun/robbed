import type { Metadata } from "next";

import { AMM_TAGLINE, BRAND } from "@/shared/config/copy";
import { ApiError, getToken } from "@/shared/api";
import { env } from "@/shared/lib/env";

/** Fixed OG canvas — the X/Telegram/Discord share unit (spec §5.2/§9). */
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

/**
 * Per-token SSR metadata (title/description + Open Graph). The `og:image` now
 * points at the API-served, R2-cached PNG (`GET {API_ORIGIN}/v1/og/{address}.png`,
 * 1200×630) instead of a web-rendered `next/og` route — that route pulled
 * `@vercel/og` (resvg/yoga WASM ≈ 1.5 MB) into the Cloudflare Worker bundle and
 * blew the 3 MiB Free limit. The web only references the absolute URL now.
 *
 * Docs-first (nextjs.org/docs .../generate-metadata, verified 2026-07-10):
 * `openGraph.images`/`twitter.images` must be ABSOLUTE URLs; when a field
 * provides an absolute URL, `metadataBase` is ignored, so no `metadataBase` is
 * needed here. No client JS is involved: the tags are in the server-rendered
 * HTML head, which is what the `javaScriptEnabled:false` OG check asserts.
 */
export async function generateTokenMetadata(address: string): Promise<Metadata> {
  const normalized = address.toLowerCase();
  try {
    const token = await getToken(normalized, { revalidate: 60 });
    const title = `${token.name} (${token.ticker}) — ${BRAND}`;
    const description =
      token.description?.slice(0, 200) ||
      `${token.name} on ${BRAND} — ${AMM_TAGLINE} on Robinhood Chain.`;
    // Absolute URL from env (§2 — never inline an origin). apiBaseUrl() strips
    // any trailing slash, so this composes to exactly one `/v1/og/…` segment.
    const ogImageUrl = `${env.apiBaseUrl()}/v1/og/${normalized}.png`;
    const ogImage = {
      url: ogImageUrl,
      width: OG_WIDTH,
      height: OG_HEIGHT,
      alt: `${token.name} (${token.ticker}) on ${BRAND}`,
    };
    return {
      title,
      description,
      openGraph: { title, description, type: "website", images: [ogImage] },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [ogImageUrl],
      },
    };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.code === "not_found")) {
      return { title: `Token not found — ${BRAND}` };
    }
    return { title: BRAND };
  }
}
