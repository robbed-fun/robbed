/**
 * Centralised env access (spec §2/§9). Every RPC/API/WS endpoint and config
 * value comes from env — NEVER inlined. No market metric ever lives here (§2).
 *
 * `NEXT_PUBLIC_*` are inlined by Next at build; we read them through this module
 * so a missing var fails loudly in one place instead of silently `undefined`.
 */

/**
 * `NEXT_PUBLIC_*` are inlined by Next AT BUILD TIME (they are not readable at
 * runtime on Cloudflare Workers — they must be set as build vars in the
 * Cloudflare Workers-Builds environment, see apps/web/.env.example). During the
 * build itself Next evaluates this module (chain.ts/wagmi.ts run `rpcHttp()` at
 * import scope), so a genuinely-missing var must NOT crash `next build` /
 * `opennextjs-cloudflare build`. In the build phase we return a loud, obviously
 * non-functional placeholder instead of throwing; at real runtime a missing var
 * still fails loud so a bad request can never silently hit `undefined`.
 */
function isBuildPhase(): boolean {
  // Next sets this only while `next build` collects/prerenders (verified against
  // nextjs.org/docs constants, 2026-07-10). Unset at runtime on workerd.
  return process.env.NEXT_PHASE === "phase-production-build";
}

function required(
  name: string,
  value: string | undefined,
  buildFallback: string,
): string {
  if (!value || value.length === 0) {
    if (isBuildPhase()) {
      // Do not hard-fail the build; the real value is a required build var.
      return buildFallback;
    }
    // Fail loud in the browser console + SSR logs rather than making a bad
    // request to `undefined`. Chain/API cannot function without these.
    throw new Error(
      `[robbed/web] Missing required env var ${name}. See apps/web/.env.example.`,
    );
  }
  return value;
}

export const env = {
  rpcHttp: () =>
    required(
      "NEXT_PUBLIC_RPC_HTTP",
      process.env.NEXT_PUBLIC_RPC_HTTP,
      "https://rpc.invalid",
    ),
  rpcWs: () => process.env.NEXT_PUBLIC_RPC_WS ?? "",
  apiBaseUrl: () =>
    required(
      "NEXT_PUBLIC_API_BASE_URL",
      process.env.NEXT_PUBLIC_API_BASE_URL,
      "https://api.invalid",
    ).replace(/\/$/, ""),
  wsUrl: () =>
    required("NEXT_PUBLIC_WS_URL", process.env.NEXT_PUBLIC_WS_URL, "wss://ws.invalid"),
  /** web-6: absent in dev — injected wallets still work; WC/Robinhood hidden. */
  walletConnectProjectId: () =>
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
  r2PublicBaseUrl: () => process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ?? "",
  /**
   * E2E harness flag (I-5a). When `"true"`, the wagmi config swaps its real
   * RainbowKit connectors for the wagmi `mock` connector wired to anvil's
   * unlocked dev accounts (real txs + real signatures, no browser-extension
   * automation) and a `window.__ROBBED_E2E__` bridge is mounted so Playwright
   * can connect/switch accounts. NEVER set in prod — injected/WC connectors are
   * the only real-user path. Build-time inlined like every `NEXT_PUBLIC_*`.
   */
  e2e: () => process.env.NEXT_PUBLIC_E2E === "true",
  /** Comma-separated anvil dev addresses for the e2e mock connector. */
  e2eAccounts: () =>
    (process.env.NEXT_PUBLIC_E2E_ACCOUNTS ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0),
  /**
   * DEMO MODE (task A). When truthy, the data layer serves the extracted mock
   * fixture (`src/shared/mock/robbed-mock.json`) instead of hitting the API — for
   * every REST read the four pages render. Strictly gated: flag off ⇒ untouched
   * production path (real fetch + zod validation). Build-time inlined like every
   * `NEXT_PUBLIC_*`. The mock's mcap/ethUsdMock figures are demo-only and NEVER
   * reach the prod path (§2 hardcoded-metric rule holds behind the gate).
   */
  mockData: () => {
    const v = process.env.NEXT_PUBLIC_MOCK_DATA;
    return v === "true" || v === "1" || v === "yes";
  },
  /**
   * web-10 / M3-10: large-value disclosure threshold, ETH-denominated, as a
   * DECIMAL STRING (never a JS number literal in code, §2). Architect-owned
   * config; returns null until furnished so callers degrade gracefully.
   */
  largeValueEthThreshold: () =>
    process.env.NEXT_PUBLIC_LARGE_VALUE_ETH_THRESHOLD || null,
};
