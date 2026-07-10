/**
 * Public API for the trade-feed widget (§5.2/§2.1). Live trades with
 * ConfirmationBadge tiers, merging the user's optimistic trades from the shared
 * store (entities/trade).
 */
export { TradeFeed } from "./ui/TradeFeed";
export { buildFeedRows, prependTrade } from "./model/merge";
