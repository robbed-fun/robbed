#!/usr/bin/env bun
/**
 * M1-14 — deploy-time addresses codegen (architecture.md §4; contracts.md §7.2).
 *
 * DEPLOY-time (NOT compilation-time) leg: after `forge script script/Deploy.s.sol
 * --broadcast`, the deploy script writes a self-describing per-chain artifact to
 * `contracts/deployments/<chainId>.json`. This script reads EVERY such artifact
 * and emits the generated addresses modules the other services consume:
 *
 *   packages/shared/src/addresses.ts          — the single source: a per-chain
 *                                                `ROBBED_DEPLOYMENTS` map + a
 *                                                `getDeployment(chainId)` helper
 *                                                (indexer config + web import it)
 *   apps/web/src/shared/config/addresses.ts    — regenerated FSD module that
 *                                                DERIVES `ROBBED` from the shared
 *                                                map for `CHAIN_ID` (never
 *                                                re-declares — anti-drift), keeping
 *                                                the `requireAddress` fail-loud guard
 *
 * Owned by the contracts pipeline (generated artifact), lives under packages/shared
 * per the anti-drift rule — the exact same ownership model as the compilation-time
 * `codegen-abi.ts` (architecture.md §4). Distinct from that leg: this one needs a
 * broadcast, so it reads deploy artifacts, not `contracts/out`.
 *
 * Re-runnable (idempotent):  bun contracts/script/codegen-addresses.ts
 *   Reads whatever `deployments/*.json` exist and rewrites the two modules wholesale.
 *   Local (31337) and live (4663) entries coexist; each consumer selects its own
 *   chain. NEVER hand-edit the two generated files.
 *
 * Verify (task M1-14):
 *   deployments/<chainId>.json present (Deploy.s.sol wrote it);
 *   packages/shared/src/addresses.ts + apps/web/src/shared/config/addresses.ts
 *   regenerated and importable (getDeployment(31337) returns the smoke deployment).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// No viem import: this script runs from `contracts/` where the strict pnpm tree does
// not hoist viem. `forge`'s `serializeAddress` already emits EIP-55-checksummed
// addresses, so a shape regex is all the validation needed (fail-closed on garbage).
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const isAddress = (v: unknown): v is string => typeof v === "string" && ADDRESS_RE.test(v);

// ── Layout ──────────────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url)); // contracts/script
const contractsRoot = join(here, ".."); // contracts
const repoRoot = join(contractsRoot, ".."); // repo root
const deploymentsDir = join(contractsRoot, "deployments");
const sharedAddrFile = join(repoRoot, "packages", "shared", "src", "addresses.ts");
const webAddrFile = join(repoRoot, "apps", "web", "src", "shared", "config", "addresses.ts");

/** Flat artifact shape written by `Deploy.s.sol._writeArtifact`. */
type Artifact = {
  chainId: number;
  mode: "local" | "live";
  deployedAt: number;
  curveFactory: string;
  router: string;
  v3Migrator: string;
  lpFeeVault: string;
  treasury: string;
  canaryToken: string;
  canaryCurve: string;
  weth: string;
  v3Factory: string;
  positionManager: string;
  swapRouter02: string;
  quoterV2: string;
};

// ── 1. Read every deploy artifact ────────────────────────────────────────────
if (!existsSync(deploymentsDir)) {
  console.error(`[codegen-addresses] no deployments dir at ${deploymentsDir}`);
  console.error("[codegen-addresses] run `forge script script/Deploy.s.sol --broadcast` first.");
  process.exit(1);
}
const files = readdirSync(deploymentsDir).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error(`[codegen-addresses] no deployments/*.json in ${deploymentsDir} — nothing to codegen.`);
  process.exit(1);
}

// Load + validate. A single malformed/zero address fails the whole codegen loudly
// rather than shipping a silent gap into the consumers (fail-closed, like the ABI leg).
const ADDR_KEYS: (keyof Artifact)[] = [
  "curveFactory",
  "router",
  "v3Migrator",
  "lpFeeVault",
  "treasury",
  "canaryToken",
  "canaryCurve",
  "weth",
  "v3Factory",
  "positionManager",
  "swapRouter02",
  "quoterV2",
];
const artifacts: Artifact[] = [];
for (const f of files) {
  const a = JSON.parse(readFileSync(join(deploymentsDir, f), "utf8")) as Artifact;
  for (const k of ADDR_KEYS) {
    const v = a[k] as string;
    if (typeof v !== "string" || !isAddress(v)) {
      console.error(`[codegen-addresses] ${f}: field ${k} is not a valid address: ${String(v)}`);
      process.exit(1);
    }
  }
  artifacts.push(a);
}
artifacts.sort((x, y) => x.chainId - y.chainId);

