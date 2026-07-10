import type { FontOptions } from "./render";
import { INTER_BOLD_B64, INTER_REGULAR_B64 } from "./fonts-data";

/**
 * Font buffers for the OG renderer, decoded ONCE at module scope (web.md §6 —
 * "fonts loaded once at module scope"). satori (bundled inside `next/og`) has no
 * default font: it needs an explicit buffer to measure + shape text, so we ship
 * Inter (400/700) with the repo. Inter is SIL Open Font License (fonts/OFL.txt).
 *
 * WORKERD NOTE (deploy target = Cloudflare Workers, deploy-komodo-cloudflare.md
 * Part B): Workers has NO filesystem, so the old `node:fs.readFileSync` of the
 * .ttf files could never run on workerd. The bytes are now base64-embedded
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

const interRegular = b64ToBytes(INTER_REGULAR_B64);
const interBold = b64ToBytes(INTER_BOLD_B64);

export const OG_FONTS: FontOptions[] = [
  { name: "Inter", data: interRegular, weight: 400, style: "normal" },
  { name: "Inter", data: interBold, weight: 700, style: "normal" },
];
