/**
 * ── treasury 2-of-4 Safe harness (TREAS-1) ───────────────────────────────────
 * Wires a canonical Gnosis Safe v1.4.1 (2-of-4) as the protocol treasury ON THE
 * FORK and drives a real 2-of-4 `execTransaction` withdrawal of the treasury's
 * collected fee share back OUT to a recipient.
 *
 * ── Why a fork MANIPULATION, not a re-deploy (recorded decision) ──────────────
 * `LPFeeVault.treasury` is an IMMUTABLE constructor value (baked into the
 * deployed bytecode, not storage), so a Safe must be the treasury BEFORE the
 * contracts deploy — you cannot re-point a live LPFeeVault at a new Safe address.
 * The production/mainnet path for this is already implemented + proven in
 * `tools/deploy`: `create-safe.ts` mints the canonical 2-of-4 Safe, the deploy
 * reads `external.treasurySafe` from the constants, and `safe-drill.ts` rehearses
 * the whole create → deploy(treasurySafe=Safe) → 2-of-4 exec ceremony on a fork.
 *
 * The dev stack this suite points at, however, is ALREADY deployed with an EOA
 * treasury (anvil #1) — and re-running `Deploy.s.sol` against the SHARED fork
 * would clobber `contracts/deployments/4663.json` (the registry the running
 * indexer/web/keeper depend on). So instead of touching the shared deploy, this
 * helper makes the deployed contracts' FIXED (immutable) treasury address HOST a
 * byte-identical canonical Safe v1.4.1 via a pure anvil manipulation — exactly
 * the mechanism `anvil.ts::makeTreasuryRevert` uses for ERR-5 (`setCode` on the
 * treasury), only here the installed code is a REAL 2-of-4 Safe rather than a
 * reverting stub. The immutable treasury ADDRESS never changes; we just deploy a
 * canonical Safe onto it. Never a `contracts/src` change.
 *
 * Install mechanic (layout-agnostic, so it can't drift with the Safe storage
 * layout): deploy a template Safe via the canonical SafeProxyFactory to obtain
 * the exact SafeProxy runtime + confirm the singleton → `setCode(treasury,
 * runtime)` → `setStorageAt(treasury, slot0 = singleton)` (SafeProxy reads
 * `sload(0)` at runtime to know where to delegatecall) → call the REAL
 * `Safe.setup(owners, 2, …)` through the proxy, which writes the owners linked
 * list / threshold / nonce via the canonical Safe code itself. Verified live:
 * `VERSION()=="1.4.1"`, `getThreshold()==2`, `getOwners().length==4`.
 *
 * The withdrawal reuses the tools/deploy/safe-tx.ts EIP-712 primitives — the SafeTx
 * hash is cross-checked against the Safe's own `getTransactionHash()` before
 * signing, owner sigs are concatenated in the ascending order the Safe requires,
 * and the exec is simulated first so a below-threshold blob reverts BEFORE spending
 * gas (the negative case). Those primitives (`computeSafeTxHash`/`signSafeTxHash`/
 * `orderSignatures`/`sendExecTransaction`) are MIRRORED VERBATIM below rather than
 * imported: `tools/deploy/safe-tx.ts` resolves viem via `createRequire` for the
 * bun-only tools/ context (tools/ is not a pnpm workspace member), so a static
 * import pulls it into apps/web's strict `tsc` program where viem is unresolvable —
 * the harness therefore carries a byte-identical copy of the exact canonical EIP-712
 * encoding (validated: the local SafeTx hash equals the Safe's on-chain
 * `getTransactionHash()` — asserted in `signAndAssembleSafeTx`). The tools-side
 * `safe-drill.ts` (a bun script) still imports the real primitives directly.
 *
 * ── Address/key provenance ────────────────────────────────────────────────────
 * The four Safe owners are genuine anvil dev accounts #5–#8 — DELIBERATELY
 * outside the e2e trade roles 0–3 (creator/treasury/trader/trader2) and the
 * keeper #4, so a Safe owner never contends for nonces with a harness signer and
 * never equals the treasury (Safe `setup` rejects an owner == the Safe itself).
 * They are pure off-chain SIGNERS (they never originate a tx, so EIP-3607 is
 * irrelevant); any funded EOA executes the assembled blob. The canonical Safe
 * v1.4.1 addresses mirror `tools/deploy/create-safe.ts` (safe-deployments
 * "canonical", live on 4663). Every literal here sits under `apps/web/e2e/**`,
 * which the M3-9 copy-lint `walk()` skips — the well-known public anvil keys +
 * canonical Safe addresses do NOT trip the address/secret grep.
 */
