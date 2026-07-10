/**
 * Impersonation matcher (§4.4, §8.4; watchlist §12.23). Case-insensitive EXACT +
 * CONFUSABLE-NORMALIZED (homoglyph fold) match on ticker and name against the
 * curated, dated watchlist data file (top-asset tickers + Robinhood Stock
 * Tokens). A match sets `impersonation_flag` (a badge + review-queue push, NOT a
 * hide — §4.4). Watchlist entries are DATA, never hardcoded market metrics (§2).
 */
import type { z } from "zod";
import { z as zod } from "zod";

export const impersonationEntrySchema = zod.object({
  ticker: zod.string(),
  category: zod.enum(["top_asset", "stock_token"]),
  names: zod.array(zod.string()).default([]),
});
export const impersonationWatchlistSchema = zod.object({
  source: zod.string(),
  capturedAt: zod.string(),
  updatedAt: zod.string(),
  entries: zod.array(impersonationEntrySchema),
});
export type ImpersonationWatchlist = z.infer<typeof impersonationWatchlistSchema>;
export type ImpersonationEntry = z.infer<typeof impersonationEntrySchema>;

/**
 * Confusable fold: decompose (NFKD strips accents/full-width), map common
 * Cyrillic/Greek lookalikes to ASCII, drop combining marks + non-alphanumerics.
 * The map is intentionally small and conservative — false positives only push to
 * the review queue, never hide.
 */
const CONFUSABLES: Record<string, string> = {
  а: "a", // cyrillic
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  к: "k",
  м: "m",
  т: "t",
  в: "b",
  н: "h",
  ѕ: "s",
  і: "i",
  ј: "j",
  α: "a", // greek
  ε: "e",
  ο: "o",
  ρ: "p",
  ν: "v",
  τ: "t",
  κ: "k",
  ι: "i",
  "0": "o",
  "1": "l",
};

export function foldConfusables(input: string): string {
  const decomposed = input.normalize("NFKD").toLowerCase();
  let out = "";
  for (const ch of decomposed) {
    // Drop combining marks.
    if (/\p{Mn}/u.test(ch)) continue;
    out += CONFUSABLES[ch] ?? ch;
  }
  // Keep only alphanumerics after folding.
  return out.replace(/[^a-z0-9]/g, "");
}

export interface ImpersonationMatch {
  flagged: boolean;
  ticker?: string;
}

export function matchImpersonation(
  name: string,
  ticker: string,
  watchlist: ImpersonationWatchlist,
): ImpersonationMatch {
  const nName = foldConfusables(name);
  const nTicker = foldConfusables(ticker);
  for (const entry of watchlist.entries) {
    const eTicker = foldConfusables(entry.ticker);
    if (eTicker && (nTicker === eTicker || nName === eTicker)) {
      return { flagged: true, ticker: entry.ticker };
    }
    for (const variant of entry.names) {
      const v = foldConfusables(variant);
      if (v && (nName === v || nTicker === v)) {
        return { flagged: true, ticker: entry.ticker };
      }
    }
  }
  return { flagged: false };
}
