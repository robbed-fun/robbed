#!/usr/bin/env bun
/**
 * Emit compose-ready deployment artifacts after a public-chain Deploy.s.sol broadcast.
 *
 * Usage:
 *   bun contracts/script/emit-deployment-env.ts --network testnet
 *   bun contracts/script/emit-deployment-env.ts --network mainnet
 *
 * Reads:
 *   contracts/deployments/<chainId>.json
 *   contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json
 *
 * Writes:
 *   tools/deployments/<network>.json
 *   tools/localstack/out/<network>.env
 *
 * Mainnet fails closed unless the deploy artifact is mode "live"; a 4663 fork artifact is never
 * allowed to populate the mainnet stack.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Network = "testnet" | "mainnet";

type NetworkConfig = {
  chainId: number;
  mode: "testnet" | "live";
  verifier: string;
  deployHint: string;
};

type Artifact = {
  chainId: number;
  mode: "local" | "testnet" | "live" | "fork";
  deployedAt: number;
  curveFactory: string;
  router: string;
  v3Migrator: string;
  lpFeeVault: string;
  creatorVault: string;
  treasury: string;
  canaryToken: string;
  canaryCurve: string;
  weth: string;
  v3Factory: string;
  positionManager: string;
  swapRouter02: string;
  quoterV2: string;
};

type DeploymentRecord = {
  chainId: number;
  mode: Artifact["mode"];
  deployedAt: number;
  startBlock: string;
  source: {
    artifact: string;
    broadcast: string;
    emitter: string;
  };
  robbed: {
    curveFactory: string;
    router: string;
    v3Migrator: string;
    lpFeeVault: string;
    creatorVault: string;
    treasury: string;
  };
  external: {
    weth: string;
    v3Factory: string;
    positionManager: string;
    swapRouter02: string;
    quoterV2: string;
  };
  canary: { token: string; curve: string };
  verification: {
    status: string;
    verifier: string;
    guids: Record<string, string | null>;
  };
};

const NETWORKS: Record<Network, NetworkConfig> = {
  testnet: {
    chainId: 46_630,
    mode: "testnet",
    verifier: "blockscout-v2 (testnet, no API key)",
    deployHint:
      "bash scripts/deploy-onchain.sh protocol --network testnet --deployer 0xDeployer --verify --account robbed-testnet-deployer",
  },
  mainnet: {
    chainId: 4_663,
    mode: "live",
    verifier: "blockscout-v2 (mainnet)",
    deployHint:
      "bash scripts/deploy-onchain.sh protocol --network mainnet --deployer 0xDeployer --verify --account robbed-mainnet-deployer",
  },
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ADDR_KEYS = [
  "curveFactory",
  "router",
  "v3Migrator",
  "lpFeeVault",
  "creatorVault",
  "treasury",
  "canaryToken",
  "canaryCurve",
  "weth",
  "v3Factory",
  "positionManager",
  "swapRouter02",
  "quoterV2",
] as const;
const VERIFICATION_CONTRACTS = [
  "curveFactory",
  "router",
  "v3Migrator",
  "lpFeeVault",
  "canaryToken",
  "canaryCurve",
];

const usage = [
  "Usage:",
  "  bun contracts/script/emit-deployment-env.ts --network testnet",
  "  bun contracts/script/emit-deployment-env.ts --network mainnet",
].join("\n");

function fail(prefix: string, msg: string): never {
  console.error(`[${prefix}] FATAL: ${msg}`);
  process.exit(1);
}

function parseNetwork(argv: string[]): Network {
  let candidate: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }
    if (arg === "--network" || arg === "-n") {
      candidate = argv[++i];
      continue;
    }
    if (arg.startsWith("--network=")) {
      candidate = arg.slice("--network=".length);
      continue;
    }
    if (!arg.startsWith("-") && candidate === undefined) {
      candidate = arg;
      continue;
    }
    fail("emit-deployment-env", `unknown argument "${arg}"\n${usage}`);
  }

  if (candidate === "testnet" || candidate === "mainnet") return candidate;
  fail("emit-deployment-env", `missing or invalid --network value: ${String(candidate)}\n${usage}`);
}

const network = parseNetwork(process.argv.slice(2));
const config = NETWORKS[network];
const prefix = `emit-deployment-env:${network}`;

const here = dirname(fileURLToPath(import.meta.url));
const contractsRoot = join(here, "..");
const repoRoot = join(contractsRoot, "..");
const artifactRel = `contracts/deployments/${config.chainId}.json`;
const broadcastRel = `contracts/broadcast/Deploy.s.sol/${config.chainId}/run-latest.json`;
const outJsonRel = `tools/deployments/${network}.json`;
const outEnvRel = `tools/localstack/out/${network}.env`;
const artifactPath = join(repoRoot, artifactRel);
const broadcastPath = join(repoRoot, broadcastRel);
const outJsonPath = join(repoRoot, outJsonRel);
const outEnvPath = join(repoRoot, outEnvRel);

if (!existsSync(artifactPath)) {
  fail(
    prefix,
    `${artifactRel} not found. Run the deploy first:\n` +
      `  ${config.deployHint}\n` +
      `(requires a funded deployer, Foundry wallet signing, and tools/m0/out/constants.${network}.json)`,
  );
}

const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as Artifact;
if (artifact.chainId !== config.chainId) {
  fail(prefix, `artifact chainId ${artifact.chainId} != ${config.chainId}`);
}
if (artifact.mode !== config.mode) {
  fail(
    prefix,
    `artifact mode "${artifact.mode}" != "${config.mode}" - refusing to emit ${network}.env`,
  );
}
for (const key of ADDR_KEYS) {
  const value = artifact[key];
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    fail(prefix, `artifact field ${key} is not a valid address: ${String(value)}`);
  }
}

if (!existsSync(broadcastPath)) {
  fail(prefix, `${broadcastRel} not found - was the forge script run with --broadcast?`);
}
const broadcast = JSON.parse(readFileSync(broadcastPath, "utf8")) as {
  receipts?: { blockNumber?: string }[];
};
const blockNumbers = (broadcast.receipts ?? [])
  .map((receipt) => receipt.blockNumber)
  .filter((block): block is string => typeof block === "string")
  .map((block) => BigInt(block));
if (blockNumbers.length === 0) {
  fail(prefix, `no receipt blockNumbers in ${broadcastRel} - broadcast incomplete?`);
}
const startBlock = blockNumbers.reduce((min, block) => (block < min ? block : min));

const record: DeploymentRecord = {
  chainId: artifact.chainId,
  mode: artifact.mode,
  deployedAt: artifact.deployedAt,
  startBlock: startBlock.toString(),
  source: {
    artifact: artifactRel,
    broadcast: broadcastRel,
    emitter: `contracts/script/emit-deployment-env.ts --network ${network}`,
  },
  robbed: {
    curveFactory: artifact.curveFactory,
    router: artifact.router,
    v3Migrator: artifact.v3Migrator,
    lpFeeVault: artifact.lpFeeVault,
    creatorVault: artifact.creatorVault,
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
  verification: {
    status: "PENDING",
    verifier: config.verifier,
    guids: Object.fromEntries(VERIFICATION_CONTRACTS.map((contract) => [contract, null])),
  },
};

mkdirSync(dirname(outJsonPath), { recursive: true });
if (existsSync(outJsonPath)) {
  const prev = JSON.parse(readFileSync(outJsonPath, "utf8")) as DeploymentRecord;
  if (prev.robbed?.curveFactory === record.robbed.curveFactory && prev.verification?.guids) {
    record.verification = prev.verification;
  }
}
writeFileSync(outJsonPath, JSON.stringify(record, null, 2) + "\n");
console.log(`[${prefix}] wrote ${outJsonRel}`);

mkdirSync(dirname(outEnvPath), { recursive: true });
const env = [
  `# generated by contracts/script/emit-deployment-env.ts --network ${network} from ${outJsonRel} - do not edit`,
  `CURVE_FACTORY_ADDRESS=${artifact.curveFactory}`,
  `ROUTER_ADDRESS=${artifact.router}`,
  `MIGRATOR_ADDRESS=${artifact.v3Migrator}`,
  `TREASURY_ADDRESS=${artifact.treasury}`,
  `LP_FEE_VAULT_ADDRESS=${artifact.lpFeeVault}`,
  `CREATOR_VAULT_ADDRESS=${artifact.creatorVault}`,
  `WETH_ADDRESS=${artifact.weth}`,
  `START_BLOCK=${startBlock}`,
  "",
].join("\n");
writeFileSync(outEnvPath, env);
console.log(`[${prefix}] wrote ${outEnvRel}`);
console.log(env);
