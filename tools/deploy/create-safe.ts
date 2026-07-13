#!/usr/bin/env bun
/**
 * create-safe.ts — `bun run safe:create` (plan item T-2 prep).
 * Owner: robbed-contracts (tooling only — touches no contracts/src, no apps).
 *
 * Creates a treasury Safe using the CANONICAL Safe v1.4.1 contracts — never a
 * bespoke multisig (spec §6.6). Spec §12.52 confirms the canonical v1.4.1 set
 * exists on BOTH Robinhood mainnet 4663 and testnet 46630 (safe-deployments
 * lists 46630 "canonical"; ProxyFactory + SafeL2 singleton re-verified live),
 * so the local anvil fork of 4663 carries it too — fully live-testable.
 *
 * Flow (docs-first, verified 2026-07-11 against safe-global/safe-smart-account
 * tag v1.4.1 source — Safe.sol, proxies/SafeProxyFactory.sol, base/OwnerManager.sol):
 *
 *   SafeProxyFactory.createProxyWithNonce(singleton, initializer, saltNonce)
 *     initializer = Safe.setup(
 *       address[] _owners, uint256 _threshold,
 *       address to = 0, bytes data = 0x,                  // no delegatecall module setup
 *       address fallbackHandler = CompatibilityFallbackHandler,
 *       address paymentToken = 0, uint256 payment = 0,    // no deployment refund
 *       address payable paymentReceiver = 0,
 *     )
 *   → event ProxyCreation(SafeProxy indexed proxy, address singleton)
 *   → read-back getOwners() / getThreshold() on the proxy MUST match the input.
 *
 * CREATE2 salt is keccak256(keccak256(initializer), saltNonce) — re-running with
 * the same owners/threshold/saltNonce reverts ("Create2 call failed"); bump
 * SALT_NONCE (default: Date.now()) for a fresh address.
 *
 * Canonical v1.4.1 addresses (identical across canonical chains; spec §12.52 +
 * safe-global/safe-deployments src/assets/v1.4.1/*.json, verified 2026-07-11);
 * env-overridable but NEVER invented — code presence + singleton VERSION()
 * are asserted live before any tx:
 *   SafeProxyFactory              0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67
 *   SafeL2 singleton              0x29fcB43b46531BcA003ddC8FCB67FFE91900C762
 *   CompatibilityFallbackHandler  0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99
 * (SafeL2 — not Safe — per Safe's own guidance for L2 chains: it emits the
 * events the Safe{Wallet} indexer needs; same core logic, spec §12.52 set.)
 *
 * Chain guard: refuses to run unless chainid ∈ {4663, 46630, 31337} — Robinhood
 * mainnet/its local fork, Robinhood testnet, plain anvil. Ethereum mainnet and
 * every other major chain are rejected outright.
 *
 * Params (env, with CLI-flag overrides; the key is ENV-ONLY so it never lands
 * in `ps` output or shell-visible argv):
 *   RPC_URL               --rpc-url      default http://localhost:4545 (local fork)
 *   DEPLOYER_PRIVATE_KEY                 REQUIRED (env only)
 *   OWNERS                --owners       comma-separated addresses, REQUIRED
 *   THRESHOLD             --threshold    1 ≤ n ≤ owners.length, REQUIRED
 *   SALT_NONCE            --salt-nonce   uint256, default Date.now()
 *
 * Module resolution: same decision as tools/localstack/seed-chain.ts — tools/
 * is not a pnpm workspace member, so bare `import "viem"` cannot resolve here;
 * `createRequire` anchored at packages/shared/package.json resolves the exact
 * catalog-pinned viem (2.55.0).
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// ── viem via packages/shared's resolution (see header decision) ──────────────
const sharedRequire = createRequire(
  fileURLToPath(new URL("../../packages/shared/package.json", import.meta.url)),
);
const viem: typeof import("viem") = await import(sharedRequire.resolve("viem"));
const viemAccounts: typeof import("viem/accounts") = await import(
  sharedRequire.resolve("viem/accounts")
);
const {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  parseEventLogs,
} = viem;
const { privateKeyToAccount } = viemAccounts;

type Address = `0x${string}`;
type Hex = `0x${string}`;

// ── canonical Safe v1.4.1 set (spec §12.52; safe-deployments "canonical") ────
const CANONICAL = {
  proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  safeL2Singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
} as const;

// Robinhood mainnet 4663 (or its local anvil fork), Robinhood testnet 46630,
// plain anvil 31337. Everything else — chainid 1 first among them — is refused.
const ALLOWED_CHAIN_IDS = new Set<number>([4663, 46630, 31337]);
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

// ── v1.4.1 ABIs (verified against the tagged source, see header) ─────────────
const proxyFactoryAbi = parseAbi([
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy, address singleton)",
]);
const safeAbi = parseAbi([
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function VERSION() view returns (string)",
]);

// ── params: env first, CLI flags override (key is env-only) ──────────────────
function cliFlag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith("--")) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.slice(name.length + 3);
}
const die = (msg: string): never => {
  console.error(`[safe:create] ERROR: ${msg}`);
  process.exit(1);
};

const RPC_URL = cliFlag("rpc-url") ?? process.env.RPC_URL ?? "http://localhost:4545";
const PRIVATE_KEY = (process.env.DEPLOYER_PRIVATE_KEY ??
  die("DEPLOYER_PRIVATE_KEY is required (env only — never a CLI arg)")) as Hex;

const ownersRaw =
  cliFlag("owners") ?? process.env.OWNERS ?? die("OWNERS is required (comma-separated addresses)");
const OWNERS: Address[] = ownersRaw
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    try {
      return getAddress(s); // checksums; throws on malformed/bad-checksum input
    } catch {
      return die(`invalid owner address: ${s}`);
    }
  });
if (OWNERS.length === 0) die("OWNERS parsed to an empty list");
if (new Set(OWNERS.map((o) => o.toLowerCase())).size !== OWNERS.length) {
  die("OWNERS contains duplicates");
}
if (OWNERS.some((o) => o === ZERO)) die("OWNERS contains the zero address");

const thresholdRaw =
  cliFlag("threshold") ?? process.env.THRESHOLD ?? die("THRESHOLD is required");
const THRESHOLD = BigInt(thresholdRaw);
if (THRESHOLD < 1n || THRESHOLD > BigInt(OWNERS.length)) {
  die(`THRESHOLD must be in [1, ${OWNERS.length}] (got ${THRESHOLD})`);
}

const SALT_NONCE = BigInt(cliFlag("salt-nonce") ?? process.env.SALT_NONCE ?? Date.now());

const overridable = (envKey: string, fallback: string): Address =>
  getAddress(process.env[envKey] ?? fallback);
const PROXY_FACTORY = overridable("SAFE_PROXY_FACTORY", CANONICAL.proxyFactory);
const SINGLETON = overridable("SAFE_SINGLETON", CANONICAL.safeL2Singleton);
const FALLBACK_HANDLER = overridable("SAFE_FALLBACK_HANDLER", CANONICAL.fallbackHandler);

const log = (msg: string) => console.log(`[safe:create] ${msg}`);

// ── main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const probe = createPublicClient({ transport: http(RPC_URL) });
  const chainId = await probe.getChainId();

  // Hard chain guard — refuse chainid 1 and every other non-sanctioned chain.
  if (!ALLOWED_CHAIN_IDS.has(chainId)) {
    die(
      `refusing to run against chainid ${chainId} (${RPC_URL}). ` +
        `Sanctioned chains: 4663 (Robinhood mainnet / local fork), ` +
        `46630 (Robinhood testnet), 31337 (anvil). This guard is deliberate — ` +
        `it will not be bypassed by a flag.`,
    );
  }
  const chain = defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
  const pub = createPublicClient({ chain, transport: http(RPC_URL) });
  const account = privateKeyToAccount(PRIVATE_KEY);
  const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
  log(`chain ${chainId} @ ${RPC_URL}, deployer ${account.address}`);

  // Fail-closed preflight: canonical code present + singleton is really v1.4.1.
  for (const [label, addr] of [
    ["SafeProxyFactory", PROXY_FACTORY],
    ["SafeL2 singleton", SINGLETON],
    ["CompatibilityFallbackHandler", FALLBACK_HANDLER],
  ] as const) {
    const code = await pub.getCode({ address: addr });
    if (!code || code === "0x") {
      die(
        `no code at ${label} ${addr} on chain ${chainId} — the canonical Safe ` +
          `v1.4.1 set is not deployed here (on plain anvil 31337 you must deploy ` +
          `or fork it first; on 4663/46630 this contradicts spec §12.52 — investigate)`,
      );
    }
  }
  const version = await pub.readContract({
    address: SINGLETON,
    abi: safeAbi,
    functionName: "VERSION",
  });
  if (version !== "1.4.1") die(`singleton VERSION() is "${version}", expected "1.4.1"`);
  log(`canonical set verified on-chain (singleton VERSION 1.4.1)`);
  log(`owners (${OWNERS.length}): ${OWNERS.join(", ")}`);
  log(`threshold ${THRESHOLD}, saltNonce ${SALT_NONCE}`);

  // setup() initializer — exact v1.4.1 signature (see header). No delegatecall
  // setup leg (to=0/data=0x), no payment refund, canonical fallback handler.
  const initializer = encodeFunctionData({
    abi: safeAbi,
    functionName: "setup",
    args: [OWNERS, THRESHOLD, ZERO, "0x", FALLBACK_HANDLER, ZERO, 0n, ZERO],
  });

  // simulate (yields the counterfactual proxy address) → write → wait → event.
  const { request, result: predicted } = await pub
    .simulateContract({
      account,
      address: PROXY_FACTORY,
      abi: proxyFactoryAbi,
      functionName: "createProxyWithNonce",
      args: [SINGLETON, initializer, SALT_NONCE],
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Create2 call failed")) {
        return die(
          `CREATE2 collision — a Safe with this exact owners/threshold/saltNonce ` +
            `(${SALT_NONCE}) already exists on this chain; bump SALT_NONCE for a ` +
            `fresh address (or reuse the existing Safe)`,
        );
      }
      return die(`createProxyWithNonce simulation failed: ${msg.split("\n")[0]}`);
    });
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    die(
      `createProxyWithNonce reverted (tx ${hash}) — if this is a CREATE2 ` +
        `collision, this exact owners/threshold/saltNonce Safe already exists; ` +
        `bump SALT_NONCE`,
    );
  }
  const [creation] = parseEventLogs({
    abi: proxyFactoryAbi,
    eventName: "ProxyCreation",
    logs: receipt.logs,
  });
  if (!creation) die(`ProxyCreation event not found in receipt (tx ${hash})`);
  const safe = getAddress(creation!.args.proxy);
  if (safe !== getAddress(predicted)) {
    die(`event proxy ${safe} != simulated return ${predicted} — refusing to trust either`);
  }
  if (getAddress(creation!.args.singleton) !== SINGLETON) {
    die(`ProxyCreation singleton ${creation!.args.singleton} != expected ${SINGLETON}`);
  }
  log(`created Safe proxy ${safe} (tx ${hash}, block ${receipt.blockNumber})`);

  // Read-back verification — the deliverable is only "created" if the live
  // Safe reports exactly the requested owners (order-preserved: v1.4.1
  // OwnerManager.setupOwners builds the linked list in input order) + threshold.
  const [gotOwners, gotThreshold, gotVersion] = await Promise.all([
    pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
    pub.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }),
    pub.readContract({ address: safe, abi: safeAbi, functionName: "VERSION" }),
  ]);
  const normalized = gotOwners.map((o) => getAddress(o));
  const ownersMatch =
    normalized.length === OWNERS.length && normalized.every((o, i) => o === OWNERS[i]);
  if (!ownersMatch) {
    die(`read-back getOwners() [${normalized.join(", ")}] != requested [${OWNERS.join(", ")}]`);
  }
  if (gotThreshold !== THRESHOLD) {
    die(`read-back getThreshold() ${gotThreshold} != requested ${THRESHOLD}`);
  }
  log(`read-back OK: getOwners() matches (${normalized.length}), getThreshold() == ${gotThreshold}, VERSION ${gotVersion}`);

  console.log("");
  console.log(`SAFE_ADDRESS=${safe}`);
  console.log("");
  log(
    `record this address as the treasury (constants file \`treasurySafe\` / env) ` +
      `per docs/developers/runbooks/testnet.md §6 — the deploy fails closed without it`,
  );
}

await main();
