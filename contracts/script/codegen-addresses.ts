#!/usr/bin/env bun
/**
 * M1-14 — deploy-time addresses codegen (architecture.md §4; contracts.md §7.2).
 *
 * DEPLOY-time (NOT compilation-time) leg: after `forge script script/Deploy.s.sol
 * --broadcast`, the deploy script writes a self-describing per-chain artifact to
 * `contracts/deployments/<chainId>.json`. This script reads EVERY such artifact
 * and emits the SINGLE generated addresses module the other services consume:
 *
 *   packages/shared/src/addresses.ts          — the single source: a per-chain
 *                                                `ROBBED_DEPLOYMENTS` map + a
 *                                                `getDeployment(chainId)` helper
 *                                                (indexer config + web import it)
 *
 * NOT a codegen target (since the I-5/§12.55 split): apps/web/src/shared/config/
 * addresses.ts is HAND-AUTHORED derivation logic (env-selected chain target via
 * `env.chainId()`, the NEXT_PUBLIC_E2E_* fork-address override seam, registry-
 * derived V3/WETH exports) that IMPORTS the generated map. Codegen never writes
 * into apps/web — pure data lives here, behavior lives with the app, so a
 * broadcast+regen can never clobber the hand-authored seams.
 *
 * Owned by the contracts pipeline (generated artifact), lives under packages/shared
 * per the anti-drift rule — the exact same ownership model as the compilation-time
 * `codegen-abi.ts` (architecture.md §4). Distinct from that leg: this one needs a
 * broadcast, so it reads deploy artifacts, not `contracts/out`.
 *
 * Re-runnable (idempotent):  bun contracts/script/codegen-addresses.ts
 *   Reads whatever `deployments/*.json` exist and rewrites the shared module
 *   wholesale. Local (31337), testnet (46630) and live (4663) entries coexist;
 *   each consumer selects its own chain. NEVER hand-edit the generated file.
 *
 * Verify (task M1-14):
 *   deployments/<chainId>.json present (Deploy.s.sol wrote it);
 *   packages/shared/src/addresses.ts regenerated and importable
 *   (getDeployment(31337) returns the smoke deployment).
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

/** Flat artifact shape written by `Deploy.s.sol._writeArtifact`. */
type Artifact = {
  chainId: number;
  mode: "local" | "testnet" | "live" | "fork";
  deployedAt: number;
  curveFactory: string;
  router: string;
  v3Migrator: string;
  lpFeeVault: string;
  // §12.63 pull-payment CreatorVault. OPTIONAL + additive: v1 artifacts predate it, so it is NOT in
  // the required ADDR_KEYS set (that would break older deployments); validated + emitted only when
  // a creator-fee deploy artifact carries it.
  creatorVault?: string;
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
// ── §12.55 / T-5 registry-mode invariant (fail-closed) ───────────────────────
// The registry is the thing downstream services (indexer §12.55 chain-identity
// gate) assert against, so codegen is the last line that can refuse to MINT a
// bad `mode:"live"` entry. Two rules, both fail the whole codegen loudly:
//   1. Only chain 4663 may ever be `mode:"live"` (mainnet is the sole live chain);
//      46630 is `testnet`, 31337 is `local`, a 4663 fork is `fork`.
//   2. A `live` entry may NOT carry a well-known ANVIL dev-account treasury — that
//      is exactly the fork-artifact-mislabeled-live defect §12.55 flagged (the old
//      4663.json had the anvil account-1 treasury under `mode:"live"`). A real
//      Phase-B treasury is a Gnosis Safe (§6.6), never a deterministic dev key.
// Together with Deploy.s.sol's fail-safe live-affirmation (decision #5), a fork
// run cannot produce a `mode:"live"` 4663 registry entry through this pipeline.
const VALID_MODES = new Set(["local", "testnet", "live", "fork"]);
const LIVE_CHAIN_ID = 4663;
// Anvil's default-mnemonic accounts 0 & 1 (public dev keys — NOT secrets). Any of
// these as a `live` treasury proves the artifact is a dev/fork run, not mainnet.
const ANVIL_DEV_ACCOUNTS = new Set(
  ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"].map((a) =>
    a.toLowerCase(),
  ),
);

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
  // §12.63 optional creatorVault: absent on v1 artifacts (fine); if present it must be a valid addr.
  if (a.creatorVault !== undefined && !isAddress(a.creatorVault)) {
    console.error(`[codegen-addresses] ${f}: creatorVault present but not a valid address: ${String(a.creatorVault)}`);
    process.exit(1);
  }
  if (!VALID_MODES.has(a.mode)) {
    console.error(`[codegen-addresses] ${f}: unknown mode ${JSON.stringify(a.mode)} (expected one of ${[...VALID_MODES].join(", ")}).`);
    process.exit(1);
  }
  if (a.mode === "live" && a.chainId !== LIVE_CHAIN_ID) {
    console.error(`[codegen-addresses] ${f}: mode:"live" is only valid for chain ${LIVE_CHAIN_ID}, got ${a.chainId} (§12.55).`);
    process.exit(1);
  }
  if (a.mode === "live" && ANVIL_DEV_ACCOUNTS.has(a.treasury.toLowerCase())) {
    console.error(
      `[codegen-addresses] ${f}: mode:"live" with an anvil dev-account treasury ${a.treasury} — this is a ` +
        `mainnet-FORK artifact mislabeled live (§12.55). A real deploy sets ROBBED_DEPLOY_ENV=mainnet and a ` +
        `Gnosis Safe treasury; a fork run yields mode:"fork". Refusing to mint a false-live registry entry.`,
    );
    process.exit(1);
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
      treasury: "${cs(a.treasury)}",${a.creatorVault ? `\n      creatorVault: "${cs(a.creatorVault)}",` : ""}
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
 *  chain via \`getDeployment(chainId)\`; local (31337 smoke), testnet (46630) and
 *  live (4663) entries coexist here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Address } from "viem";

/**
 * A 4663 \`fork\` is a mainnet-FORK pipeline run (anvil --fork-url): same chainid as
 * \`live\` but deliberately NOT live so a fork can never masquerade as a real mainnet
 * deployment (§12.55). Consumers that require a canonical mainnet entry MUST assert
 * \`mode === "live"\`; the indexer's chain-identity gate does exactly this.
 */
export type DeploymentMode = "local" | "testnet" | "live" | "fork";

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
    /**
     * The Phase-2 pull-payment CreatorVault (spec §7 / §12.63). OPTIONAL +
     * additive: absent on every v1 deployment (no vault exists until a
     * creator-fee factory is deployed), so the existing entries below stay valid
     * against this shape. Once a creator-fee deploy artifact carries it, codegen
     * emits \`robbed.creatorVault\` and consumers (indexer CreatorVault source,
     * web claim widget) get it typed. CODEGEN-LOCKSTEP (report): the pipeline's
     * \`contracts/script/codegen-addresses.ts\` — \`Artifact\`/\`ADDR_KEYS\` + the
     * \`robbed:\` emit block + this interface template — must add \`creatorVault\`
     * (optional) so a regen doesn't drop this field; robbed-contracts owns that.
     */
    creatorVault?: Address;
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

// NOTE (I-5/§12.55 split): apps/web/src/shared/config/addresses.ts is intentionally
// NOT emitted here. It is hand-authored derivation logic (e2e fork-address override,
// env-selected chain target, registry-derived V3/WETH) importing the generated map
// above — regenerating it here once clobbered those seams. Codegen owns data only.
