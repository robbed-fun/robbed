/**
 * Wallet native-ETH balance reader (api.md portfolio: `walletEthBalance`).
 *
 * Chain truth, exact: the live native balance is an RPC `eth_getBalance` read, NOT
 * indexer-derived (the indexer tracks ERC-20 token balances via Transfer, never
 * the account's ETH). Injectable behind an interface — like `UncollectedFeesReader`
 * — so it (a) stays out of the WS/publish hot path (row-9 latency rule; portfolio
 * is a cold HTTP read) and (b) is faked in tests without a live RPC.
 *
 * Returns wei as a decimal string (uint256-safe; the DTO is a decimal string).
 */
import { type Address, createPublicClient, http } from "viem";

export interface WalletBalanceReader {
  /** Live native ETH balance for `address`, wei decimal string. */
  read(address: string): Promise<string>;
}

/** Stub — returns "0". Used in dev/test and when no RPC URL is configured. */
export const zeroWalletBalance: WalletBalanceReader = {
  async read() {
    return "0";
  },
};

/**
 * viem-backed reader over the Robinhood chain RPC (chain 4663). A failed read
 * degrades to "0" rather than 500-ing the whole portfolio summary (the balance is
 * one cell; the rest of the roll-up is indexer-derived and unaffected).
 */
export function createRpcWalletBalance(rpcUrl: string): WalletBalanceReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    async read(address: string): Promise<string> {
      try {
        const wei = await client.getBalance({ address: address as Address });
        return wei.toString();
      } catch (err) {
        console.error("[wallet-balance] RPC getBalance failed (degrading to 0):", err);
        return "0";
      }
    },
  };
}
