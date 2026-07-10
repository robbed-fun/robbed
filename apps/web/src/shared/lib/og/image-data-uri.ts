/**
 * Fetch a remote raster (the token logo from the R2 CDN) and inline it as a
 * `data:*;base64,…` URI. REQUIRED for the OG path: satori embeds `<img src>` as
 * an SVG `<image>` and resvg does NOT fetch remote URLs (no network at raster
 * time), so a bare CDN URL would render blank. We fetch the bytes server-side
 * and inline them. Any failure (timeout, non-2xx, oversized) degrades to `null`
 * so the card falls back to a monogram tile — the share image always renders.
 */

const DEFAULT_TIMEOUT_MS = 2500;
// Guard the OG worker: skip absurdly large images rather than buffering them.
const MAX_BYTES = 5 * 1024 * 1024;

export async function fetchImageDataUri(
  url: string | null | undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string | null> {
  if (!url) return null;
  // Only http(s) — never let a data:/javascript: URL from metadata through.
  if (!/^https?:\/\//i.test(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
    const base64 = Buffer.from(buf).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
