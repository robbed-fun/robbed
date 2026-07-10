import type { FontOptions } from "./render";
import { PLEX_MONO_REGULAR_B64, PLEX_MONO_SEMIBOLD_B64 } from "./fonts-data";

/**
 * Font buffers for the OG renderer, decoded ONCE at module scope (web.md §6 —
 * "fonts loaded once at module scope"). satori (bundled inside `next/og`) has no
 * default font: it needs an explicit buffer to measure + shape text.
 *
 * ROBBED_ terminal re-art (task A): the OG card is MONO to match the app skin, so
 * we ship IBM Plex Mono (Regular 400 / SemiBold 600) instead of Inter. IBM Plex
 * Mono is SIL Open Font License (fonts/NOTICE.md) and already vendored for the app
 * UI at `src/app/fonts/*.woff2`; satori cannot consume woff2, so `fonts-data.ts`
 * carries the TTF flavours base64-embedded.
 *
 * WORKERD NOTE (deploy target = Cloudflare Workers, deploy-komodo-cloudflare.md
 * Part B): Workers has NO filesystem, so the old `node:fs.readFileSync` of the
 * font files could never run on workerd. The bytes are base64-embedded
 * (`fonts-data.ts`, generated) and decoded here — identical in the Next build
 * (Node), Vitest (Node), and workerd, with zero runtime I/O. Server-only module;
 * the OG route is a server Route Handler (no client JS), so this never ships to
 * the browser bundle.
 */

/** Portable base64 → Uint8Array (no Node Buffer / no fs — workerd-safe). */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const plexRegular = b64ToBytes(PLEX_MONO_REGULAR_B64);
const plexSemiBold = b64ToBytes(PLEX_MONO_SEMIBOLD_B64);

/**
 * satori matches by `name`; the card sets `fontFamily: OG_FONT_FAMILY`, so keep
 * these in lockstep. Weight 600 is the wordmark/value weight in the mockup; 400
 * carries body/labels.
 */
export const OG_FONT_FAMILY = "IBM Plex Mono" as const;

export const OG_FONTS: FontOptions[] = [
  { name: OG_FONT_FAMILY, data: plexRegular, weight: 400, style: "normal" },
  { name: OG_FONT_FAMILY, data: plexSemiBold, weight: 600, style: "normal" },
];