import { lpFeeVaultAbi } from "@robbed/shared/abi";
import {
  type Address,
  type Hash,
  type Hex,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  hashTypedData,
  pad,
  parseAbi,
  parseEventLogs,
  recoverAddress,
  size,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";

import { loadDeployedAddresses, publicClient, testClient, walletFor } from "./anvil";
import { ROLES, type DevAccount } from "./config";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

// ── canonical Safe v1.4.1 EIP-712 SafeTx primitives (VERBATIM mirror of
// tools/deploy/safe-tx.ts — see the file header for why they're copied, not
// imported). operation is always 0 = CALL; the gas-refund params are all neutral. ─

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface SafeTx {
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: Address;
  refundReceiver: Address;
  nonce: bigint;
}

export interface SafeSignature {
  signer: Address;
  signature: Hex; // standard 65-byte {r}{s}{v}, v ∈ {27,28}
}

/** EIP-712 SafeTx digest (domain = {chainId, verifyingContract: safe}). */
function computeSafeTxHash(chainId: number, safe: Address, tx: SafeTx): Hex {
  return hashTypedData({
    domain: { chainId, verifyingContract: safe },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx",
    message: {
      to: tx.to,
      value: tx.value,
      data: tx.data,
      operation: tx.operation,
      safeTxGas: tx.safeTxGas,
      baseGas: tx.baseGas,
      gasPrice: tx.gasPrice,
      gasToken: tx.gasToken,
      refundReceiver: tx.refundReceiver,
      nonce: tx.nonce,
    },
  });
}

/** Sign the 32-byte SafeTx digest directly → standard 65-byte ECDSA sig (v∈{27,28}). */
function signSafeTxHash(hash: Hex, privateKey: Hex): Promise<Hex> {
  return sign({ hash, privateKey, to: "hex" });
}

/** Normalise a 65-byte ECDSA sig's `v` to {27,28} for the Safe's EIP-712 path. */
function normalizeEcdsaV(signature: Hex): Hex {
  if (size(signature) !== 65) throw new Error(`signature is ${size(signature)} bytes, expected 65`);
  const v = parseInt(signature.slice(130, 132), 16);
  if (v === 0 || v === 1) {
    return (signature.slice(0, 130) + (v + 27).toString(16).padStart(2, "0")) as Hex;
  }
  return signature;
}

/**
 * Validate each sig recovers to its declared signer, order them, concat into the
 * blob execTransaction consumes. `ascending` is the ONLY order the Safe accepts;
 * `none` preserves input order (the single-signature negative). Threshold is NOT
 * enforced here — that is the on-chain contract's job (what the negative exercises).
 */
async function orderSignatures(
  hash: Hex,
  sigs: SafeSignature[],
  order: "ascending" | "none" = "ascending",
): Promise<{ blob: Hex; signers: Address[] }> {
  const resolved: { signer: Address; signature: Hex }[] = [];
  for (const s of sigs) {
    const signature = normalizeEcdsaV(s.signature);
    const recovered = getAddress(await recoverAddress({ hash, signature }));
    if (recovered !== getAddress(s.signer)) {
      throw new Error(`signature does not match declared signer: recovered ${recovered}, declared ${s.signer}`);
    }
    resolved.push({ signer: recovered, signature });
  }
  if (order === "ascending") {
    resolved.sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : BigInt(a.signer) > BigInt(b.signer) ? 1 : 0));
  }
  const blob = ("0x" + resolved.map((r) => r.signature.slice(2)).join("")) as Hex;
  return { blob, signers: resolved.map((r) => r.signer) };
}

