import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";

import { robinhoodChain } from "./chain";
import { env } from "./env";
import { robinhoodWallet } from "./wallets/robinhoodWallet";

/**
 * wagmi v2 + RainbowKit config (spec §9/§12.2). Single-chain app: chain 4663
 * only; RainbowKit prompts a network switch if the wallet is elsewhere.
 *
 * Docs-first basis (2026-07-10): wagmi.sh/react/api/createConfig,
 * rainbowkit.com/docs/custom-wallet-list. RainbowKit 2.2.11 peers React `>=18`
 * (dev-tested on react@19.2.x) → React 19 compatible (web-6/web-7 finding).
 *
 * NO ERC-4337 / smart-account / gas-sponsorship paths — Phase 2 (§12.2). Classic
 * wagmi/RainbowKit connectors only.
 *
 * Wallet groups (§9): injected · Robinhood Wallet · WalletConnect — exactly
 * these. Robinhood Wallet + WalletConnect require a projectId and are OMITTED
 * when it is absent, so injected-only dev works with no projectId (web-6).
 */
const APP_NAME = "ROBBED_";

export function buildConnectors(projectId: string) {
  const hasWc = projectId.length > 0;

  // `connectorsForWallets` still requires a projectId string; the WC-based
  // wallets are simply not included in the list when it is empty.
  return connectorsForWallets(
    [
      {
        groupName: "Injected",
        wallets: [injectedWallet],
      },
      ...(hasWc
        ? [
            {
              groupName: "Robinhood",
              // Custom wallet — see robinhoodWallet.ts web-6 finding.
              wallets: [() => robinhoodWallet({ projectId })],
            },
            {
              groupName: "More",
              wallets: [walletConnectWallet],
            },
          ]
        : []),
    ],
    { appName: APP_NAME, projectId: hasWc ? projectId : "robbed-dev-no-wc" },
  );
}

/**
 * One wagmi config for the whole app. `ssr: true` (Next App Router server render,
 * wagmi.sh SSR guide). Transport is the env HTTP RPC — never inlined (§2).
 */
export function createWagmiConfig() {
  return createConfig({
    chains: [robinhoodChain],
    connectors: buildConnectors(env.walletConnectProjectId()),
    transports: {
      [robinhoodChain.id]: http(env.rpcHttp()),
    },
    ssr: true,
  });
}
