/**
 * Font buffers for the OG renderer, read ONCE at module scope. satori has no
 * default font: it needs an explicit buffer to measure + shape text (it converts
 * glyphs to vector `<path>`s, so `@resvg/resvg-js` never re-loads the font — see
 * render.ts, which runs resvg with `loadSystemFonts: false`).
 *
 * The OG card is MONO to match the app skin, so we ship IBM Plex Mono
 * (Regular 400 / SemiBold 600), vendored as TTF under `./fonts/` (SIL OFL,
 * `fonts/NOTICE.md`). Unlike the frontend's workerd target — which had no
 * filesystem and base64-embedded the bytes — the API runs on Bun (real fs, no
 * Worker size limit), so we read the TTFs directly with `readFileSync`. That is
 * the whole point of moving OG rendering here: native `@resvg/resvg-js` + on-disk
 * fonts, no `@vercel/og` WASM bundle bloating the edge Worker.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FontOptions } from "./render";
import { OG_FONT_FAMILY } from "./theme";

const FONT_DIR = join(import.meta.dir, "fonts");

const plexRegular = readFileSync(join(FONT_DIR, "IBMPlexMono-Regular.ttf"));
const plexSemiBold = readFileSync(join(FONT_DIR, "IBMPlexMono-SemiBold.ttf"));

/** satori matches by `name` (`OG_FONT_FAMILY`, from theme.ts); the card sets the
 * same `fontFamily`. Weight 600 is the wordmark/value weight; 400 carries labels. */
export const OG_FONTS: FontOptions[] = [
  { name: OG_FONT_FAMILY, data: plexRegular, weight: 400, style: "normal" },
  { name: OG_FONT_FAMILY, data: plexSemiBold, weight: 600, style: "normal" },
];
