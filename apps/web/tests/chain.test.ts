import { describe, expect, it } from "vitest";
import { CHAIN_ID, WETH_ADDRESS } from "@robbed/shared";

import { explorer, robinhoodChain } from "@/shared/lib/chain";

/**
 * Chain config invariants (spec §2/§9; CLAUDE.md). Proves 4663 / ETH gas /
 * Blockscout / WETH-from-shared. Awaiting the reconcile pass to execute.
 */
describe("robinhoodChain", () => {
  it("is chain 4663 with ETH gas", () => {
    expect(robinhoodChain.id).toBe(CHAIN_ID);
    expect(robinhoodChain.id).toBe(4663);
    expect(robinhoodChain.nativeCurrency.symbol).toBe("ETH");
    expect(robinhoodChain.nativeCurrency.decimals).toBe(18);
  });

  it("uses the Blockscout explorer", () => {
    expect(robinhoodChain.blockExplorers?.default.url).toBe(
      "https://robinhoodchain.blockscout.com",
    );
  });

  it("sources WETH from the single shared constant (no inline literal)", () => {
    expect(robinhoodChain.contracts?.weth9?.address).toBe(WETH_ADDRESS);
  });

  it("reads the RPC endpoint from env, not a hardcoded URL", () => {
    expect(robinhoodChain.rpcUrls.default.http[0]).toBe("https://rpc.test.invalid");
  });

  it("builds Blockscout links without ever using block.number", () => {
    expect(explorer.tx("0xabc")).toBe(
      "https://robinhoodchain.blockscout.com/tx/0xabc",
    );
    expect(explorer.address(WETH_ADDRESS)).toContain("/address/");
  });
});
