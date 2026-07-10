import { OG_FONTS, renderOgPng } from "@/shared/lib/og";

import { getTokenOgData } from "../api/get-og-data";
import { buildTokenOgCard } from "../ui/token-og-card";

/**
 * Full OG orchestration for one token (web.md §6): fetch indexer data → build the
 * satori card → rasterise to PNG. Returns `null` for an unknown token so the
 * route answers 404. No client JS anywhere on this path.
 */
export async function renderTokenOgImage(
  address: string,
  now = Date.now(),
): Promise<Uint8Array | null> {
  const data = await getTokenOgData(address, now);
  if (!data) return null;
  return renderOgPng(buildTokenOgCard(data), { fonts: OG_FONTS });
}
