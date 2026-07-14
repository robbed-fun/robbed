/**
 * OG share-card endpoint (api.md; Trust/share card). Renders the
 * ROBBED_ terminal card for a token as image/png 1200×630 and caches it in R2.
 *
 * MOVED OFF THE EDGE WORKER (task): `apps/web` previously rendered OG via
 * `@vercel/og` inside its Cloudflare Worker (~1.5 MB WASM). OG generation now
 * lives here — Bun/Komodo, no Worker size limit — using native `satori` +
 * `@resvg/resvg-js`. The web `<meta og:image>` just points at this URL; this is
 * the SINGLE OG renderer (no cross-service duplication).
 *
 * URL:   GET /v1/og/{address}.png   (also accepts /v1/og/{address})
 * R2 key: og/{address}/{version}.png — `version` is a hash of the DISPLAY fields
 *   (name, mcap, progress, status, sparkline, logo; og/data.ts). A stats change
 *   ⇒ new hash ⇒ new key ⇒ fresh render. Cache-hit path reads bytes from R2;
 *   miss renders once, stores, and serves. The version doubles as the ETag, so a
 *   crawler `If-None-Match` short-circuits to 304 with no render and no R2 read.
 *
 * NOTE: this is a normal HTTP read path (satori/resvg + DB reads are fine here);
 * it is NOT the WS publish hot path, so the row-9 "no synchronous DB read" rule
 * (which governs the Redis→WS fanout) does not apply.
 */
import { Hono } from "hono";
import { addressSchema } from "@robbed/shared";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { parse } from "../lib/validate";
import { buildTokenOgCard } from "../og/card";
import { getTokenOgData } from "../og/data";
import { OG_FONTS } from "../og/fonts";
import { renderOgPng } from "../og/render";
import { OG_CONTENT_TYPE } from "../og/theme";

// Stale-but-cacheable: the URL is stable while its content mutates, so give
// browsers/CDN a short freshness window with a long revalidate tail. The R2
// layer holds the exact bytes keyed by content version (correctness), while this
// header just bounds how long a share surface may show a slightly old card.
const CACHE_CONTROL = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

export function ogRoutes(deps: AppDeps) {
  const app = new Hono();

  // One handler serves both `{address}.png` and `{address}`; strip an optional
  // `.png` then validate as an address (400 on a malformed one, 404 on unknown).
  app.get("/v1/og/:file", async (c) => {
    const raw = c.req.param("file").replace(/\.png$/i, "").toLowerCase();
    const address = parse(addressSchema, raw);

    const result = await getTokenOgData(deps, address);
    if (!result) throw errors.notFound("token not found");
    const { data, version } = result;

    // Crawler revalidation: identical content version ⇒ 304, no render, no R2 read.
    const etag = `"${version}"`;
    if (c.req.header("if-none-match") === etag) {
      return c.body(null, 304, { ETag: etag, "Cache-Control": CACHE_CONTROL });
    }

    // Cache hit: serve the exact stored bytes.
    const cached = await deps.storage.readOg(address, version);
    if (cached) return pngResponse(cached, etag, "hit");

    // Miss: render once, store, serve.
    const png = await renderOgPng(buildTokenOgCard(data), { fonts: OG_FONTS });
    // Store best-effort — a failed cache write must not fail the response.
    try {
      await deps.storage.putOg(address, version, png);
    } catch (err) {
      console.error("[og] R2 cache write failed:", err);
    }
    return pngResponse(png, etag, "miss");
  });

  return app;
}

function pngResponse(bytes: Uint8Array, etag: string, cache: "hit" | "miss"): Response {
  // Copy to a standalone ArrayBuffer so the Response body owns exactly these bytes.
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": OG_CONTENT_TYPE,
      "Cache-Control": CACHE_CONTROL,
      ETag: etag,
      "X-Robbed-Og-Cache": cache,
    },
  });
}
