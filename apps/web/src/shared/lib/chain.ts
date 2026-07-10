import { defineChain } from "viem";
import { CHAIN_ID, WETH_ADDRESS } from "@robbed/shared";

import { env } from "./env";

/**
 * Custom viem/wagmi chain for Robinhood Chain (chain ID 4663) — spec §2/§9,
 * CLAUDE.md "Chain facts". Gas token ETH; Blockscout explorer; RPC from env.
 *
 * Docs-first basis: viem `defineChain` (viem.sh/docs/chains/introduction) +
 * wagmi v2 custom-chain config (wagmi.sh/react/api/createConfig), verified
 * 2026-07-10.
 *
 * ADDRESS POLICY (§9 / web.md §2.3): WETH is the sole address literal in the
 * whole app, and even it is NOT duplicated here — it is imported from the single
 * shared source `WETH_ADDRESS` (@robbed/shared, anti-drift rule 2). Every other
 * contract address comes from the generated `lib/addresses.ts`. Result: zero
 * inline `0x…` address literals in `apps/web`, stronger than the §9 minimum.
 *
 * `block.number` is NEVER used for logic or display (CLAUDE.md): on Orbit it is
 * an L1 estimate. Any block/sequence shown in the UI comes from indexer event
 * metadata, never from a chain read here.
 */
export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [env.rpcHttp()],
      // webSocket is optional; only populated when the RPC WS endpoint is set.
      ...(env.rpcWs() ? { webSocket: [env.rpcWs()] } : {}),
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
  contracts: {
    // Canonical WETH on 4663 — the one address literal, sourced from shared.
    weth9: { address: WETH_ADDRESS },
    // multicall3: intentionally omitted until M3-1 web-7 confirms canonical
    // Multicall3 (0xcA11…) is deployed on 4663. Trust-panel batch reads fall
    // back to parallel `readContract` until then (web.md §9.7 / decide-yourself).
  },
});

/** Blockscout URL builders (never `block.number`; only tx/address/token). */
export const explorer = {
  tx: (hash: string) => `${robinhoodChain.blockExplorers.default.url}/tx/${hash}`,
  address: (address: string) =>
    `${robinhoodChain.blockExplorers.default.url}/address/${address}`,
  token: (address: string) =>
    `${robinhoodChain.blockExplorers.default.url}/token/${address}`,
};
