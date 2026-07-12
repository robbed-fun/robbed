import { CHAIN_ID } from "@robbed/shared";
import { getDeployment } from "@robbed/shared/addresses";

/**
 * Centralised env access (spec §2/§9). Every RPC/API/WS endpoint and config
 * value comes from env — NEVER inlined. No market metric ever lives here (§2).
 *
 * `NEXT_PUBLIC_*` are inlined by Next at build; we read them through this module
 * so a missing var fails loudly in one place instead of silently `undefined`.
 * One var is server-only and NOT inlined: `API_BASE_URL_INTERNAL` (split-horizon
 * SSR fetch base — see `apiFetchBaseUrl` below).
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
  /**
   * Target chain id for THIS build — §12.55 chain-identity pattern applied to
   * the web (mirror of the indexer's `INDEXER_CHAIN_ID`): the env var SELECTS a
   * chain, it never DEFINES chain facts. The value must resolve in the shared
   * deployment registry (`getDeployment`, packages/shared addresses.ts) — an
   * unknown id throws, so nothing can be invented via env. Unset ⇒ the
   * compile-time `CHAIN_ID` (mainnet 4663, @robbed/shared) — prod/local builds
   * are unchanged. A per-target build compiles exactly ONE chain (§12.55: "per-
   * target product builds may still compile a single chain id"): the testnet
   * stack (docker-compose.testnet.yml web) injects NEXT_PUBLIC_CHAIN_ID=46630.
   * Deliberately NOT using the `required(...)` build-phase placeholder: a SET-
   * but-invalid value must fail `next build` loudly — that is a misconfig, not
   * a missing build var.
   */
  chainId: () => {
    const raw = process.env.NEXT_PUBLIC_CHAIN_ID;
    if (!raw || raw.length === 0) return CHAIN_ID;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || getDeployment(parsed) === undefined) {
      throw new Error(
        `[robbed/web] NEXT_PUBLIC_CHAIN_ID=${raw} has no entry in the shared deployment ` +
          `registry (@robbed/shared ROBBED_DEPLOYMENTS). The env var selects a chain; the ` +
          `registry defines it (spec §12.55) — run the deploy + codegen for that chain first.`,
      );
    }
    return parsed;
  },
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
  /**
   * Data-plane REST base with SPLIT-HORIZON resolution (web.md §2.3) — the ONE
   * resolution point every REST transport (`shared/api`, `entities/portfolio/
   * api`) must call instead of `apiBaseUrl()`.
   *
   * Server-side (SSR / route handlers) prefers the server-only
   * `API_BASE_URL_INTERNAL`: inside the compose network the browser-facing
   * `NEXT_PUBLIC_API_BASE_URL` points at a HOST-mapped port (e.g.
   * `http://localhost:4001`) that is ECONNREFUSED from within the web
   * container, while the compose-internal `http://api:3001` works. Unset ⇒
   * falls back to the public base, so host-run dev and prod (Workers fetch the
   * public API origin) are unchanged.
   *
   * DECISION (robbed-frontend 2026-07-12; basis: nextjs.org/docs/app/guides/
   * environment-variables, v16.2.10 — fetched via docs-first rule): the
   * internal var is deliberately NOT `NEXT_PUBLIC_`-prefixed. Non-prefixed
   * vars exist only in the Node.js environment, are NEVER inlined into the
   * client bundle, and are read at runtime on the server — exactly the horizon
   * split needed. Read at call time (never module scope) so the runtime value
   * wins; the `typeof window` branch makes the client path explicit (browsers
   * always use the public base). Alternative considered: resolving inside
   * `shared/api` — rejected because the portfolio entity carries its own
   * transport and both must share one resolution point.
   *
   * NOT for URLs handed to EXTERNAL agents: the `og:image` absolute URL
   * (`views/token-detail/model/metadata.ts`) is fetched by crawlers from
   * outside our network and must stay on `apiBaseUrl()`.
   */
  apiFetchBaseUrl: () => {
    if (typeof window === "undefined") {
      const internal = process.env.API_BASE_URL_INTERNAL;
      if (internal) return internal.replace(/\/$/, "");
    }
    return env.apiBaseUrl();
  },
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
   * web-10 / M3-10: large-value disclosure threshold, ETH-denominated, as a
   * DECIMAL STRING (never a JS number literal in code, §2). Architect-owned
   * config; returns null until furnished so callers degrade gracefully.
   */
  largeValueEthThreshold: () =>
    process.env.NEXT_PUBLIC_LARGE_VALUE_ETH_THRESHOLD || null,
};
