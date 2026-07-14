import {
  type Wallet,
  getWalletConnectConnector,
} from "@rainbow-me/rainbowkit";

/**
 * ⚠ web-6 FINDING (2026-07-10, docs-first): RainbowKit ships **no**
 * `robinhoodWallet`. Verified against RainbowKit 2.2.11:
 *   - `walletConnectors/` dir listing → only injected/walletConnect/… (no robinhood)
 *   - GitHub code search `robinhood repo:rainbow-me/rainbowkit` → 0 hits.
 * The web.md/CLAUDE.md line "verify the `robinhoodWallet` RainbowKit connector"
 * assumed an export that does not exist. Escalated to robbed-architect.
 *
 * Interim (safest-correct): a CUSTOM RainbowKit wallet wrapping the shared
 * WalletConnect connector via the documented `getWalletConnectConnector`
 * (rainbowkit.com/docs/custom-wallets). web.md states Robinhood Wallet is
 * "WalletConnect-based under the hood", so this is the sanctioned mechanism.
 * It is UNVERIFIED against a real Robinhood Wallet on chain 4663 (no deep-link /
 * WC metadata / on-device test yet) — NOT connection-proven. It only appears
 * when a WalletConnect `projectId` is present (dev without one omits it).
 *
 * NEEDS-USER: real Robinhood Wallet WC metadata + a device connection test on
 * 4663 (web-6), and official brand icon assets (brand pending).
 */
export function robinhoodWallet(options: { projectId: string }): Wallet {
  return {
    id: "robinhood",
    name: "Robinhood Wallet",
    // Neutral placeholder mark until official brand assets land. Lives in
    // `lib/` (outside the token-lint scan of app/ + components/).
    iconUrl: async () =>
      "data:image/svg+xml;base64," +
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="6" fill="black"/></svg>',
      ).toString("base64"),
    iconBackground: "#000000",
    downloadUrls: {
      // Placeholder store links — replace with official URLs once confirmed.
      android: "https://robinhood.com/crypto/wallet/",
      ios: "https://robinhood.com/crypto/wallet/",
      qrCode: "https://robinhood.com/crypto/wallet/",
    },
    mobile: { getUri: (uri: string) => uri },
    qrCode: {
      getUri: (uri: string) => uri,
      instructions: {
        learnMoreUrl: "https://robinhood.com/crypto/wallet/",
        steps: [
          {
            description:
              "Open the Robinhood Wallet app and scan to connect. (Unverified on chain 4663 — web-6.)",
            step: "scan",
            title: "Scan the QR code",
          },
        ],
      },
    },
    createConnector: getWalletConnectConnector({ projectId: options.projectId }),
  };
}