// The Safe execTransaction ABI fragment used by the sender below.
const safeExecAbi = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
  "event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash, uint256 payment)",
]);

/**
 * Send execTransaction with a pre-assembled signature blob and assert
 * `ExecutionSuccess`. Simulates FIRST so a bad/below-threshold blob reverts (and
 * throws) BEFORE any gas is spent — which is exactly what the negative case asserts.
 */
async function sendExecTransaction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pub: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wallet: any,
  safe: Address,
  tx: SafeTx,
  sigBlob: Hex,
): Promise<{ txHash: Hash; executionSuccess: boolean }> {
  const args = [
    tx.to,
    tx.value,
    tx.data,
    tx.operation,
    tx.safeTxGas,
    tx.baseGas,
    tx.gasPrice,
    tx.gasToken,
    tx.refundReceiver,
    sigBlob,
  ] as const;
  const { request } = await pub.simulateContract({
    account: wallet.account,
    address: safe,
    abi: safeExecAbi,
    functionName: "execTransaction",
    args,
  });
  const txHash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`execTransaction reverted (tx ${txHash})`);
  const failure = parseEventLogs({ abi: safeExecAbi, eventName: "ExecutionFailure", logs: receipt.logs });
  if (failure.length > 0) throw new Error(`Safe emitted ExecutionFailure (tx ${txHash}) — inner call reverted`);
  const success = parseEventLogs({ abi: safeExecAbi, eventName: "ExecutionSuccess", logs: receipt.logs });
  if (success.length === 0) throw new Error(`no ExecutionSuccess event in receipt (tx ${txHash})`);
  return { txHash, executionSuccess: true };
}

/** Canonical Safe v1.4.1 set (safe-deployments "canonical"; live on 4663 —
 *  mirrors tools/deploy/create-safe.ts, re-verified present on the fork). */
export const CANONICAL_SAFE = {
  proxyFactory: getAddress("0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"),
  singleton: getAddress("0x29fcB43b46531BcA003ddC8FCB67FFE91900C762"),
  fallbackHandler: getAddress("0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99"),
} as const;

/** The four treasury-Safe owner signers — anvil dev accounts #5–#8 (public
 *  well-known keys; outside e2e roles 0–3 + keeper #4). Threshold is 2. */
export const TREASURY_SAFE_OWNERS: DevAccount[] = [
  { address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", privateKey: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" }, // #5
  { address: "0x976EA74026E726554dB657fA54763abd0C3a0aa9", privateKey: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" }, // #6
  { address: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955", privateKey: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" }, // #7
  { address: "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f", privateKey: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97" }, // #8
];
export const TREASURY_SAFE_THRESHOLD = 2n;

// ── canonical Safe / proxy ABIs (EXTERNAL contracts — same fragments as
// tools/deploy/{create-safe,safe-tx}.ts; not a @robbed protocol shape, like
// viem's erc721Abi in anvil.ts. `erc20Abi` for the WETH/token transfer is viem's
// canonical standard ABI). ────────────────────────────────────────────────────
const safeProxyFactoryAbi = parseAbi([
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy, address singleton)",
]);
const safeAbi = parseAbi([
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function isOwner(address owner) view returns (bool)",
]);

/** The immutable treasury address baked into the deployed LPFeeVault — read LIVE
 *  (never assume anvil #1). This is the fixed address we install the Safe onto. */
export async function readLpFeeVaultTreasury(): Promise<Address> {
  const { lpFeeVault } = loadDeployedAddresses();
  return getAddress(
    (await publicClient.readContract({
      address: lpFeeVault,
      abi: lpFeeVaultAbi,
      functionName: "treasury",
    })) as Address,
  );
}

export interface SafeMeta {
  version: string;
  threshold: bigint;
  owners: Address[];
  nonce: bigint;
}

/** Read a Safe's on-chain metadata (also the "is this a valid 2-of-4 Safe?" probe). */
export async function readSafeMeta(safe: Address): Promise<SafeMeta | null> {
  const code = await publicClient.getCode({ address: safe });
  if (!code || code === "0x") return null;
  try {
    const [version, threshold, owners, nonce] = await Promise.all([
      publicClient.readContract({ address: safe, abi: safeAbi, functionName: "VERSION" }),
      publicClient.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }),
      publicClient.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
      publicClient.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
    ]);
    return {
      version: version as string,
      threshold: threshold as bigint,
      owners: (owners as Address[]).map((o) => getAddress(o)),
      nonce: nonce as bigint,
    };
  } catch {
    // Has code but isn't a Safe (e.g. ERR-5's reverting stub, or an EOA-with-7702).
    return null;
  }
}

