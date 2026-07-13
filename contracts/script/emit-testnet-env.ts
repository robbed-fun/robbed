#!/usr/bin/env bun
/**
 * emit-testnet-env.ts — Phase T-3 deploy-artifact emitter (docs/developers/runbooks/testnet.md §6;
 * docker-compose.testnet.yml contract documented in docs/developers/runbooks/docker.md "Testnet stack").
 *
 * The LOCAL stack's `deploychain` compose one-shot emits tools/localstack/out/local.env inline
 * (docker-compose.yml) because it also runs the deploy. On TESTNET there is no deploychain — the
 * deploy is a manual `forge script … --broadcast` against the remote chain (testnet.md §6) — so
 * this script is the post-broadcast leg. Run it from anywhere after a testnet broadcast:
 *
 *   bun contracts/script/emit-testnet-env.ts
 *
 * Reads:
 *   contracts/deployments/46630.json                       — the self-describing artifact
 *     Deploy.s.sol wrote (mode MUST be "testnet"; fail-closed otherwise)
 *   contracts/broadcast/Deploy.s.sol/46630/run-latest.json  — broadcast receipts, for the
 *     deploy block (START_BLOCK = min receipt blockNumber so the indexer's backfill window
 *     INCLUDES the canary TokenCreated/Trade emitted during the deploy itself; the local
 *     deploychain equivalently records `cast block-number` BEFORE deploying)
 *
 * Writes:
 *   tools/deployments/testnet.json        — addresses + START_BLOCK + verification-GUID
 *     placeholders (filled as `forge verify-contract` runs report GUIDs — contracts.md §7.2
 *     step 8; Blockscout v2 verifier on the testnet explorer needs no API key, spec §12.52)
 *   tools/localstack/out/testnet.env      — SAME keys as the deploychain-emitted local.env
 *     (CURVE_FACTORY_ADDRESS, ROUTER_ADDRESS, MIGRATOR_ADDRESS, TREASURY_ADDRESS,
 *     LP_FEE_VAULT_ADDRESS, START_BLOCK) — the fail-closed prerequisite of
 *     docker-compose.testnet.yml's api/indexer services.
 *
 * Fail-closed by design: any missing file, wrong mode/chainId, malformed address, or absent
 * receipts exits 1 — a partial/ambiguous emit is worse than none (the compose stack refuses
 * to start without the file and points here).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Official Robinhood Chain testnet id (spec §12.49; docs/developers/runbooks/testnet.md §1).
const TESTNET_CHAIN_ID = 46630;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// ── Layout (same anchors as codegen-addresses.ts) ────────────────────────────
const here = dirname(fileURLToPath(import.meta.url)); // contracts/script
const contractsRoot = join(here, "..");
const repoRoot = join(contractsRoot, "..");
const artifactPath = join(contractsRoot, "deployments", `${TESTNET_CHAIN_ID}.json`);
const broadcastPath = join(contractsRoot, "broadcast", "Deploy.s.sol", String(TESTNET_CHAIN_ID), "run-latest.json");
const outJsonPath = join(repoRoot, "tools", "deployments", "testnet.json");
const outEnvPath = join(repoRoot, "tools", "localstack", "out", "testnet.env");

const fail = (msg: string): never => {
  console.error(`[emit-testnet-env] FATAL: ${msg}`);
  process.exit(1);
};

// ── 1. Deploy artifact (Deploy.s.sol._writeArtifact, mode "testnet") ─────────
if (!existsSync(artifactPath)) {
  fail(
    `${artifactPath} not found — run the T-3 deploy first:\n` +
      `  cd contracts && forge script script/Deploy.s.sol --rpc-url "$TESTNET_RPC_URL" --broadcast\n` +
      `(needs DEPLOYER_PRIVATE_KEY + tools/m0/out/constants.testnet.json — testnet.md §6)`,
  );
}
type Artifact = {
  chainId: number;
  mode: "local" | "testnet" | "live";
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
const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as Artifact;
if (artifact.chainId !== TESTNET_CHAIN_ID) fail(`artifact chainId ${artifact.chainId} != ${TESTNET_CHAIN_ID}`);
if (artifact.mode !== "testnet") fail(`artifact mode "${artifact.mode}" != "testnet" — refusing to emit testnet.env`);
const ADDR_KEYS = [
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
] as const;
for (const k of ADDR_KEYS) {
  const v = artifact[k];
  if (typeof v !== "string" || !ADDRESS_RE.test(v)) fail(`artifact field ${k} is not a valid address: ${String(v)}`);
}

// ── 2. START_BLOCK from the broadcast receipts (min blockNumber) ─────────────
if (!existsSync(broadcastPath)) fail(`${broadcastPath} not found — was the forge script run with --broadcast?`);
const broadcast = JSON.parse(readFileSync(broadcastPath, "utf8")) as {
  receipts?: { blockNumber?: string }[];
};
const blockNumbers = (broadcast.receipts ?? [])
  .map((r) => r.blockNumber)
  .filter((b): b is string => typeof b === "string")
  .map((b) => BigInt(b));
if (blockNumbers.length === 0) fail(`no receipt blockNumbers in ${broadcastPath} — broadcast incomplete?`);
const startBlock = blockNumbers.reduce((min, b) => (b < min ? b : min));

// ── 3. tools/deployments/testnet.json (T-3 record: addresses + verification GUIDs) ──
const verificationContracts = ["curveFactory", "router", "v3Migrator", "lpFeeVault", "canaryToken", "canaryCurve"];
const record = {
  chainId: artifact.chainId,
  mode: artifact.mode,
  deployedAt: artifact.deployedAt,
  startBlock: startBlock.toString(),
  source: {
    artifact: "contracts/deployments/46630.json",
    broadcast: "contracts/broadcast/Deploy.s.sol/46630/run-latest.json",
    emitter: "contracts/script/emit-testnet-env.ts",
  },
  robbed: {
    curveFactory: artifact.curveFactory,
    router: artifact.router,
    v3Migrator: artifact.v3Migrator,
    lpFeeVault: artifact.lpFeeVault,
    treasury: artifact.treasury,
  },
  external: {
    weth: artifact.weth,
    v3Factory: artifact.v3Factory,
    positionManager: artifact.positionManager,
    swapRouter02: artifact.swapRouter02,
    quoterV2: artifact.quoterV2,
  },
  canary: { token: artifact.canaryToken, curve: artifact.canaryCurve },
  // Blockscout verification GUIDs (contracts.md §7.2 step 8) — placeholders until each
  // `forge verify-contract … --verifier blockscout --verifier-url $TESTNET_BLOCKSCOUT_URL/api`
  // run reports its GUID; recorded here so CI/the runbook can audit verification coverage.
  verification: {
    status: "PENDING",
    verifier: "blockscout-v2 (no API key — spec §12.52)",
    guids: Object.fromEntries(verificationContracts.map((c) => [c, null])),
  },
};
mkdirSync(dirname(outJsonPath), { recursive: true });
// Preserve already-recorded verification GUIDs on re-runs (re-emitting addresses must not
// wipe the verification audit trail).
if (existsSync(outJsonPath)) {
  const prev = JSON.parse(readFileSync(outJsonPath, "utf8")) as typeof record;
  if (prev.robbed?.curveFactory === record.robbed.curveFactory && prev.verification?.guids) {
    record.verification = prev.verification;
  }
}
writeFileSync(outJsonPath, JSON.stringify(record, null, 2) + "\n");
console.log(`[emit-testnet-env] wrote ${outJsonPath}`);

// ── 4. tools/localstack/out/testnet.env — same key contract as local.env ─────
mkdirSync(dirname(outEnvPath), { recursive: true });
const env = [
  "# generated by contracts/script/emit-testnet-env.ts from tools/deployments/testnet.json — do not edit",
  `CURVE_FACTORY_ADDRESS=${artifact.curveFactory}`,
  `ROUTER_ADDRESS=${artifact.router}`,
  `MIGRATOR_ADDRESS=${artifact.v3Migrator}`,
  `TREASURY_ADDRESS=${artifact.treasury}`,
  `LP_FEE_VAULT_ADDRESS=${artifact.lpFeeVault}`,
  `START_BLOCK=${startBlock}`,
  "",
].join("\n");
writeFileSync(outEnvPath, env);
console.log(`[emit-testnet-env] wrote ${outEnvPath}`);
console.log(env);
