/**
 * ── anvil / on-chain harness (plan I-5a) ─────────────────────────────────────
 * viem clients + time-warp helpers + deployed-address loader for the fork. Used
 * BOTH to seed fixtures (createToken, buy-to-near-graduation, graduate) and to
 * assert the on-chain truth layer of a flow (receipt status, reserves, balances).
 *
 * Docs-first (viem.sh, 2026-07-10): `createPublicClient`/`createWalletClient`/
 * `createTestClient` with the `anvil` actions (`mine`, `increaseTime`, `setCode`,
 * `setBalance`). ABIs + the shared curve math come from `@robbed/shared` — no ABI
 * is ever hand-written here (anti-drift rule).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  bondingCurveAbi,
  curveFactoryAbi,
  lpFeeVaultAbi,
  routerAbi,
} from "@robbed/shared/abi";
import {
  http,
  type Address,
  type Hash,
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ROLES, STACK, type DevAccount } from "./config";

export const forkChain = defineChain({
  id: 4663,
  name: "Robinhood Chain (fork)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [STACK.rpcUrl] } },
});

export const publicClient = createPublicClient({
  chain: forkChain,
  transport: http(STACK.rpcUrl),
});

export const testClient = createTestClient({
  chain: forkChain,
  mode: "anvil",
  transport: http(STACK.rpcUrl),
});

export function walletFor(account: DevAccount) {
  return createWalletClient({
    account: privateKeyToAccount(account.privateKey),
    chain: forkChain,
    transport: http(STACK.rpcUrl),
  });
}

// ── deployed addresses (from the deploychain one-shot) ───────────────────────

export interface DeployedAddresses {
  router: Address;
  curveFactory: Address;
  lpFeeVault: Address;
  treasury: Address;
  startBlock: bigint;
}

/**
 * Read `tools/localstack/out/local.env`, emitted by the compose `deploychain`
 * one-shot. Env vars (`ROUTER_ADDRESS`, …) win when present so CI can override.
 */
export function loadDeployedAddresses(): DeployedAddresses {
  const fromEnv = (k: string) => process.env[k];
  let file: Record<string, string> = {};
  try {
    const path = fileURLToPath(
      new URL("../../../../tools/localstack/out/local.env", import.meta.url),
    );
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) file[m[1]!] = m[2]!;
    }
  } catch {
    /* file absent until the stack has deployed; env vars can still supply these */
  }
  const pick = (k: string) => fromEnv(k) ?? file[k];
  const need = (k: string): string => {
    const v = pick(k);
    if (!v) throw new Error(`[e2e] missing deployed address ${k} (run the stack)`);
    return v;
  };
  return {
    router: need("ROUTER_ADDRESS") as Address,
    curveFactory: need("CURVE_FACTORY_ADDRESS") as Address,
    lpFeeVault: need("LP_FEE_VAULT_ADDRESS") as Address,
    treasury: need("TREASURY_ADDRESS") as Address,
    startBlock: BigInt(pick("START_BLOCK") ?? "0"),
  };
}

// ── time-warp helpers (anti-sniper window + graduation) ──────────────────────

/**
 * CHAIN time, not host time. Specs warp the fork forward (`increaseTime`)
 * across the suite, so the fork clock drifts arbitrarily far AHEAD of the
 * host wallclock — any deadline/window computed from `Date.now()` eventually
 * reads as already-expired on-chain. Always derive tx deadlines and query
 * windows from the latest block timestamp.
 */
export async function chainNow(): Promise<number> {
  const block = await publicClient.getBlock();
  return Number(block.timestamp);
}

/** Fresh tx deadline `secondsAhead` past CHAIN time (default 10m). */
export async function txDeadline(secondsAhead = 600): Promise<bigint> {
  return BigInt((await chainNow()) + secondsAhead);
}

/** Advance the fork clock by `seconds` and mine a block (viem anvil actions). */
export async function warpTime(seconds: number): Promise<void> {
  await testClient.increaseTime({ seconds });
  await testClient.mine({ blocks: 1 });
}

/** Mine `n` blocks (default 1) — used to force inclusion / advance watermarks. */
export async function mine(blocks = 1): Promise<void> {
  await testClient.mine({ blocks });
}

/** Snapshot / revert so specs can restore fork state (viem `snapshot`/`revert`). */
export async function snapshot(): Promise<`0x${string}`> {
  return testClient.snapshot();
}
export async function revert(id: `0x${string}`): Promise<void> {
  await testClient.revert({ id });
}

// ── curve reads (Trust-panel truth) ──────────────────────────────────────────

export async function readReserves(curve: Address): Promise<{
  virtualEth: bigint;
  realEth: bigint;
}> {
  const res = (await publicClient.readContract({
    address: curve,
    abi: bondingCurveAbi,
    functionName: "reserves",
  })) as readonly bigint[];
  // `reserves()` → (virtualEth, virtualToken, realEth, realToken, …); we assert
  // the ETH legs the Trust panel renders.
  return { virtualEth: res[0]!, realEth: res[2]! };
}

/**
 * LIVE graduation threshold from the DEPLOYED curve — `BondingCurve.GRADUATION_ETH()`
 * (§6.2). ALWAYS read on-chain, never the static M0 notebook: the target moved
 * 8.076869 → 7.916610 ETH and the `constants.fork.json` fixture can lag whatever
 * the deploy actually baked in. Mirrors the frontend's SafetyStrip live read
 * (`entities/curve/model/reads.ts` reads the same immutable getter). This is the
 * authoritative source for "how much ETH graduates this curve".
 */
