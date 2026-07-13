/**
 * CreatorVault live-balance reader (spec §7 / §12.63; GET /v1/creators/:address/
 * claimable). The AUTHORITATIVE claimable value is the live on-chain
 * `CreatorVault.balanceOf(creator)` — exactly like `/fees` reads the live NPM
 * `tokensOwed` rather than trusting a projection. Injectable behind an interface
 * so it (a) stays out of the WS/publish hot path (cold HTTP read) and (b) is
 * faked in tests without a live RPC.
 *
 * Returns wei as a decimal string, or `null` when no live read is available
 * (no RPC configured / read failed) — the route then falls back to the
 * event-derived mirror (accrued − claimed) so a claimable figure is always
 * served (dev/degraded), while production serves the authoritative live value.
 *
 * ABI is the shared `creatorVaultAbi` (@robbed/shared/abi) — never redeclared.
 */
import { type Address, createPublicClient, http } from "viem";
import { creatorVaultAbi } from "@robbed/shared/abi";

export interface CreatorVaultBalanceReader {
  /** Live `balanceOf(creator)` on `vault`, wei decimal string; null if unavailable. */
  read(input: { vault: string; creator: string }): Promise<string | null>;
}

/** Stub — always null (dev/test, or no RPC). Route falls back to the mirror. */
export const nullCreatorVaultBalance: CreatorVaultBalanceReader = {
  async read() {
    return null;
  },
};

/**
 * viem-backed reader over the Robinhood chain RPC. A failed read returns null
 * (→ route uses the event-derived mirror) rather than 500-ing the endpoint.
 */
export function createRpcCreatorVaultBalance(rpcUrl: string): CreatorVaultBalanceReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    async read({ vault, creator }): Promise<string | null> {
      try {
        const wei = (await client.readContract({
          abi: creatorVaultAbi,
          address: vault as Address,
          functionName: "balanceOf",
          args: [creator as Address],
        })) as bigint;
        return wei.toString();
      } catch (err) {
        console.error("[creator-vault] RPC balanceOf failed (falling back to mirror):", err);
        return null;
      }
    },
  };
}
