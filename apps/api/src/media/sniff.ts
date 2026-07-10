/**
 * Magic-byte MIME sniff (§8.4, api.md §3.1 step 1) — NEVER trust the
 * Content-Type header. Pure and unit-tested against real + hostile fixtures.
 * Allowlist: png | jpeg | webp | gif. Anything else → null (caller 415s).
 */
export type SniffedMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

function startsWith(buf: Uint8Array, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[offset + i] !== sig[i]) return false;
  return true;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // GIF87a
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // GIF89a
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at offset 8

export function sniffMime(buf: Uint8Array): SniffedMime | null {
  if (startsWith(buf, PNG)) return "image/png";
  if (startsWith(buf, JPEG)) return "image/jpeg";
  if (startsWith(buf, GIF87) || startsWith(buf, GIF89)) return "image/gif";
  if (startsWith(buf, RIFF) && startsWith(buf, WEBP, 8)) return "image/webp";
  return null;
}
