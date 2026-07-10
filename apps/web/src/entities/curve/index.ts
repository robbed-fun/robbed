/**
 * Public API for the `curve` entity (FSD reference/public-api).
 *
 * The bonding curve is a domain noun: its LIVE on-chain reads (reserves,
 * graduation threshold, fee bps, anti-sniper window) and its QUOTE math are the
 * curve model. Placed in an entity (not a widget) precisely because BOTH the
 * trust-panel and trade-widget widgets consume it — sibling widgets may not
 * import each other, so shared curve logic lives one layer down here.
 */
export * from "./lib/venue";
export * from "./lib/v3";
export * from "./model/reads";
export * from "./model/quote";
export * from "./model/v3-quote";
export * from "./model/use-pause";
