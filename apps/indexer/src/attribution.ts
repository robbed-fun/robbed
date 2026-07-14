/**
 * V3-leg trade attribution (indexer.md §3.4/§3.6; design-decisions D-75).
 *
 * The `trader` on a post-graduation V3 `trades` row — and the best-effort V3
 * cost-basis `holder` (`total_eth_in/out` attribution) — derive from the
 * TRANSACTION-SENDER EOA (`event.transaction.from`), NOT `Swap.recipient`.
 *
 * Why (D-75): for a V3 sell that outputs ETH, `Swap.recipient` is SwapRouter02
 * (it receives WETH to unwrap into ETH for the user), so recipient-keying
 * mis-attributed the trade to the router in the Token Detail Trades table.
 * `event.transaction.from` is the user's EOA for a direct SwapRouter02 swap —
 * correct for both buys and sells — and makes per-EOA V3 cost basis accurate for
 * directly-submitted swaps. A contract-mediated / aggregator-relayed swap
 * attributes to the relayer (`tx.from` = relayer); V3 cost basis therefore stays
 * labeled best-effort (D-16 core exact balances via `Transfer` are untouched).
 * Tightening the aggregator case is out of scope until Phase-2 4337 (D-63).
 *
 * Kept as a pure function so the attribution rule is unit-testable independently
 * of the Ponder virtual-module runtime (the handler stays a thin caller).
 */
import { lower } from "./ids";

/** Address is stored lowercase (indexer.md conventions). */
export function v3SwapTrader(event: { transaction: { from: string } }): string {
  return lower(event.transaction.from);
}
