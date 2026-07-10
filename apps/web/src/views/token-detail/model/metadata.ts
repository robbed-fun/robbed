import type { Metadata } from "next";

import { AMM_TAGLINE, BRAND } from "@/shared/config/copy";
import { ApiError, getToken } from "@/shared/api";

/**
 * Per-token SSR metadata (title/description + Open Graph). The `og:image` tags
 * are emitted automatically by the sibling `opengraph-image.tsx` file convention
 * (M3-8) — this helper only supplies the textual metadata and lets Next merge the
 * image. No client JS is involved: the tags are in the server-rendered HTML head,
 * which is what the `javaScriptEnabled:false` OG check asserts.
 */
export async function generateTokenMetadata(address: string): Promise<Metadata> {
  try {
    const token = await getToken(address.toLowerCase(), { revalidate: 60 });
    const title = `${token.name} (${token.ticker}) — ${BRAND}`;
    const description =
      token.description?.slice(0, 200) ||
      `${token.name} on ${BRAND} — ${AMM_TAGLINE} on Robinhood Chain.`;
    return {
      title,
      description,
      openGraph: { title, description, type: "website" },
      twitter: { card: "summary_large_image", title, description },
    };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.code === "not_found")) {
      return { title: `Token not found — ${BRAND}` };
    }
    return { title: BRAND };
  }
}