export async function readGraduationEth(curve: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: curve,
    abi: bondingCurveAbi,
    functionName: "GRADUATION_ETH",
  })) as bigint;
}

// ── transactions used to SEED fixtures (server-side, not via the UI) ─────────

export interface CreatedToken {
  token: Address;
  curve: Address;
  txHash: Hash;
}

/**
 * Seed a token straight on-chain (fast path for TD/DISC fixtures). UI-driven
 * launch is exercised separately by LAUNCH-1/2. `metadataHash`/`metadataUri`
 * are supplied by the caller (computed from the shared canonicalizer).
 */
export async function createTokenOnChain(args: {
  creator?: DevAccount;
  name: string;
  symbol: string;
  metadataHash: `0x${string}`;
  metadataUri: string;
  deployFeeWei: bigint;
  initialBuyWei?: bigint;
}): Promise<CreatedToken> {
  const wallet = walletFor(args.creator ?? ROLES.creator);
  const { router } = loadDeployedAddresses();
  const deadline = await txDeadline();
  const value = args.deployFeeWei + (args.initialBuyWei ?? 0n);
  const txHash = await wallet.writeContract({
    address: router,
    abi: routerAbi,
    functionName: "createToken",
    args: [args.name, args.symbol, args.metadataHash, args.metadataUri, 0n, deadline],
    value,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  // The Router returns (token, curve); decode from logs is indexer's job, but for
  // seeding we simulate to recover the return values deterministically.
  const { result } = await publicClient.simulateContract({
    account: (args.creator ?? ROLES.creator).address,
    address: router,
    abi: routerAbi,
    functionName: "createToken",
    args: [args.name, args.symbol, args.metadataHash, args.metadataUri, 0n, deadline],
    value,
    blockNumber: receipt.blockNumber - 1n,
  });
  const [token, curve] = result as unknown as [Address, Address, bigint];
  return { token, curve, txHash };
}

/** Buy on the curve, server-side (state seeding). Returns the tx hash.
 * `nonce` lets bulk seeders (PORT-5 pagination) pipeline txs without a receipt
 * wait per tx (viem wallet clients otherwise re-fetch the same pending nonce). */
export async function buyOnChain(args: {
  buyer?: DevAccount;
  token: Address;
  ethWei: bigint;
  nonce?: number;
}): Promise<Hash> {
  const wallet = walletFor(args.buyer ?? ROLES.trader);
  const { router } = loadDeployedAddresses();
  const deadline = await txDeadline();
  return wallet.writeContract({
    address: router,
    abi: routerAbi,
    functionName: "buy",
    args: [args.token, (args.buyer ?? ROLES.trader).address, 0n, deadline],
    value: args.ethWei,
    ...(args.nonce !== undefined ? { nonce: args.nonce } : {}),
  });
}

/** Permissionless graduation trigger against the curve. */
export async function graduateOnChain(curve: Address, by?: DevAccount): Promise<Hash> {
  const wallet = walletFor(by ?? ROLES.trader);
  return wallet.writeContract({
    address: curve,
    abi: bondingCurveAbi,
    functionName: "graduate",
    args: [],
  });
}

/** Permissionless LP-fee sweep (COLLECT-1). */
export async function collectOnChain(tokenId: bigint, by?: DevAccount): Promise<Hash> {
  const wallet = walletFor(by ?? ROLES.trader);
  const { lpFeeVault } = loadDeployedAddresses();
  return wallet.writeContract({
    address: lpFeeVault,
    abi: lpFeeVaultAbi,
    functionName: "collect",
    args: [tokenId],
  });
}

/**
 * Granular pause flags live on the CurveFactory (owner-only, §6.5). The owner on
 * the fork is the deployer (anvil account #0 = ROLES.creator). Sells NEVER read
 * these — ERR-4 proves a sell still works with buys paused.
 */
export async function setPauseBuys(paused: boolean, owner?: DevAccount): Promise<Hash> {
  const wallet = walletFor(owner ?? ROLES.creator);
  const { curveFactory } = loadDeployedAddresses();
  return wallet.writeContract({
    address: curveFactory,
    abi: curveFactoryAbi,
    functionName: "setPauseBuys",
    args: [paused],
  });
}
export async function setPauseCreates(paused: boolean, owner?: DevAccount): Promise<Hash> {
  const wallet = walletFor(owner ?? ROLES.creator);
  const { curveFactory } = loadDeployedAddresses();
  return wallet.writeContract({
    address: curveFactory,
    abi: curveFactoryAbi,
    functionName: "setPauseCreates",
    args: [paused],
  });
}

/**
 * ERR-5 (§12.25): make the treasury a REVERTING sink via `anvil_setCode`, to
 * prove the pull-payment fee accrual keeps sells alive even with a hostile Safe.
 * No contract change — a pure fork manipulation (the harness owns this).
 */
export async function makeTreasuryRevert(): Promise<void> {
  const { treasury } = loadDeployedAddresses();
  // Minimal runtime that reverts on any call / value receipt: PUSH1 0 DUP1 REVERT.
  await testClient.setCode({ address: treasury, bytecode: "0x60006000fd" });
}

/**
 * Restore the treasury to a plain EOA (empty code) after ERR-5 — otherwise the
 * reverting bytecode persists and every later `createToken` (which pays the
 * deploy fee to the treasury) reverts with EthTransferFailed. MUST run even if
 * ERR-5 fails mid-test.
 */
export async function restoreTreasury(): Promise<void> {
  const { treasury } = loadDeployedAddresses();
  await testClient.setCode({ address: treasury, bytecode: "0x" });
}

export { parseEther };
