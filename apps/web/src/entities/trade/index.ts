/**
 * Public API for the `trade` entity (FSD reference/public-api).
 *
 * PLACEMENT NOTE (robbed-frontend): the optimistic trade-lifecycle state machine
 * (`model/trades` — pure, framework-agnostic reducer) plus its thin React binding
 * (`model/use-optimistic-trades`) are the trade domain model, so they live in the
 * trade entity. Trade surfaces (TradeWidget/TradeFeed/Launch stepper, M3-5/6) will
 * consume this public API. Unit tests target the pure module directly.
 */
export * from "./model/trades";
export * from "./model/use-optimistic-trades";
export * from "./model/optimistic-trades-context";
export * from "./ui/ConfirmationBadge";