/** True iff `safe` is a canonical v1.4.1 Safe with our exact 2-of-4 owner set. */
function isOurTreasurySafe(meta: SafeMeta | null): boolean {
  if (!meta) return false;
  if (meta.version !== "1.4.1" || meta.threshold !== TREASURY_SAFE_THRESHOLD) return false;
  const want = new Set(TREASURY_SAFE_OWNERS.map((o) => getAddress(o.address).toLowerCase()));
  return (
    meta.owners.length === want.size && meta.owners.every((o) => want.has(o.toLowerCase()))
  );
}

/**
 * Install a canonical 2-of-4 Safe v1.4.1 at `treasury` (the immutable LPFeeVault
 * treasury address) via the fork manipulation described in the file header.
 * IDEMPOTENT + RE-RUN-SAFE against the shared fork: `seedToken`'s
 * `sanitizeDevAccounts` wipes the treasury CODE (not its storage) at the top of
 * every run, so a re-run finds the treasury with wiped code but INTACT Safe
 * storage (`threshold==2` etc. from the prior install). We therefore restore the
 * proxy code + slot0 and only call the one-shot `Safe.setup()` when the storage is
 * genuinely FRESH (`threshold==0`) — re-running `setup()` on already-initialised
 * storage would revert `GS200`. Returns the live Safe metadata. Deployer/executor
 * is anvil #0 (ROLES.creator).
 */
export async function installTreasurySafe(treasury: Address): Promise<SafeMeta> {
  // Fast path: already a live Safe (code + storage both intact).
  const existing = await readSafeMeta(treasury);
  if (isOurTreasurySafe(existing)) return existing!;

  const owners = TREASURY_SAFE_OWNERS.map((o) => getAddress(o.address));
  const deployer = walletFor(ROLES.creator);
  const initializer = encodeFunctionData({
    abi: safeAbi,
    functionName: "setup",
    args: [owners, TREASURY_SAFE_THRESHOLD, ZERO, "0x", CANONICAL_SAFE.fallbackHandler, ZERO, 0n, ZERO],
  });

  // 1) deploy a TEMPLATE Safe via the canonical factory to grab the exact
  //    SafeProxy runtime (+ confirm the singleton) — never a hardcoded runtime.
  const salt = BigInt(Date.now());
  const { request } = await publicClient.simulateContract({
    account: privateKeyToAccount(ROLES.creator.privateKey),
    address: CANONICAL_SAFE.proxyFactory,
    abi: safeProxyFactoryAbi,
    functionName: "createProxyWithNonce",
    args: [CANONICAL_SAFE.singleton, initializer, salt],
  });
  const tplHash = await deployer.writeContract(request);
  const tplReceipt = await publicClient.waitForTransactionReceipt({ hash: tplHash });
  const [creation] = parseEventLogs({
    abi: safeProxyFactoryAbi,
    eventName: "ProxyCreation",
    logs: tplReceipt.logs,
  });
  if (!creation) throw new Error("[e2e safe] template ProxyCreation event missing");
  const template = getAddress(creation.args.proxy);
  const proxyRuntime = await publicClient.getCode({ address: template });
  if (!proxyRuntime || proxyRuntime === "0x") {
    throw new Error("[e2e safe] template Safe has no runtime code");
  }

  // 2) install the runtime at the immutable treasury address + point slot0 at the
  //    singleton (SafeProxy `sload(0)`).
  await testClient.setCode({ address: treasury, bytecode: proxyRuntime });
  await testClient.setStorageAt({
    address: treasury,
    index: "0x0",
    value: pad(CANONICAL_SAFE.singleton, { size: 32 }),
  });

  // 3) run the REAL Safe.setup() ONLY when the storage is fresh. A re-run finds the
  //    prior install's storage intact (code was wiped, storage persists), so it's
  //    already our 2-of-4 Safe the moment the code is restored — setup() would GS200.
  const afterCode = await readSafeMeta(treasury);
  if (!isOurTreasurySafe(afterCode)) {
    const setupHash = await deployer.writeContract({
      account: privateKeyToAccount(ROLES.creator.privateKey),
      address: treasury,
      abi: safeAbi,
      functionName: "setup",
      args: [owners, TREASURY_SAFE_THRESHOLD, ZERO, "0x", CANONICAL_SAFE.fallbackHandler, ZERO, 0n, ZERO],
    });
    const setupReceipt = await publicClient.waitForTransactionReceipt({ hash: setupHash });
    if (setupReceipt.status !== "success") {
      throw new Error("[e2e safe] Safe.setup() at the treasury address reverted");
    }
  }

  const meta = await readSafeMeta(treasury);
  if (!isOurTreasurySafe(meta)) {
    throw new Error(
      `[e2e safe] post-install verification failed: ${JSON.stringify({
        version: meta?.version,
        threshold: meta?.threshold?.toString(),
        owners: meta?.owners,
      })}`,
    );
  }
  return meta!;
}

