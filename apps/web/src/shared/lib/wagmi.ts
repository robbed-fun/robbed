import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import type { Address } from "viem";
import { createConfig, http } from "wagmi";
import { mock } from "wagmi/connectors";

import { robinhoodChain } from "./chain";
import { env } from "./env";

/**
 * wagmi v2 + RainbowKit config. Single-chain app: chain 4663
 * only; RainbowKit prompts a network switch if the wallet is elsewhere.
 *
 * Docs-first basis (2026-07-10): wagmi.sh/react/api/createConfig,
 * rainbowkit.com/docs/custom-wallet-list. RainbowKit 2.2.11 peers React `>=18`
 * (dev-tested on react@19.2.x) → React 19 compatible (web-6/web-7 finding).
 *
 * NO ERC-4337 / smart-account / gas-sponsorship paths — Phase 2. Classic
 * wagmi/RainbowKit connectors only.
 *
 * Wallet groups: injected browser wallets, first-class mobile wallets, and the
 * generic WalletConnect fallback. WalletConnect-backed entries require a
 * projectId and are omitted when it is absent, so injected-only dev works with
 * no projectId (web-6).
 */
const APP_NAME = "ROBBED_";
const APP_URL = "https://robbed.fun";
const APP_DESCRIPTION = "Launch, trade, and graduate tokens on Robinhood Chain.";
const APP_ICON = `${APP_URL}/moscit.png`;

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
              groupName: "Mobile wallets",
              wallets: [
                rainbowWallet,
                metaMaskWallet,
                coinbaseWallet,
                trustWallet,
              ],
            },
            {
              groupName: "More",
              wallets: [walletConnectWallet],
            },
          ]
        : []),
    ],
    {
      appName: APP_NAME,
      appDescription: APP_DESCRIPTION,
      appUrl: APP_URL,
      appIcon: APP_ICON,
      projectId: hasWc ? projectId : "robbed-dev-no-wc",
    },
  );
}

/**
 * E2E-only connectors (I-5a). The wagmi `mock` connector (wagmi.sh
 * /react/api/connectors/mock, verified 2026-07-10) delegates signing and
 * `eth_sendTransaction` to the config's transport — pointed at the anvil fork,
 * whose dev accounts are unlocked — so tests get REAL txs + REAL signatures
 * (incl. EIP-2612 typed-data for `sellWithPermit`) with NO browser-extension
 * automation, the standard anti-flake pattern. Addresses come from
 * `NEXT_PUBLIC_E2E_ACCOUNTS` (never an inline literal, address-grep) and are
 * anvil's public dev accounts. Guarded strictly behind `NEXT_PUBLIC_E2E`.
 */
function buildE2eConnectors() {
  const accounts = env.e2eAccounts() as Address[];
  if (accounts.length === 0) {
    throw new Error(
      "[robbed/web] NEXT_PUBLIC_E2E=true but NEXT_PUBLIC_E2E_ACCOUNTS is empty.",
    );
  }
  // One mock connector PER account: wagmi's `switchAccount` action switches the
  // active *connector*, so per-account connectors are how the harness models
  // distinct signers (trader vs creator, wallet-switch-mid-flow) — each is
  // `config.connectors[i]`.
  return accounts.map((account) =>
    mock({
      accounts: [account] as [Address, ...Address[]],
      features: { reconnect: true },
    }),
  );
}

/**
 * One wagmi config for the whole app. `ssr: true` (Next App Router server render,
 * wagmi.sh SSR guide). Transport is the env HTTP RPC — never inlined. In the
 * e2e harness (`NEXT_PUBLIC_E2E=true`) the real connectors are replaced by the
 * anvil-backed mock connector; production is untouched.
 */
export function createWagmiConfig() {
  return createConfig({
    chains: [robinhoodChain],
    connectors: env.e2e()
      ? buildE2eConnectors()
      : buildConnectors(env.walletConnectProjectId()),
    transports: {
      [robinhoodChain.id]: http(env.rpcHttp()),
    },
    ssr: true,
  });
}
