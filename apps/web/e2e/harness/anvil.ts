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
  graduatedEvent,
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
  erc721Abi,
  parseEventLogs,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { KEEPER_ADDRESS, ROLES, STACK, type DevAccount } from "./config";

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
  migrator: Address;
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
    migrator: need("MIGRATOR_ADDRESS") as Address,
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

/**
 * Neutralize any inherited HOSTILE code on a well-known anvil dev account. The
 * forked Robinhood mainnet has EIP-7702 SWEEPER delegations squatting these
 * addresses (a 23-byte `0xef0100 || sweeper` designator): any ETH the account
 * RECEIVES — a curve buy REFUND, a sell's proceeds, or the graduation CALLER
 * REWARD — is force-forwarded to the squatter, draining the account to ~0. That
 * is a fork artifact, NOT a protocol issue (graduation still succeeds and the
 * reward is still PAID — the sweeper just drains it after). `anvil_setCode(addr,
 * "0x")` restores a plain EOA so the account can hold received ETH — a harness
 * fork manipulation exactly like ERR-5's hostile-treasury `setCode`, never a
 * contract change.
 */
export async function sanitizeAccount(address: Address): Promise<void> {
  const code = await publicClient.getCode({ address });
  if (code && code !== "0x") {
    await testClient.setCode({ address, bytecode: "0x" });
  }
}

/**
 * Ensure a fork account is a plain, funded EOA: first STRIP any inherited sweeper
 * delegation (see `sanitizeAccount`), then top it up to at least `minEth` ETH via
 * `anvil_setBalance`. Without the strip, a topped-up account is drained the
 * instant it next receives ETH (a near-threshold buy refund, the keeper's caller
 * reward). No-op on an already-clean, already-funded account. Used for the buyer,
 * the donor, and the compose keeper's gas in the keeper-driven flows.
 */
export async function ensureFunded(address: Address, minEth = 100): Promise<void> {
  await sanitizeAccount(address);
  const bal = await publicClient.getBalance({ address });
  if (bal < parseEther(String(minEth))) {
    await testClient.setBalance({ address, value: parseEther("10000") });
  }
}

/**
 * Temporarily STARVE the compose keeper of gas so it cannot fire `graduate()` —
 * used by ERR-7 to hold a curve in the deterministic ReadyToGraduate lock long
 * enough to assert the interstitial (the keeper otherwise clears that state
 * within ~1-2 blocks, by design). Zeroing the keeper's balance makes its
 * graduate() send fail (insufficient funds → the keeper classifies it transient
 * and backs off), so the lock persists. A harness fork manipulation (like ERR-5's
 * hostile-treasury `setCode`), scoped + always paired with `restoreKeeper` in a
 * `finally`. MUST be restored so later flows' graduations (and GRAD-AUTO) work.
 */
export async function pauseKeeper(): Promise<void> {
  await testClient.setBalance({ address: KEEPER_ADDRESS, value: 0n });
}
/** Undo `pauseKeeper`: strip any inherited sweeper + refund the keeper's gas. */
export async function restoreKeeper(): Promise<void> {
  await sanitizeAccount(KEEPER_ADDRESS);
  await testClient.setBalance({ address: KEEPER_ADDRESS, value: parseEther("10000") });
}

/** Poll on-chain `phase()` until the curve LEAVES `Trading` (ReadyToGraduate, or
 *  Graduated if the keeper already won the race) — the deterministic lock signal
 *  after a threshold-crossing buy that may still be a block or two from inclusion. */
export async function waitForCurveLocked(
  curve: Address,
  opts: { timeoutMs?: number } = {},
): Promise<CurvePhase> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  let phase: CurvePhase = "trading";
  while (Date.now() < deadline) {
    phase = await readCurvePhase(curve);
    if (phase !== "trading") return phase;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return phase;
}

// ── curve reads (on-chain ground truth) ──────────────────────────────────────
// (, 2026-07-13: the token-detail SafetyStrip that rendered these live is
// DELETED; these reads remain the harness's on-chain truth source for the trade
// and graduation flows, no longer a UI mirror.)

export async function readReserves(curve: Address): Promise<{
  virtualEth: bigint;
  realEth: bigint;
}> {
  const res = (await publicClient.readContract({
    address: curve,
    abi: bondingCurveAbi,
    functionName: "reserves",
  })) as readonly bigint[];
  // `reserves()` → (virtualEth, virtualToken, realEth, realToken, …); we expose
  // the ETH legs as the on-chain truth for reserve/graduation assertions.
  return { virtualEth: res[0]!, realEth: res[2]! };
}

