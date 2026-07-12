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
