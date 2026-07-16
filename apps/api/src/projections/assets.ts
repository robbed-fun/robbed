const LOCAL_OBJECT_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
const STORAGE_PREFIXES = new Set(["images", "metadata", "og"]);

/**
 * Rewrites legacy local object-store URLs into the current public asset base.
 * Example: http://localhost:4290/robbed-assets/images/<hash>.webp
 *       -> https://api.robbed.fun/v1/assets/images/<hash>.webp
 */
export function rewriteLocalStorageUrl(
  url: string | null | undefined,
  publicBaseUrl?: string,
): string | null {
  if (!url) return null;
  if (!publicBaseUrl) return url;

  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(publicBaseUrl);
  } catch {
    return url;
  }

  if (!LOCAL_OBJECT_HOSTS.has(parsed.hostname)) return url;
  if (LOCAL_OBJECT_HOSTS.has(base.hostname)) return url;

  const parts = parsed.pathname.split("/").filter(Boolean);
  const assetIndex = parts.findIndex((part) => STORAGE_PREFIXES.has(part));
  if (assetIndex < 0) return url;

  return `${publicBaseUrl.replace(/\/+$/, "")}/${parts.slice(assetIndex).join("/")}`;
}