/**
 * LIVE graduation threshold from the DEPLOYED curve — `BondingCurve.GRADUATION_ETH()`
 *. ALWAYS read on-chain, never the static M0 notebook: the target moved
 * 8.076869 → 7.916610 ETH and the `constants.fork.json` fixture can lag whatever
 * the deploy actually baked in. Reads the same immutable getter the frontend's
 * live curve reads use (`entities/curve/model/reads.ts`). This is the
 * authoritative source for "how much ETH graduates this curve".
 */
export async function readGraduationEth(curve: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: curve,
    abi: bondingCurveAbi,
    functionName: "GRADUATION_ETH",
  })) as bigint;
}

/**
 * On-chain curve `phase()` (IBondingCurve.Phase uint8): 0 Trading, 1
 * ReadyToGraduate, 2 Graduated (mirrors the keeper's `decodePhase`, apps/keeper/
 * src/chain.ts). The ground truth for the deterministic ReadyToGraduate lock
 * — asserted directly rather than inferring the lock from reserves, and
 * KEEPER-SAFE: a spec reads this before ever buying so it never sends a trade
 * against a curve the compose keeper already graduated.
 */
export type CurvePhase = "trading" | "ready" | "graduated" | "unknown";
export async function readCurvePhase(curve: Address): Promise<CurvePhase> {
  const raw = (await publicClient.readContract({
    address: curve,
    abi: bondingCurveAbi,
    functionName: "phase",
  })) as number | bigint;
  switch (Number(raw)) {
    case 0:
      return "trading";
    case 1:
      return "ready";
    case 2:
      return "graduated";
    default:
      return "unknown";
  }
}

/**
 * The two unswept in-contract fee escrows the curve retains AFTER graduation
 * (treasury leg + creator leg). `graduate()` sends the curve's
 * whole ETH balance MINUS these to the migrator, so post-graduation the curve
 * holds EXACTLY `accruedFees + accruedCreatorFees` — the "post-grad curve holds
 * zero value (unswept fees excluded)" invariant. A stranded donation would push
 * the balance ABOVE this sum; the F-1 regression (TD-6b) asserts it does NOT.
 */
export async function readAccruedFees(curve: Address): Promise<{
  accruedFees: bigint;
  accruedCreatorFees: bigint;
  total: bigint;
}> {
  const [accruedFees, accruedCreatorFees] = (await Promise.all([
    publicClient.readContract({
      address: curve,
      abi: bondingCurveAbi,
      functionName: "accruedFees",
    }),
    publicClient.readContract({
      address: curve,
      abi: bondingCurveAbi,
      functionName: "accruedCreatorFees",
    }),
  ])) as [bigint, bigint];
  return { accruedFees, accruedCreatorFees, total: accruedFees + accruedCreatorFees };
}

/** LIVE caller reward the graduation trigger earns (`BondingCurve.CALLER_REWARD`,
 * ) — read from the deployed curve, never the notebook. */
export async function readCallerReward(curve: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: curve,
    abi: bondingCurveAbi,
    functionName: "CALLER_REWARD",
  })) as bigint;
}

/** LIVE per-tx anti-sniper cap (`BondingCurve.MAX_EARLY_BUY`) — the widget
 *  disables a buy above this WHILE it believes the token is in its early window
 *  (a wall-clock check vs the warp-inflated chain `createdAt`), so a UI crossing
 *  buy must stay under it. Read live, never the notebook. */
