import { ImageResponse } from "next/og";
import type { ReactElement } from "react";

import { OG_HEIGHT, OG_WIDTH } from "./theme";

/**
 * OG render pipeline — Next's `ImageResponse` from `next/og` (satori → resvg-WASM,
 * bundled by Next), NOT native `@resvg/resvg-js`.
 *
 * DECISION (hoodpad-frontend; deploy-komodo-cloudflare.md Part B §B.6, spec
 * §12.45). The deploy target moved to Cloudflare Workers via OpenNext. `workerd`
 * CANNOT load native N-API addons, so the previous `@resvg/resvg-js` raster
 * backend is unrunnable there. The two documented workerd-safe options are (a)
 * `next/og`'s `ImageResponse` (ships a WASM resvg + yoga internally) and (b) raw
 * `satori` + `@resvg/resvg-wasm` (manual WASM init). We chose (a):
 *   - it is the edge/workerd-native path (no manual WASM init, no `.wasm` asset
 *     import that has to resolve differently in Node vs workerd), and
 *   - it renders in the Vitest Node env too (verified: `ImageResponse` →
 *     `image/png` 1200×630), so tests/og.test.ts keeps proving the M3-8 contract
 *     WITHOUT booting Next and WITHOUT the native addon.
 * The card element tree (`buildTokenOgCard`) is runtime-agnostic, so switching
 * the rasteriser did not touch the layout — this stays reversible.
 *
 * Docs (verified 2026-07-10): next/og `ImageResponse(element, { width, height,
 * fonts })` → a `Response` whose body is the PNG; OpenNext Cloudflare supports
 * all Next.js 16 minor/patch versions (opennext.js.org/cloudflare).
 */

export type FontOptions = {
  name: string;
  data: Uint8Array | ArrayBuffer | Buffer;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style?: "normal" | "italic";
};

export type RenderOptions = {
  fonts: FontOptions[];
  width?: number;
  height?: number;
};

function toArrayBuffer(data: Uint8Array | ArrayBuffer | Buffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  // Uint8Array / Buffer → copy out its exact bytes as a standalone ArrayBuffer.
  const view = data as Uint8Array;
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
}

/**
 * Render a satori element tree to a PNG byte array at OG dimensions. The element
 * is a plain React element (satori reads `type`/`props`; it is NEVER mounted to
 * the DOM — there is no client JS in this path, web.md §6).
 */
export async function renderOgPng(
  node: ReactElement,
  opts: RenderOptions,
): Promise<Uint8Array> {
  const width = opts.width ?? OG_WIDTH;
  const height = opts.height ?? OG_HEIGHT;

  const response = new ImageResponse(node, {
    width,
    height,
    fonts: opts.fonts.map((f) => ({
      name: f.name,
      data: toArrayBuffer(f.data),
      weight: f.weight,
      style: f.style,
    })),
  });

  // ImageResponse's body is the PNG; buffer it into a plain Uint8Array so
  // callers/tests stay runtime-agnostic (route re-wraps it in a Response).
  return new Uint8Array(await response.arrayBuffer());
}
