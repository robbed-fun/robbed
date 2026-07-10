import type { TokenCard as TokenCardType } from "@robbed/shared";
import type { InfiniteData } from "@tanstack/react-query";

/**
 * Pure WS→cache patch for the Discover grid (§5.1 live updates). Extracted from
 * TokenGrid so the reconciliation is unit-provable (tests/discover-live.test.ts).
 *
 * Contract (spec §2 — never client market math; never drop indexed data):
 * - Patches ONLY `priceEth`, taken verbatim from the indexer's `trade` payload
 *   (an indexer-computed display value), onto the matching card. It does NOT
 *   derive mcap/progress/Δ% — those are indexer aggregates absent from the trade
 *   payload; recomputing them client-side would be forbidden market math.
 * - Never removes or reorders cards; a trade for a token not currently in cache
 *   is a no-op (returns the same reference so React skips the re-render).
 */
export type TokensPage = { tokens: TokenCardType[]; nextCursor: string | null };

export function patchTradePrice(
  old: InfiniteData<TokensPage> | undefined,
  token: string,
  priceEth: number,
): InfiniteData<TokensPage> | undefined {
  if (!old) return old;
  let changed = false;
  const pages = old.pages.map((page) => {
    const idx = page.tokens.findIndex((t) => t.address === token);
    if (idx === -1) return page;
    const current = page.tokens[idx]!;
    if (current.priceEth === priceEth) return page;
    changed = true;
    const nextTokens = page.tokens.slice();
    nextTokens[idx] = { ...current, priceEth };
    return { ...page, tokens: nextTokens };
  });
  return changed ? { ...old, pages } : old;
}
