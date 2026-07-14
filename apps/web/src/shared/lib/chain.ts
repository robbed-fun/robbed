import { defineChain } from "viem";
import { getDeployment } from "@robbed/shared/addresses";

import { env } from "./env";

/**
 * Custom viem/wagmi chain for the Robinhood Chain target of THIS build — spec
 *, CLAUDE.md "Chain facts", (env selects the chain, the shared
 * registry defines it). Gas token ETH; Blockscout explorer; RPC from env.
 *
 * Docs-first basis: viem `defineChain` (viem.sh/docs/chains/introduction) +
 * wagmi v2 custom-chain config (wagmi.sh/react/api/createConfig), verified
 * 2026-07-10; wagmi 2.18 injected-connector `switchChain` re-verified from the
 * installed source 2026-07-12 — its `wallet_addEthereumChain` fallback builds
 * the add-chain proposal from THIS object's `name` / `nativeCurrency` /
 * `rpcUrls.default.http[0]` / `blockExplorers`, so every field below must be
 * the OFFICIAL value for the target chain or wallets will reject the add.
 *
 * TARGET SELECTION : `env.chainId()` — `NEXT_PUBLIC_CHAIN_ID` when set
 * (validated against the shared deployment registry; testnet stack injects
 * 46630), else the compile-time mainnet `CHAIN_ID` (4663). One build targets
 * exactly one chain.
 *
 * ADDRESS POLICY (/ web.md) NO address literal lives here anymore —
 * WETH resolves from the shared per-chain deployment registry
 * (`getDeployment(chainId).external.weth`, anti-drift rule 2). Every other
 * contract address comes from `shared/config/addresses.ts` (same registry).
 * Result: zero inline `0x…` address literals in `apps/web`.
 *
 * `block.number` is NEVER used for logic or display (CLAUDE.md): on Orbit it is
 * an L1 estimate. Any block/sequence shown in the UI comes from indexer event
 * metadata, never from a chain read here.
 */

const TARGET_CHAIN_ID = env.chainId();

/**
 * Official per-chain facts — TRANSCRIBED, never invented :
 * - 4663:  CLAUDE.md "Chain facts" (explorer robinhoodchain.blockscout.com).
 * - 46630: docs/developers/runbooks/testnet.md / (docs.robinhood.com/chain
 *   connecting, retrieved 2026-07-11): name "Robinhood Chain Testnet", explorer
 *   explorer.testnet.chain.robinhood.com.
 * No entry for 31337: the local stack is an anvil FORK of 4663 (keeps chain id
 * 4663 — compose asserts it), so a web build never legitimately targets 31337;
 * selecting a chain without official facts fails loud below.
 */
const CHAIN_FACTS: Record<number, { name: string; explorerUrl: string }> = {
  4663: {
    name: "Robinhood Chain",
    explorerUrl: "https://robinhoodchain.blockscout.com",
  },
  46630: {
    name: "Robinhood Chain Testnet",
    explorerUrl: "https://explorer.testnet.chain.robinhood.com",
  },
};

const facts = CHAIN_FACTS[TARGET_CHAIN_ID];
if (!facts) {
  throw new Error(
    `[robbed/web] no official chain facts (name/explorer) recorded for chain id ` +
      `${TARGET_CHAIN_ID}. Web builds target 4663 (mainnet) or 46630 (testnet); ` +
      `facts come from CLAUDE.md / docs/developers/runbooks/testnet.md — never invented.`,
  );
}

/** Registry entry for the target chain (membership already asserted by env.chainId()). */
const deployment = getDeployment(TARGET_CHAIN_ID);

export const robinhoodChain = defineChain({
  id: TARGET_CHAIN_ID,
  name: facts.name,
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
      url: facts.explorerUrl,
    },
  },
  contracts: {
    // Canonical WETH for the target chain — from the shared registry, no literal.
    ...(deployment ? { weth9: { address: deployment.external.weth } } : {}),
    // multicall3: intentionally omitted until M3-1 web-7 confirms canonical
    // Multicall3 (0xcA11…) is deployed on 4663. Trust-panel batch reads fall
    // back to parallel `readContract` until then (web.md / decide-yourself).
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