/** Standard ERC20 balanceOf (viem `erc20Abi`) — used for the Safe/recipient
 *  WETH+token balance deltas the withdrawal asserts. */
export async function erc20BalanceOf(token: Address, account: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  })) as bigint;
}

/**
 * Build the SafeTx for an ERC20 transfer OUT of the Safe (the treasury withdrawal
 * payload: `to = token`, `data = transfer(recipient, amount)`, value 0). The
 * nonce defaults to the Safe's LIVE nonce (re-run-safe). The SafeTx hash is
 * cross-checked against the Safe's own `getTransactionHash()` inside
 * `signAndAssembleSafeTx`, so a viem/Solidity encoding drift fails loud.
 */
export async function buildSafeErc20TransferTx(
  safe: Address,
  token: Address,
  recipient: Address,
  amount: bigint,
  nonce?: bigint,
): Promise<SafeTx> {
  const n = nonce ?? (await readSafeMeta(safe))!.nonce;
  return {
    to: token,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }),
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZERO,
    refundReceiver: ZERO,
    nonce: n,
  };
}

/**
 * Sign a SafeTx with `signers` and assemble the execTransaction signature blob.
 * `order`:
 *   "ascending" — the ONLY order the Safe accepts (positive path).
 *   "none"      — preserve input order (the below-threshold negative case).
 * Cross-checks the local EIP-712 SafeTx hash against the Safe's on-chain
 * `getTransactionHash()` before signing (never sign a hash the Safe disagrees with).
 */
export async function signAndAssembleSafeTx(
  safe: Address,
  tx: SafeTx,
  signers: DevAccount[],
  order: "ascending" | "none" = "ascending",
): Promise<Hex> {
  const localHash = computeSafeTxHash(4663, safe, tx);
  const sigs: SafeSignature[] = [];
  for (const s of signers) {
    sigs.push({ signer: getAddress(s.address), signature: await signSafeTxHash(localHash, s.privateKey) });
  }
  const { blob } = await orderSignatures(localHash, sigs, order);
  return blob;
}

export interface SafeExecOutcome {
  txHash: Hash;
  executionSuccess: boolean;
}

/**
 * Execute a fully-signed treasury withdrawal (the 2-of-4 positive path). Simulates
 * first (a bad/below-threshold blob reverts here), then sends + asserts
 * ExecutionSuccess. The submitter is any funded EOA (default ROLES.trader) — an
 * OWNER never has to originate the tx (EIP-3607-safe).
 */
export async function execSafeWithdrawal(
  safe: Address,
  tx: SafeTx,
  blob: Hex,
  executor: DevAccount = ROLES.trader,
): Promise<SafeExecOutcome> {
  const res = await sendExecTransaction(publicClient, walletFor(executor), safe, tx, blob);
  return { txHash: res.txHash, executionSuccess: res.executionSuccess };
}
