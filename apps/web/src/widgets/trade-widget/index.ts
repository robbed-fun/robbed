/**
 * Public API for the trade-widget (§5.2). Buy/Sell with the invisible venue
 * switch, sell-never-gated, anti-sniper cap surfaced, §12.12 graduating
 * interstitial. Submits via the curve Router and feeds the shared optimistic
 * store (entities/trade).
 */
export { TradeWidget } from "./ui/TradeWidget";
