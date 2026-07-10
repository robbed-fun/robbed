import type { TokenCard } from "@robbed/shared";

import { ApiError, getCandles, getToken } from "@/shared/api";

/** No named `TokenStatus` export in the frozen contract — derive from the card. */
type TokenStatus = TokenCard["status"];
import { fetchImageDataUri } from "@/shared/lib/og";
import { formatEthNumber, formatUsd } from "@/shared/lib/format";

import { ogCandleWindow } from "../model/window";

/**
 * Server-side data for the OG card. Composes the frozen `@robbed/shared` REST
 * contract (token summary + venue-continuous candles) into the exact fields the
 * card renders — all live indexer values, NO hardcoded metric (§2). Returns
 * `null` when the token is unknown so the route can answer 404 (web.md §6).
 */
export type TokenOgData = {
  name: string;
  ticker: string;
  imageDataUri: string | null;
  status: TokenStatus;
  graduated: boolean;
  /** 0..100 graduation progress (pre-grad); indexer-computed. */
  progressPct: number;
  /** Close prices over the 12h window → sparkline. Empty = "first trades incoming". */
  sparkline: number[];
  /**
   * mcap ETH-first (§2): the indexer's own market cap re-expressed in ETH
   * (usd ÷ ethUsd from the SAME snapshot — a unit conversion of an indexer
   * metric, not independent client price math). `null` when the ETH/USD rate is
   * unavailable, in which case only the USD figure (with source) is shown.
   */
  mcapEth: string | null;
  /** Secondary USD, carrying source + timestamp (§2) — from the mcap snapshot. */
  mcapUsd: { text: string; asOf: string } | null;
};

export async function getTokenOgData(
  address: string,
  now = Date.now(),
): Promise<TokenOgData | null> {
  let token;
  try {
    token = await getToken(address, { revalidate: 60 });
  } catch (err) {
    // Unknown token → 404 (web.md §6). Any other failure re-throws so the OG
    // worker surfaces it rather than silently shipping a wrong image.
    if (err instanceof ApiError && (err.status === 404 || err.code === "not_found")) {
      return null;
    }
    throw err;
  }

  // Sparkline is best-effort: a candles failure degrades to a flat baseline,
  // never a 404 or a thrown error (the token exists — the image must render).
  const win = ogCandleWindow(now);
  let sparkline: number[] = [];
  try {
    const { candles } = await getCandles(address, win.interval, win, {
      revalidate: 60,
    });
    sparkline = candles.map((c) => c.close);
  } catch {
    sparkline = [];
  }

  const imageDataUri = await fetchImageDataUri(token.imageUrl);

  const mcapEth = deriveMcapEth(token.mcap.usd, token.mcap.ethUsd);
  let mcapUsd: TokenOgData["mcapUsd"] = null;
  try {
    const usd = formatUsd(token.mcap);
    mcapUsd = { text: usd.text, asOf: usd.asOf };
  } catch {
    mcapUsd = null;
  }

  return {
    name: token.name,
    ticker: token.ticker,
    imageDataUri,
    status: token.status,
    graduated: token.graduated,
    progressPct: token.graduation.progressPct,
    sparkline,
    mcapEth,
    mcapUsd,
  };
}

/** ETH mcap = usd ÷ ethUsd of the same snapshot; null on an unusable rate. */
function deriveMcapEth(usd: string, ethUsd: string): string | null {
  const u = Number(usd);
  const rate = Number(ethUsd);
  if (!Number.isFinite(u) || !Number.isFinite(rate) || rate <= 0) return null;
  return formatEthNumber(u / rate);
}