export async function readMaxEarlyBuy(curve: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: curve,
    abi: bondingCurveAbi,
    functionName: "MAX_EARLY_BUY",
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
  const account = (args.creator ?? ROLES.creator).address;
  const txHash = await wallet.writeContract({
    address: router,
    abi: routerAbi,
    functionName: "createToken",
    args: [args.name, args.symbol, args.metadataHash, args.metadataUri, 0n, deadline],
    value,
    nonce: await publicClient.getTransactionCount({ address: account, blockTag: "pending" }),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const [created] = parseEventLogs({
    abi: curveFactoryAbi,
    eventName: "TokenCreated",
    logs: receipt.logs,
  });
  if (!created) throw new Error("[e2e seed] createToken receipt did not include TokenCreated");
  const { token, curve } = created.args;
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

/**
 * Send a raw ETH VALUE transfer to the curve address — the curve's ungated
 * `receive()` (BondingCurve.sol) accepts it. The donation is NEVER credited
 * to reserves; at graduation it flows into the migrator and — with the F-1 fix —
 * surfaces as WETH dust to the treasury rather than pairing into the LP (which
 * pre-fix demanded an unachievable WETH deposit and FROZE graduation once
 * `donation > ~1% of GRADUATION_ETH`). A harness-side fork manipulation (a plain
 * `sendTransaction`), never a contract change — used by the TD-6b F-1 regression.
 */
export async function donateToCurveOnChain(
  curve: Address,
  weiValue: bigint,
  by?: DevAccount,
): Promise<Hash> {
  const wallet = walletFor(by ?? ROLES.trader2);
  return wallet.sendTransaction({ to: curve, value: weiValue });
}

export interface GraduatedLog {
  args: {
    token: Address;
    pool: Address;
    tokenId: bigint;
    liquidity: bigint;
    wethInPosition: bigint;
    tokensInPosition: bigint;
    graduationFee: bigint;
    caller: Address;
    callerReward: bigint;
    tokensBurned: bigint;
    wethDustToTreasury: bigint;
  };
  txHash: Hash;
  blockNumber: bigint;
}

/**
 * The single-fire `Graduated` event for a token — its canonical home is the
 * V3Migrator (contracts.md), and `token` is indexed, so it is recoverable
 * over `getContractEvents` regardless of WHO called `graduate()` (the compose
 * keeper OR a manual trigger). Returns null until graduation has happened.
 */
export async function readGraduatedEvent(token: Address): Promise<GraduatedLog | null> {
  const { migrator, startBlock } = loadDeployedAddresses();
  const logs = await publicClient.getContractEvents({
    address: migrator,
    abi: [graduatedEvent],
    eventName: "Graduated",
    args: { token },
    fromBlock: startBlock,
    toBlock: "latest",
  });
  const log = logs.at(-1);
  if (!log) return null;
  return {
    args: log.args as GraduatedLog["args"],
    txHash: log.transactionHash!,
    blockNumber: log.blockNumber!,
  };
}

/**
 * The owner of an LP-position NFT — reads the NonfungiblePositionManager address
 * from the deployed `LPFeeVault.positionManager()` (no hardcoded address) and
 * queries the frozen ERC-721 standard `ownerOf` (viem's canonical `erc721Abi`,
 * not a hand-written ABI). At graduation the migrator mints the position to the
 * LPFeeVault, permanently locking the principal — TD-6b/GRAD-AUTO
 * assert `ownerOf(tokenId) == lpFeeVault`.
 */
export async function readLpNftOwner(tokenId: bigint): Promise<Address> {
  const { lpFeeVault } = loadDeployedAddresses();
  const positionManager = (await publicClient.readContract({
    address: lpFeeVault,
    abi: lpFeeVaultAbi,
    functionName: "positionManager",
  })) as Address;
  return (await publicClient.readContract({
    address: positionManager,
    abi: erc721Abi,
    functionName: "ownerOf",
    args: [tokenId],
  })) as Address;
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
 * Granular pause flags live on the CurveFactory (owner-only). The owner on
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
 * ERR-5 : make the treasury a REVERTING sink via `anvil_setCode`, to
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

/**
 * Make an ARBITRARY address a hostile, reverting sink via `anvil_setCode` — the
 * generic form of `makeTreasuryRevert`, used by CFEE-3 to turn a registered token
 * CREATOR into a reverting contract AFTER graduation. This proves the /
 * pull-payment isolation: `collect()` (which PUSHES the creator share to
 * our non-reverting `CreatorVault`, never to the creator EOA) and post-grad V3
 * trades still succeed; only the creator's OWN `claim()` reverts (retriable once
 * the code is cleared). A pure fork manipulation (like ERR-5's), never a contract
 * change — ALWAYS paired with `sanitizeAccount(address)` in a `finally`/`afterEach`
 * so the reverting code can't wedge later flows.
 */
export async function makeAddressRevert(address: Address): Promise<void> {
  // Minimal runtime that reverts on any call / value receipt: PUSH1 0 DUP1 REVERT.
  await testClient.setCode({ address, bytecode: "0x60006000fd" });
}

export { parseEther };
