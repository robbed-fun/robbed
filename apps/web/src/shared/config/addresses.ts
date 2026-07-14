/**
 * ────────────────────────────────────────────────────────────────────────────
 * HAND-AUTHORED derivation layer — NOT a codegen target (I-5 split).
 *  The GENERATED data lives in @robbed/shared `ROBBED_DEPLOYMENTS` (emitted by
 *  `bun contracts/script/codegen-addresses.ts` after a broadcast); this module
 *  only derives from it and is never rewritten by that script.
 *
 *  ROBBED is DERIVED (never re-declared) from the shared per-chain map for the
 * env-selected target chain (web.md, architecture.md), with the
 *  e2e fork-address override seam layered on top. When no deployment exists for
 *  the target chain yet, the per-deployment addresses stay ZERO sentinels and
 *  `requireAddress()` throws — a missing codegen fails loudly instead of
 *  sending a tx to 0x0. The address-literal grep excludes this path.
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { Address } from "viem";
import { UNISWAP_V3, WETH_ADDRESS } from "@robbed/shared";
import { getDeployment } from "@robbed/shared/addresses";

import { env } from "@/shared/lib/env";

/** Zero sentinel — signals "no deployment for the target chain has been codegen'd". */
const PLACEHOLDER = "0x0000000000000000000000000000000000000000" as const;

/**
 * target selection: the deployment entry for THIS build's chain
 * (`env.chainId()` — NEXT_PUBLIC_CHAIN_ID validated against the shared
 * registry, else compile-time 4663). The testnet build (46630) therefore
 * resolves the T-3 testnet deployment, never the mainnet one.
 */
const TARGET_CHAIN_ID = env.chainId();
const deployment = getDeployment(TARGET_CHAIN_ID);

/**
 * E2E-ONLY address override (plan I-5). An ephemeral anvil fork of 4663 deploys
 * FRESH contract addresses each bring-up (and the merged factory shape moved them
 * off the codegen'd @robbed/shared 4663 map), which are NOT codegen'd into
 * `@robbed/shared` — baking fork addresses into the real-4663 prod build would be
 * wrong. When `NEXT_PUBLIC_E2E==="true"`, the fork's deployed addresses are
 * supplied via `NEXT_PUBLIC_E2E_*` env (from `tools/localstack/out/local.env`) so
 * the e2e build can trade against the live fork. Prod NEVER sets `NEXT_PUBLIC_E2E`,
 * so this branch is inert there and the codegen'd map is the only source. Empty
 * env values coerce to `undefined` so a partially-set env falls through cleanly.
 * addresses.ts is the sanctioned home for address literals (copy-lint exempt).
 */
const e2eAddr = (v: string | undefined): Address | undefined =>
  process.env.NEXT_PUBLIC_E2E === "true" && v ? (v as Address) : undefined;

/**
 * Per-deployment robbed contract addresses for CHAIN_ID, derived from
 * the generated @robbed/shared map (or the e2e env override on a fork). Router,
 * CurveFactory, LPFeeVault, V3Migrator, and the treasury Safe. ZERO
 * sentinels until a CHAIN_ID deploy is codegen'd.
 */
export const ROBBED = {
  router: e2eAddr(process.env.NEXT_PUBLIC_E2E_ROUTER) ?? deployment?.robbed.router ?? PLACEHOLDER,
  curveFactory:
    e2eAddr(process.env.NEXT_PUBLIC_E2E_CURVE_FACTORY) ?? deployment?.robbed.curveFactory ?? PLACEHOLDER,
  lpFeeVault:
    e2eAddr(process.env.NEXT_PUBLIC_E2E_LP_FEE_VAULT) ?? deployment?.robbed.lpFeeVault ?? PLACEHOLDER,
  v3Migrator:
    e2eAddr(process.env.NEXT_PUBLIC_E2E_MIGRATOR) ?? deployment?.robbed.v3Migrator ?? PLACEHOLDER,
  treasury:
    e2eAddr(process.env.NEXT_PUBLIC_E2E_TREASURY) ?? deployment?.robbed.treasury ?? PLACEHOLDER,
} satisfies Record<string, Address>;

/**
 * Creator-fee vault — OPTIONAL: it exists only on a creator-fee
 * factory deployment; a v1/treasury-only deployment has none, so this is
 * `Address | undefined` (never a zero sentinel). Derived from the shared
 * per-chain map (`getDeployment(chainId).robbed.creatorVault`, itself optional),
 * with the e2e fork override seam. Consumers MUST hide/disable the claim surface
 * when this is `undefined` (there is no vault to claim from).
 */
export const CREATOR_VAULT: Address | undefined =
  e2eAddr(process.env.NEXT_PUBLIC_E2E_CREATOR_VAULT) ?? deployment?.robbed.creatorVault ?? undefined;

/**
 * Canonical Uniswap V3 set for the TARGET chain — from the shared per-chain
 * registry entry (mainnet 4663 = the official set; testnet 46630 = the
 * adopted community deployment, TESTNET-ONLY). Falls back to the shared
 * mainnet constants only when no registry entry exists (pre-codegen
 * mainnet builds — identical values by construction). Derived, never
 * re-declared (anti-drift rule 2).
 */
export const V3 = {
  factory: deployment?.external.v3Factory ?? UNISWAP_V3.factory,
  positionManager: deployment?.external.positionManager ?? UNISWAP_V3.positionManager,
  swapRouter02: deployment?.external.swapRouter02 ?? UNISWAP_V3.swapRouter02,
  quoterV2: deployment?.external.quoterV2 ?? UNISWAP_V3.quoterV2,
} as const satisfies Record<string, Address>;

/**
 * Canonical WETH for the TARGET chain — registry-derived (46630's WETH differs
 * from mainnet's). The shared mainnet `WETH_ADDRESS` constant is only
 * the no-registry fallback. All web consumers (V3 path builders, quotes) import
 * THIS, never `WETH_ADDRESS` directly.
 */
export const WETH: Address = deployment?.external.weth ?? WETH_ADDRESS;

/** True when no deployment for the target chain has been codegen'd (still a zero sentinel). */
export function isPlaceholder(address: Address): boolean {
  return address.toLowerCase() === PLACEHOLDER;
}

/**
 * Read a robbed address, failing loud if no target-chain deployment has been
 * codegen'd — a bad tx to 0x0 is far worse than a clear error. V3
 * addresses are real and do not need this guard.
 */
export function requireAddress(address: Address, label: string): Address {
  if (isPlaceholder(address)) {
    throw new Error(
      `[robbed/web] no deployment for chain ${TARGET_CHAIN_ID} in @robbed/shared for ${label}. ` +
        `Run the M1-14 deploy + codegen (bun contracts/script/codegen-addresses.ts) before using robbed addresses.`,
    );
  }
  return address;
}