// ── 2. Emit packages/shared/src/addresses.ts (single source of truth) ─────────
const cs = (v: string) => v; // forge serializeAddress already emits EIP-55-checksummed addrs

const entries = artifacts
  .map((a) => {
    return `  "${a.chainId}": {
    chainId: ${a.chainId},
    mode: "${a.mode}",
    deployedAt: ${a.deployedAt},
    robbed: {
      curveFactory: "${cs(a.curveFactory)}",
      router: "${cs(a.router)}",
      v3Migrator: "${cs(a.v3Migrator)}",
      lpFeeVault: "${cs(a.lpFeeVault)}",
      treasury: "${cs(a.treasury)}",
    },
    external: {
      weth: "${cs(a.weth)}",
      v3Factory: "${cs(a.v3Factory)}",
      positionManager: "${cs(a.positionManager)}",
      swapRouter02: "${cs(a.swapRouter02)}",
      quoterV2: "${cs(a.quoterV2)}",
    },
    canary: {
      token: "${cs(a.canaryToken)}",
      curve: "${cs(a.canaryCurve)}",
    },
  },`;
  })
  .join("\n");

const sharedBanner = `/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GENERATED by contracts/script/codegen-addresses.ts — DO NOT HAND-EDIT.
 *  Source: contracts/deployments/<chainId>.json (emitted by script/Deploy.s.sol
 *  under \`forge script … --broadcast\`). Regenerate:
 *    bun contracts/script/codegen-addresses.ts
 *
 *  Deploy-time codegen (needs a broadcast) — the addresses seam of architecture.md
 *  §4: contracts-pipeline-owned, lives in packages/shared, consumed by the indexer
 *  config and web \`shared/config/addresses.ts\`. Every consumer selects ITS OWN
 *  chain via \`getDeployment(chainId)\`; local (31337 smoke) and live (4663) entries
 *  coexist here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Address } from "viem";

export type DeploymentMode = "local" | "live";

/** The six-contract robbed topology + treasury for one chain (spec §6, §6.6). */
export interface Deployment {
  chainId: number;
  mode: DeploymentMode;
  deployedAt: number;
  /** The four singletons (§6) + the treasury Safe (§6.6). */
  robbed: {
    curveFactory: Address;
    router: Address;
    v3Migrator: Address;
    lpFeeVault: Address;
    treasury: Address;
  };
  /** Canonical externals wired at deploy (§12.28): WETH + the four Uniswap V3 addrs. */
  external: {
    weth: Address;
    v3Factory: Address;
    positionManager: Address;
    swapRouter02: Address;
    quoterV2: Address;
  };
  /** The deploy-time canary launch (§7.2 step 6) — informational; not a user token. */
  canary: { token: Address; curve: Address };
}
`;

const sharedBody = `${sharedBanner}
/** Every recorded deployment, keyed by chain id (string). @generated */
export const ROBBED_DEPLOYMENTS = {
${entries}
} as const satisfies Record<string, Deployment>;

/** Chain ids with a recorded deployment. @generated */
export type DeployedChainId = keyof typeof ROBBED_DEPLOYMENTS;

/**
 * Resolve the deployment for \`chainId\`, or \`undefined\` when none has been
 * broadcast+codegen'd for that chain yet (consumers then fail loud — see web
 * \`requireAddress\`). Never invents an address.
 */
export function getDeployment(chainId: number): Deployment | undefined {
  return (ROBBED_DEPLOYMENTS as Record<string, Deployment>)[String(chainId)];
}
`;

mkdirSync(dirname(sharedAddrFile), { recursive: true });
writeFileSync(sharedAddrFile, sharedBody);
console.log(`[codegen-addresses] wrote ${sharedAddrFile} (${artifacts.length} chain(s): ${artifacts.map((a) => a.chainId).join(", ")})`);

