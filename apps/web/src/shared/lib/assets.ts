import { env } from "./env";

const STORAGE_PREFIXES = new Set(["images", "metadata", "og"]);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const a = parts[0]!;
  const b = parts[1]!;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "[::1]" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    isPrivateIpv4(h)
  );
}

/**
 * Converts legacy local object-store URLs into the configured public asset base.
 * Example:
 *   http://localhost:4290/robbed-assets/images/<hash>.webp
 *     -> https://api.robbed.fun/v1/assets/images/<hash>.webp
 */
export function normalizeAssetUrl(
  url: string | null | undefined,
  publicBaseUrl = env.r2PublicBaseUrl(),
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

  if (!isLocalOrPrivateHost(parsed.hostname)) return url;
  if (isLocalOrPrivateHost(base.hostname)) return url;

  const parts = parsed.pathname.split("/").filter(Boolean);
  const assetIndex = parts.findIndex((part) => STORAGE_PREFIXES.has(part));
  if (assetIndex < 0) return url;

  return `${publicBaseUrl.replace(/\/+$/, "")}/${parts.slice(assetIndex).join("/")}`;
}

export function publicWalletImageUrl(
  imageUrl: string | null | undefined,
  publicBaseUrl = env.r2PublicBaseUrl(),
): string | undefined {
  const normalized = normalizeAssetUrl(imageUrl, publicBaseUrl);
  if (!normalized) return undefined;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" || isLocalOrPrivateHost(parsed.hostname)) {
      return undefined;
    }
    return normalized;
  } catch {
    return undefined;
  }
}
