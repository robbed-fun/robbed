import type { TokenDetail, WsMessage } from "@robbed/shared";

/**
 * Pure reconciliation rules for the LIVE token status (TD-6; §5.2/§12.12).
 * Extracted from the `useLiveTokenDetail` hook so the venue-flip decisions are
 * unit-testable without a WebSocket or React tree (tests/token-live.test.ts);
 * the hook applies these to the TanStack Query cache and then re-validates
 * against REST (indexed truth) — the optimistic patch is never the final word.
 */

/**
 * Apply a WS `graduated` signal to the cached TokenDetail: the §12.12
 * graduating lock (or the curve venue) gives way to the V3 venue. The patch is
 * an optimistic cache write — the caller MUST also invalidate the token query so
 * the indexed row (graduatedAt, final pool state, …) replaces it.
 */
export function applyGraduated(detail: TokenDetail, pool: string): TokenDetail {
  return {
    ...detail,
    status: "graduated",
    graduated: true,
    v3PoolAddress: pool,
  };
}

/**
 * Defense-in-depth: a trade that reports `venue: "v3"` while we still render a
 * curve/graduating venue implies graduation already happened (e.g. the
 * `graduated` event raced a reconnect). Never contradict the indexed stream —
 * reconcile the status to it (§2.1).
 */
export function tradeImpliesGraduation(
  detail: TokenDetail | undefined,
  msg: WsMessage,
): boolean {
  return (
    msg.type === "trade" &&
    msg.data.venue === "v3" &&
    detail !== undefined &&
    detail.status !== "graduated"
  );
}

/**
 * Should a normal (non-graduating) trade re-serve the TokenDetail so the bonding
 * cell stays live? A pre-grad buy/sell moves `real_eth_reserves`, so both the
 * indexer-computed `graduation.progressPct` AND the raised-ETH figure
 * (`reserves.realEth`) that the header shows go stale until the next refetch —
 * the SSR-seeded `qk.token` query has no other trigger between graduations.
 *
 * True ONLY for a curve trade against a not-yet-graduated token. It excludes:
 * - a graduated token (`graduated` latch OR `status === "graduated"`) — post-grad
 *   the bonding cell reads a terminal "Graduated" verdict; the curve is retired
 *   (§12.12) and progress must NOT regress (monotonic-graduation rule, §2.1);
 * - a v3 trade that `tradeImpliesGraduation` already routes to the immediate,
 *   un-throttled venue-reconciliation invalidate — so the two paths never
 *   double-fire on the same message.
 *
 * The trade WS payload (`wsTradeDataSchema`) carries no post-trade reserves, so
 * the caller cannot recompute `progressPct` client-side without curve math that
 * would drift from indexed truth — it invalidates → REST refetch instead (the
 * optimistic patch is never the final word; §2.1). Extracted here so the rule is
 * unit-testable without a WebSocket or React tree (tests/token-live.test.ts).
 */
export function tradeMovesBondingProgress(
  detail: TokenDetail | undefined,
  msg: WsMessage,
): boolean {
  if (msg.type !== "trade" || detail === undefined) return false;
  if (detail.graduated || detail.status === "graduated") return false;
  if (tradeImpliesGraduation(detail, msg)) return false;
  return true;
}
