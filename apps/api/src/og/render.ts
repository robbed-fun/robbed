/**
 * OG render pipeline — native `satori` (element tree → SVG) then native
 * `@resvg/resvg-js` (SVG → PNG). This is the whole reason OG generation moved off
 * the edge Worker into the Bun API: `workerd` cannot load N-API addons, so the
 * frontend was stuck on `@vercel/og`'s ~1.5 MB WASM renderer. The API runs on
 * Bun/Komodo with no Worker size limit, so we use the fast native raster path.
 *
 * DECISION (own it): satori converts every glyph to a vector `<path>`, so the SVG
 * it emits has NO `<text>` nodes — resvg therefore needs no font database and we
 * run it with `loadSystemFonts: false` for deterministic, host-independent output
 * (same bytes in CI and prod). `fitTo: { mode: 'width', value: OG_WIDTH }`
 * preserves satori's 1200×630 canvas exactly (aspect ratio is fixed by the SVG),
 * so the PNG IHDR is always 1200×630 — the invariant the tests assert.
 *
 * Docs verified 2026-07-10 (WebFetch, context7 unavailable for get-docs):
 *   satori(element, { width, height, fonts:[{name,data,weight,style}] }) → SVG string
 *   new Resvg(svg, { fitTo, font }).render().asPng() → PNG Buffer
 */
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import type { OgElement } from "./element";
import { OG_HEIGHT, OG_WIDTH } from "./theme";

export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export interface FontOptions {
  name: string;
  /** satori accepts a Node Buffer or an ArrayBuffer (readFileSync gives a Buffer). */
  data: Buffer | ArrayBuffer;
  weight?: FontWeight;
  style?: "normal" | "italic";
}

export interface RenderOptions {
  fonts: FontOptions[];
  width?: number;
  height?: number;
}

/** Render a satori element tree to an SVG string at OG dimensions. */
export async function renderOgSvg(node: OgElement, opts: RenderOptions): Promise<string> {
  return satori(node as unknown as Parameters<typeof satori>[0], {
    width: opts.width ?? OG_WIDTH,
    height: opts.height ?? OG_HEIGHT,
    fonts: opts.fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style ?? "normal",
    })),
  });
}

/** Render a satori element tree to a PNG byte array at OG dimensions. */
export async function renderOgPng(node: OgElement, opts: RenderOptions): Promise<Uint8Array> {
  const svg = await renderOgSvg(node, opts);
  const resvg = new Resvg(svg, {
    // satori already fixed the canvas at width×height; pin the raster width so the
    // PNG comes out exactly OG_WIDTH×OG_HEIGHT regardless of any DPI defaults.
    fitTo: { mode: "width", value: opts.width ?? OG_WIDTH },
    // No <text> in a satori SVG (glyphs are paths) → no fonts needed at raster.
    font: { loadSystemFonts: false },
  });
  const png = resvg.render().asPng();
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}
