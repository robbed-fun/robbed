import { OG_CONTENT_TYPE, OG_SIZE, renderTokenOgImage } from "@/widgets/token-og";

/**
 * Per-token OG image route (spec §5.2/§9; web.md §6) — ROUTING ONLY (FSD). All
 * rendering logic lives downward in `widgets/token-og` + `shared/lib/og`. This
 * is a Next.js metadata Route Handler: no client JS by construction, so the
 * share image renders for crawlers/messengers with zero hydration.
 *
 * Runtime: Next's `ImageResponse` (`next/og` — satori → resvg-WASM, bundled), a
 * workerd-safe raster backend (see shared/lib/og/render.ts for the decision +
 * basis). The deploy target is Cloudflare Workers via OpenNext, which cannot load
 * the native `@resvg/resvg-js` addon (deploy-komodo-cloudflare.md Part B §B.6).
 *
 * `size`/`contentType` drive the `<meta property="og:image:*">` tags Next emits
 * on the Token Detail page; the default export returns the PNG bytes directly.
 */

export const alt =
  "Token on ROBBED_ — soft-confirmed trading on Robinhood Chain";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
// Regenerate at most once a minute (web.md §6); matches the API revalidate.
export const revalidate = 60;

export default async function OpengraphImage({
  params,
}: {
  // Next 16: metadata-route params is a Promise (v16 change).
  params: Promise<{ address: string }>;
}): Promise<Response> {
  const { address } = await params;
  const png = await renderTokenOgImage(address);

  if (!png) {
    // Unknown token → 404 (web.md §6). No image bytes.
    return new Response("Token not found", { status: 404 });
  }

  return new Response(png as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