// ── 3. Regenerate apps/web/src/shared/config/addresses.ts (derives from shared) ─
// Web DERIVES ROBBED from the shared map for CHAIN_ID (single source — anti-drift);
// V3 stays re-exported from the ratified §12.28 registry constant. The M3-3
// fail-loud guard (requireAddress) is preserved so a missing 4663 deployment throws
// instead of sending a tx to 0x0.
const webBody = `/**
 * ────────────────────────────────────────────────────────────────────────────
 *  GENERATED by contracts/script/codegen-addresses.ts (M1-14) — DO NOT HAND-EDIT.
 *  Source: @robbed/shared \`ROBBED_DEPLOYMENTS\` (deploy-time codegen). Regenerate
 *  wholesale via \`bun contracts/script/codegen-addresses.ts\` after a broadcast.
 *
 *  Replaces the M3-3 placeholder stub. ROBBED is DERIVED (never re-declared) from
 *  the shared per-chain map for CHAIN_ID (web.md §2.1/§2.3, architecture.md §4).
 *  When no deployment exists for CHAIN_ID yet, the per-deployment addresses stay
 *  ZERO sentinels and \`requireAddress()\` throws — a missing codegen fails loudly
 *  instead of sending a tx to 0x0. The address-literal grep excludes this path.
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { Address } from "viem";
import { CHAIN_ID, UNISWAP_V3 } from "@robbed/shared";
import { getDeployment } from "@robbed/shared/addresses";

/** Zero sentinel — signals "no deployment for CHAIN_ID has been codegen'd". */
const PLACEHOLDER = "0x0000000000000000000000000000000000000000" as const;

const deployment = getDeployment(CHAIN_ID);

/**
 * Per-deployment robbed contract addresses (spec §6) for CHAIN_ID, derived from
 * the generated @robbed/shared map. Router, CurveFactory, LPFeeVault, V3Migrator,
 * and the treasury Safe (§6.6). ZERO sentinels until a CHAIN_ID deploy is codegen'd.
 */
export const ROBBED = {
  router: deployment?.robbed.router ?? PLACEHOLDER,
  curveFactory: deployment?.robbed.curveFactory ?? PLACEHOLDER,
  lpFeeVault: deployment?.robbed.lpFeeVault ?? PLACEHOLDER,
  v3Migrator: deployment?.robbed.v3Migrator ?? PLACEHOLDER,
  treasury: deployment?.robbed.treasury ?? PLACEHOLDER,
} satisfies Record<string, Address>;

/**
 * Canonical Uniswap V3 registry on 4663 — FIXED external addresses, ratified in
 * spec §12.28 and the single source in @robbed/shared (UNISWAP_V3). Re-exported
 * (not re-declared) so the post-grad widget imports one address module. Real
 * (not placeholders) and safe to use today.
 */
export const V3 = {
  factory: UNISWAP_V3.factory,
  positionManager: UNISWAP_V3.positionManager,
  swapRouter02: UNISWAP_V3.swapRouter02,
  quoterV2: UNISWAP_V3.quoterV2,
} as const satisfies Record<string, Address>;

/** True when no deployment for CHAIN_ID has been codegen'd (still a zero sentinel). */
export function isPlaceholder(address: Address): boolean {
  return address.toLowerCase() === PLACEHOLDER;
}

/**
 * Read a robbed address, failing loud if no CHAIN_ID deployment has been codegen'd
 * — a bad tx to 0x0 is far worse than a clear error. V3 (§12.28) addresses are real
 * and do not need this guard.
 */
export function requireAddress(address: Address, label: string): Address {
  if (isPlaceholder(address)) {
    throw new Error(
      \`[robbed/web] no deployment for CHAIN_ID=\${CHAIN_ID} in @robbed/shared for \${label}. \` +
        \`Run the M1-14 deploy + codegen (bun contracts/script/codegen-addresses.ts) before using robbed addresses.\`,
    );
  }
  return address;
}
`;

if (existsSync(dirname(webAddrFile))) {
  writeFileSync(webAddrFile, webBody);
  console.log(`[codegen-addresses] wrote ${webAddrFile}`);
} else {
  console.warn(`[codegen-addresses] web config dir absent (${dirname(webAddrFile)}) — skipped web addresses.ts`);
}
