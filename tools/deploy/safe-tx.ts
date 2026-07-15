#!/usr/bin/env bun
/**
 * safe-tx.ts — `bun run safe:tx <hash|sign|exec>` (O-6 Phase 1: treasury Safe
 * execution tooling). Owner: robbed-contracts (tooling only — touches no
 * contracts/src, no apps).
 *
 * The companion to create-safe.ts: once the 2-of-4 treasury Safe (,
 * O-6) exists, THIS is how signed transactions are built, co-signed on separate
 * machines, and executed. Used for the mainnet ownership handoff (the Safe
 * `acceptOwnership()`s the Ownable2Step CurveFactory, step 7) and any
 * later treasury movement. It uses ONLY the canonical Safe v1.4.1 on-chain
 * primitives (`getTransactionHash` / `execTransaction`) — never a bespoke
 * multisig, never the hosted Safe Transaction Service.
 *
 * ── Why hand-rolled over @safe-global/protocol-kit (recorded decision) ────────
 * Options weighed: (a) protocol-kit + the hosted tx-service relayer, (b) a thin
 * local builder over the raw v1.4.1 contract ABI. CHOSEN (b): the tx-service is
 * not deployed for chain 4663, and O-6's whole point is a self-custodied,
 * dependency-light path that works offline on an air-gapped signer. The one
 * correctness risk of hand-rolling the EIP-712 encoding is neutralised by
 * CROSS-CHECKING our locally-computed SafeTx hash against the Safe's own
 * `getTransactionHash()` on chain before anyone signs (`hash` subcommand) — the
 * contract is the arbiter, so a viem-vs-Solidity encoding drift fails loud
 * instead of producing an unusable signature.
 *
 * ── EIP-712 shape (Safe v1.4.1, verified 2026-07-13 against tag v1.4.1
 *    contracts/Safe.sol) ──────────────────────────────────────────────────────
 *   domain  = EIP712Domain(uint256 chainId,address verifyingContract)
 *             chainId = live chain, verifyingContract = the Safe proxy.
 *   struct  = SafeTx(address to,uint256 value,bytes data,uint8 operation,
 *             uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,
 *             address gasToken,address refundReceiver,uint256 nonce)
 *   digest  = keccak256(0x19 ‖ 0x01 ‖ domainSeparator ‖ hashStruct(SafeTx))
 * We always send a plain CALL (operation=0), zero gas-refund params
 * (safeTxGas/baseGas/gasPrice/gasToken/refundReceiver all 0) — the Safe pays no
 * relayer and self-executes, so the refund machinery is unused and left neutral.
 *
 * ── Signature encoding (Safe v1.4.1; docs.safe.global smart-account-signatures,
 *    verified 2026-07-13) ──────────────────────────────────────────────────────
 * An ECDSA owner signature is the standard 65 bytes {r(32)}{s(32)}{v(1)} with
 * v ∈ {27,28}. Signing the 32-byte SafeTx digest directly (raw-hash ECDSA) is
 * byte-identical to what a hardware wallet's `eth_signTypedData_v4` returns for
 * this typed data, so `exec` accepts ANY standard 65-byte sig regardless of
 * origin (raw key here, or Ledger/Trezor/Frame elsewhere). execTransaction
 * REQUIRES the concatenated owner signatures to be **sorted by ascending signer
 * address** (Safe checks each recovered signer strictly increases); we enforce
 * that in `orderSignatures`.
 *
 * ── Subcommands ───────────────────────────────────────────────────────────────
 *   hash   Build the SafeTx, compute the EIP-712 digest, CROSS-CHECK it against
 *          Safe.getTransactionHash(), write a tx JSON for the signers.
 *   sign   Load a tx JSON, re-derive + re-verify the digest, sign it with
 *          SIGNER_PRIVATE_KEY, write a signature JSON (one per signer/machine).
 *   exec   Load a tx JSON + ≥2 signature JSONs, validate/sort them, assert the
 *          Safe nonce is still current, execTransaction, assert ExecutionSuccess.
 *
 * Payload presets (what the tx CALLS):
 *   --preset accept-ownership --target <addr>   → acceptOwnership() (Ownable2Step)
 *   --preset transfer-eth     --to <addr> --value <wei>  → bare ETH send
 *   (raw)  --to <addr> [--value <wei>] [--data 0x..]     → arbitrary call
 *
 * Chain guard: refuses any chainid ∉ {4663, 46630, 31337} — mirrors
 * create-safe.ts; the guard is deliberate and not flag-bypassable.
 *
 * Keys are ENV-ONLY (never argv, so they never land in `ps`): SIGNER_PRIVATE_KEY
 * for `sign`, EXECUTOR_PRIVATE_KEY for `exec`.
 *
 * Module resolution mirrors create-safe.ts / seed-chain.ts: tools/ is not a pnpm
 * workspace member, so `createRequire` anchored at packages/shared resolves the
 * exact catalog-pinned viem (2.55.0).
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

// ── viem via packages/shared's resolution (see header) ───────────────────────
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
  hashTypedData,
  http,
  isHex,
  parseAbi,
  parseEventLogs,
  recoverAddress,
  size,
} = viem;
const { privateKeyToAccount, sign } = viemAccounts;

type Address = `0x${string}`;
type Hex = `0x${string}`;

const ALLOWED_CHAIN_IDS = new Set<number>([4663, 46630, 31337]);
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

// ── canonical Safe v1.4.1 ABI (verified against the tagged source) ───────────
const safeAbi = parseAbi([
  "function nonce() view returns (uint256)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function isOwner(address owner) view returns (bool)",
  "function VERSION() view returns (string)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
  "event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash, uint256 payment)",
]);
const ownable2StepAbi = parseAbi([
  "function acceptOwnership()",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
]);

// EIP-712 SafeTx types (v1.4.1) — mirrored exactly for viem's hashTypedData.
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

// A fully-resolved Safe transaction (operation is always 0 = CALL here).
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

/** A signature as exchanged between signers (one JSON file per machine). */
export interface SafeSignature {
  signer: Address;
  signature: Hex; // standard 65-byte {r}{s}{v}, v ∈ {27,28}
}

// ── pure EIP-712 helpers (exported so the fork drill reuses the same bytes) ──
export function computeSafeTxHash(chainId: number, safe: Address, tx: SafeTx): Hex {
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

/** Sign the 32-byte SafeTx digest directly → standard 65-byte ECDSA sig. */
export async function signSafeTxHash(hash: Hex, privateKey: Hex): Promise<Hex> {
  return sign({ hash, privateKey, to: "hex" });
}

export async function recoverSigner(hash: Hex, signature: Hex): Promise<Address> {
  return getAddress(await recoverAddress({ hash, signature }));
}

/**
 * Normalise a 65-byte ECDSA sig's `v` to {27,28} for the Safe's EIP-712 path.
 * Some signers (Frame, some Ledger flows, ethers' raw split) encode `v` as
 * yParity {0,1}; the Safe reads a trailing byte of 0/1 as a CONTRACT/approved-
 * hash signature type, NOT an ECDSA recovery id — so an un-normalised sig would
 * be misinterpreted and revert. viem's `sign` already emits 27/28; this makes
 * `exec` robust to externally-produced (hardware) sigs too. Values >28 (e.g. an
 * eth_sign sig, v=31/32) are left untouched: our raw-digest recovery check
 * rejects those anyway, since we only support the EIP-712 typed-data path.
 */
function normalizeEcdsaV(signature: Hex): Hex {
  if (size(signature) !== 65) throw new Error(`signature is ${size(signature)} bytes, expected 65`);
  const v = parseInt(signature.slice(130, 132), 16);
  if (v === 0 || v === 1) {
    return (signature.slice(0, 130) + (v + 27).toString(16).padStart(2, "0")) as Hex;
  }
  return signature;
}

/**
 * Validate each signature recovers to its declared signer over `hash`, order
 * them, and concatenate into the blob execTransaction consumes.
 *
 * `order`:
 *   "ascending"  — the ONLY order the Safe accepts (default; production path).
 *   "descending" — used ONLY by the negative fork-drill case to prove the Safe
 *                  rejects mis-ordered signatures.
 *   "none"       — preserve input order (used by the single-signature negative).
 * Threshold/ownership are NOT enforced here — that is the on-chain contract's
 * job (and what the negative cases exercise); `exec` layers a fail-closed
 * client-side threshold check on top.
 */
export async function orderSignatures(
  hash: Hex,
  sigs: SafeSignature[],
  order: "ascending" | "descending" | "none" = "ascending",
): Promise<{ blob: Hex; signers: Address[] }> {
  const resolved: { signer: Address; signature: Hex }[] = [];
  for (const s of sigs) {
    const signature = normalizeEcdsaV(s.signature); // {0,1} → {27,28} for the Safe
    const recovered = await recoverSigner(hash, signature);
    if (recovered !== getAddress(s.signer)) {
      throw new Error(
        `signature does not match declared signer: recovered ${recovered}, declared ${s.signer}`,
      );
    }
    resolved.push({ signer: recovered, signature });
  }
  if (order !== "none") {
    resolved.sort((a, b) => {
      const cmp = BigInt(a.signer) < BigInt(b.signer) ? -1 : BigInt(a.signer) > BigInt(b.signer) ? 1 : 0;
      return order === "ascending" ? cmp : -cmp;
    });
  }
  const blob = ("0x" + resolved.map((r) => r.signature.slice(2)).join("")) as Hex;
  return { blob, signers: resolved.map((r) => r.signer) };
}

export interface ExecResult {
  txHash: Hex;
  blockNumber: bigint;
  executionSuccess: boolean;
  payment: bigint;
}

/**
 * Send execTransaction with a pre-assembled signature blob and assert the
 * `ExecutionSuccess` event fired. Throws (surfacing the revert) when the Safe
 * rejects the call — which is exactly what the negative drill cases assert.
 */
export async function sendExecTransaction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pub: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wallet: any,
  safe: Address,
  tx: SafeTx,
  sigBlob: Hex,
): Promise<ExecResult> {
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
  // simulate first: a bad-signature / below-threshold call reverts here and
  // throws BEFORE we spend gas (the negative cases catch this throw).
  const { request } = await pub.simulateContract({
    account: wallet.account,
    address: safe,
    abi: safeAbi,
    functionName: "execTransaction",
    args,
  });
  const txHash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`execTransaction reverted (tx ${txHash})`);
  }
  const success = parseEventLogs({ abi: safeAbi, eventName: "ExecutionSuccess", logs: receipt.logs });
  const failure = parseEventLogs({ abi: safeAbi, eventName: "ExecutionFailure", logs: receipt.logs });
  if (failure.length > 0) {
    // outer call succeeded but the INNER Safe call failed (ExecutionFailure).
    throw new Error(
      `Safe emitted ExecutionFailure (tx ${txHash}) — the inner call reverted; ` +
        `the treasury operation did NOT take effect`,
    );
  }
  if (success.length === 0) {
    throw new Error(`no ExecutionSuccess event in receipt (tx ${txHash})`);
  }
  return {
    txHash,
    blockNumber: receipt.blockNumber,
    executionSuccess: true,
    payment: success[0]!.args.payment,
  };
}

// ─────────────────────────────── CLI plumbing ───────────────────────────────
const die = (msg: string): never => {
  console.error(`[safe:tx] ERROR: ${msg}`);
  process.exit(1);
};
const log = (msg: string) => console.log(`[safe:tx] ${msg}`);

function cliFlag(name: string): string | undefined {
  const argv = process.argv.slice(3); // slice(2) is the subcommand
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith("--")) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.slice(name.length + 3);
}
function cliFlagAll(name: string): string[] {
  const argv = process.argv.slice(3);
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1] && !argv[i + 1]!.startsWith("--")) out.push(argv[++i]!);
    else if (argv[i]!.startsWith(`--${name}=`)) out.push(argv[i]!.slice(name.length + 3));
  }
  return out;
}
const addr = (s: string, label: string): Address => {
  try {
    return getAddress(s.trim());
  } catch {
    return die(`invalid ${label} address: ${s}`);
  }
};

async function connect() {
  const RPC_URL = cliFlag("rpc-url") ?? process.env.RPC_URL ?? "http://localhost:4545";
  const probe = createPublicClient({ transport: http(RPC_URL) });
  const chainId = await probe.getChainId();
  if (!ALLOWED_CHAIN_IDS.has(chainId)) {
    die(
      `refusing to run against chainid ${chainId} (${RPC_URL}). Sanctioned: ` +
        `4663 (Robinhood mainnet / local fork), 46630 (testnet), 31337 (anvil). ` +
        `This guard is deliberate and not flag-bypassable.`,
    );
  }
  const chain = defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
  const pub = createPublicClient({ chain, transport: http(RPC_URL) });
  return { RPC_URL, chainId, chain, pub };
}

/** Assert the Safe exists, is v1.4.1, and return its live nonce + threshold. */
async function preflightSafe(pub: ReturnType<typeof createPublicClient>, safe: Address) {
  const code = await pub.getCode({ address: safe });
  if (!code || code === "0x") die(`no contract code at Safe ${safe} on this chain`);
  const version = await pub.readContract({ address: safe, abi: safeAbi, functionName: "VERSION" });
  if (version !== "1.4.1") die(`Safe VERSION() is "${version}", expected "1.4.1" (not a canonical Safe)`);
  const [nonce, threshold, owners] = await Promise.all([
    pub.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
    pub.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }),
    pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
  ]);
  return { version, nonce, threshold, owners: owners.map((o) => getAddress(o)) };
}

// Build the SafeTx payload from the chosen preset / raw flags.
function buildPayload(): { to: Address; value: bigint; data: Hex; preset: string } {
  const preset = cliFlag("preset") ?? "raw";
  if (preset === "accept-ownership") {
    const target = addr(cliFlag("target") ?? die("--target required for accept-ownership"), "target");
    const data = encodeFunctionData({ abi: ownable2StepAbi, functionName: "acceptOwnership" });
    return { to: target, value: 0n, data, preset };
  }
  if (preset === "transfer-eth") {
    const to = addr(cliFlag("to") ?? die("--to required for transfer-eth"), "to");
    const value = BigInt(cliFlag("value") ?? die("--value required for transfer-eth (wei)"));
    return { to, value, data: "0x", preset };
  }
  // raw
  const to = addr(cliFlag("to") ?? die("--to required (or use --preset)"), "to");
  const value = BigInt(cliFlag("value") ?? "0");
  const data = (cliFlag("data") ?? "0x") as Hex;
  if (!isHex(data)) die(`--data must be 0x-hex, got ${data}`);
  return { to, value, data, preset };
}

function txToJson(safe: Address, chainId: number, tx: SafeTx, safeTxHash: Hex, preset: string): string {
  return JSON.stringify(
    {
      kind: "robbed-safe-tx",
      safe,
      chainId,
      preset,
      to: tx.to,
      value: tx.value.toString(),
      data: tx.data,
      operation: tx.operation,
      safeTxGas: tx.safeTxGas.toString(),
      baseGas: tx.baseGas.toString(),
      gasPrice: tx.gasPrice.toString(),
      gasToken: tx.gasToken,
      refundReceiver: tx.refundReceiver,
      nonce: tx.nonce.toString(),
      safeTxHash,
    },
    null,
    2,
  );
}

function jsonToTx(raw: string): { safe: Address; chainId: number; tx: SafeTx; safeTxHash: Hex; preset: string } {
  const j = JSON.parse(raw);
  if (j.kind !== "robbed-safe-tx") die(`not a robbed-safe-tx file (kind=${j.kind})`);
  if (j.operation !== 0) die(`refusing operation=${j.operation}; only CALL (0) is supported`);
  const tx: SafeTx = {
    to: getAddress(j.to),
    value: BigInt(j.value),
    data: j.data,
    operation: 0,
    safeTxGas: BigInt(j.safeTxGas),
    baseGas: BigInt(j.baseGas),
    gasPrice: BigInt(j.gasPrice),
    gasToken: getAddress(j.gasToken),
    refundReceiver: getAddress(j.refundReceiver),
    nonce: BigInt(j.nonce),
  };
  return { safe: getAddress(j.safe), chainId: Number(j.chainId), tx, safeTxHash: j.safeTxHash, preset: j.preset };
}

// ─────────────────────────────── subcommands ────────────────────────────────
async function cmdHash(): Promise<void> {
  const { chainId, pub } = await connect();
  const safe = addr(cliFlag("safe") ?? process.env.SAFE_ADDRESS ?? die("--safe (or SAFE_ADDRESS) required"), "safe");
  const meta = await preflightSafe(pub, safe);
  const { to, value, data, preset } = buildPayload();
  const nonce = cliFlag("nonce") !== undefined ? BigInt(cliFlag("nonce")!) : meta.nonce;

  const tx: SafeTx = {
    to,
    value,
    data,
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZERO,
    refundReceiver: ZERO,
    nonce,
  };
  const localHash = computeSafeTxHash(chainId, safe, tx);

  // The load-bearing correctness check: the Safe's OWN encoding must agree.
  const onchainHash = await pub.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "getTransactionHash",
    args: [to, value, data, 0, 0n, 0n, 0n, ZERO, ZERO, nonce],
  });
  if (localHash.toLowerCase() !== onchainHash.toLowerCase()) {
    die(
      `SafeTx hash MISMATCH — local ${localHash} != on-chain getTransactionHash ${onchainHash}. ` +
        `Refusing to emit a hash no signer should sign (viem/Solidity EIP-712 drift).`,
    );
  }
  log(`preset=${preset} to=${to} value=${value} nonce=${nonce} (Safe live nonce ${meta.nonce}, threshold ${meta.threshold})`);
  log(`SafeTx hash verified against on-chain getTransactionHash: ${localHash}`);

  const json = txToJson(safe, chainId, tx, localHash, preset);
  const out = cliFlag("out");
  if (out) {
    writeFileSync(out, json + "\n");
    log(`wrote tx JSON → ${out}  (distribute to signers)`);
  } else {
    console.log(json);
  }
}

async function cmdSign(): Promise<void> {
  const { chainId, pub } = await connect();
  const txFile = cliFlag("tx") ?? die("--tx <tx.json> required (produced by `safe:tx hash`)");
  const { safe, chainId: txChainId, tx, safeTxHash } = jsonToTx(readFileSync(txFile, "utf8"));
  if (txChainId !== chainId) die(`tx JSON chainId ${txChainId} != connected chain ${chainId}`);
  await preflightSafe(pub, safe);

  // Re-derive + re-verify the digest locally AND on chain before signing —
  // never sign a hash we cannot reproduce from the tx fields.
  const localHash = computeSafeTxHash(chainId, safe, tx);
  if (localHash.toLowerCase() !== safeTxHash.toLowerCase()) {
    die(`tx JSON safeTxHash ${safeTxHash} != recomputed ${localHash} — tampered/stale file`);
  }
  const onchainHash = await pub.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "getTransactionHash",
    args: [tx.to, tx.value, tx.data, 0, 0n, 0n, 0n, ZERO, ZERO, tx.nonce],
  });
  if (onchainHash.toLowerCase() !== localHash.toLowerCase()) {
    die(`on-chain getTransactionHash ${onchainHash} != tx JSON hash ${localHash} — wrong Safe/chain?`);
  }

  const providedSignature = cliFlag("signature") as Hex | undefined;
  const providedSigner = cliFlag("signer") ?? cliFlag("from");
  let signer: Address;
  let signature: Hex;

  if (providedSignature) {
    if (!providedSigner) die("--signer <address> is required with --signature");
    signature = normalizeEcdsaV(providedSignature);
    signer = addr(providedSigner, "signer");
    const recovered = await recoverSigner(localHash, signature);
    if (recovered !== signer) die(`provided signature recovers to ${recovered}, not signer ${signer}`);
  } else {
    const pk = (process.env.SIGNER_PRIVATE_KEY ??
      die("SIGNER_PRIVATE_KEY is required, or provide --signature + --signer from hardware/keystore signing")) as Hex;
    const account = privateKeyToAccount(pk);
    signature = await signSafeTxHash(localHash, pk);
    const recovered = await recoverSigner(localHash, signature);
    if (recovered !== account.address) die(`internal: recovered ${recovered} != signer ${account.address}`);
    signer = account.address;
  }

  const sigJson = JSON.stringify(
    {
      kind: "robbed-safe-signature",
      safe,
      chainId,
      nonce: tx.nonce.toString(),
      safeTxHash: localHash,
      signer,
      signature,
    },
    null,
    2,
  );
  const out = cliFlag("out");
  if (out) {
    writeFileSync(out, sigJson + "\n");
    log(`signer ${signer} → wrote signature JSON ${out}`);
  } else {
    console.log(sigJson);
  }
}

async function cmdExec(): Promise<void> {
  const { chainId, chain, pub } = await connect();
  const txFile = cliFlag("tx") ?? die("--tx <tx.json> required");
  const { safe, chainId: txChainId, tx, safeTxHash } = jsonToTx(readFileSync(txFile, "utf8"));
  if (txChainId !== chainId) die(`tx JSON chainId ${txChainId} != connected chain ${chainId}`);
  const meta = await preflightSafe(pub, safe);

  // Re-derive the digest and cross-check on chain (never trust the JSON blindly).
  const localHash = computeSafeTxHash(chainId, safe, tx);
  if (localHash.toLowerCase() !== safeTxHash.toLowerCase()) die(`tx JSON safeTxHash mismatch (tampered/stale)`);
  const onchainHash = await pub.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "getTransactionHash",
    args: [tx.to, tx.value, tx.data, 0, 0n, 0n, 0n, ZERO, ZERO, tx.nonce],
  });
  if (onchainHash.toLowerCase() !== localHash.toLowerCase()) die(`on-chain hash mismatch — wrong Safe/chain?`);

  // Stale-nonce guard: the Safe increments `nonce` on every exec; a tx built for
  // an old nonce cannot execute and must not be attempted.
  if (meta.nonce !== tx.nonce) {
    die(`Safe nonce is ${meta.nonce} but this tx targets nonce ${tx.nonce} (already executed or built ahead)`);
  }

  // Load + validate signature files.
  const sigFiles = cliFlagAll("sig");
  if (sigFiles.length === 0) die("at least one --sig <sig.json> required (need ≥ threshold)");
  const sigs: SafeSignature[] = [];
  const seen = new Set<string>();
  for (const f of sigFiles) {
    const j = JSON.parse(readFileSync(f, "utf8"));
    if (j.kind !== "robbed-safe-signature") die(`${f}: not a robbed-safe-signature file`);
    if (getAddress(j.safe) !== safe) die(`${f}: signature is for Safe ${j.safe}, not ${safe}`);
    if (Number(j.chainId) !== chainId) die(`${f}: signature chainId ${j.chainId} != ${chainId}`);
    if (j.safeTxHash.toLowerCase() !== localHash.toLowerCase()) die(`${f}: signature is over a different SafeTx hash`);
    const signer = getAddress(j.signer);
    const recovered = await recoverSigner(localHash, j.signature);
    if (recovered !== signer) die(`${f}: signature recovers to ${recovered}, not declared ${signer}`);
    const isOwner = await pub.readContract({ address: safe, abi: safeAbi, functionName: "isOwner", args: [signer] });
    if (!isOwner) die(`${f}: ${signer} is not a current owner of Safe ${safe}`);
    if (seen.has(signer.toLowerCase())) die(`${f}: duplicate signer ${signer}`);
    seen.add(signer.toLowerCase());
    sigs.push({ signer, signature: j.signature });
  }
  // Fail-closed client-side threshold check (the contract enforces it too).
  if (BigInt(sigs.length) < meta.threshold) {
    die(`have ${sigs.length} valid signature(s), Safe threshold is ${meta.threshold}`);
  }

  const { blob, signers } = await orderSignatures(localHash, sigs, "ascending");
  log(`assembled ${signers.length} signatures (ascending): ${signers.join(", ")}`);

  const pk = (process.env.EXECUTOR_PRIVATE_KEY ??
    die("EXECUTOR_PRIVATE_KEY is required (env only — the submitter; any funded EOA)")) as Hex;
  const wallet = createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http() });
  const res = await sendExecTransaction(pub, wallet, safe, tx, blob);
  log(`ExecutionSuccess — tx ${res.txHash} block ${res.blockNumber}, payment ${res.payment}`);
  console.log("");
  console.log(`SAFE_TX_EXECUTED=${res.txHash}`);
}

async function cmdExecData(): Promise<void> {
  const { chainId, pub } = await connect();
  const txFile = cliFlag("tx") ?? die("--tx <tx.json> required");
  const { safe, chainId: txChainId, tx, safeTxHash } = jsonToTx(readFileSync(txFile, "utf8"));
  if (txChainId !== chainId) die(`tx JSON chainId ${txChainId} != connected chain ${chainId}`);
  const meta = await preflightSafe(pub, safe);

  const localHash = computeSafeTxHash(chainId, safe, tx);
  if (localHash.toLowerCase() !== safeTxHash.toLowerCase()) die(`tx JSON safeTxHash mismatch (tampered/stale)`);
  const onchainHash = await pub.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "getTransactionHash",
    args: [tx.to, tx.value, tx.data, 0, 0n, 0n, 0n, ZERO, ZERO, tx.nonce],
  });
  if (onchainHash.toLowerCase() !== localHash.toLowerCase()) die(`on-chain hash mismatch — wrong Safe/chain?`);
  if (meta.nonce !== tx.nonce) {
    die(`Safe nonce is ${meta.nonce} but this tx targets nonce ${tx.nonce} (already executed or built ahead)`);
  }

  const sigFiles = cliFlagAll("sig");
  if (sigFiles.length === 0) die("at least one --sig <sig.json> required (need ≥ threshold)");
  const sigs: SafeSignature[] = [];
  const seen = new Set<string>();
  for (const f of sigFiles) {
    const j = JSON.parse(readFileSync(f, "utf8"));
    if (j.kind !== "robbed-safe-signature") die(`${f}: not a robbed-safe-signature file`);
    if (getAddress(j.safe) !== safe) die(`${f}: signature is for Safe ${j.safe}, not ${safe}`);
    if (Number(j.chainId) !== chainId) die(`${f}: signature chainId ${j.chainId} != ${chainId}`);
    if (j.safeTxHash.toLowerCase() !== localHash.toLowerCase()) die(`${f}: signature is over a different SafeTx hash`);
    const signer = getAddress(j.signer);
    const recovered = await recoverSigner(localHash, j.signature);
    if (recovered !== signer) die(`${f}: signature recovers to ${recovered}, not declared ${signer}`);
    const isOwner = await pub.readContract({ address: safe, abi: safeAbi, functionName: "isOwner", args: [signer] });
    if (!isOwner) die(`${f}: ${signer} is not a current owner of Safe ${safe}`);
    if (seen.has(signer.toLowerCase())) die(`${f}: duplicate signer ${signer}`);
    seen.add(signer.toLowerCase());
    sigs.push({ signer, signature: j.signature });
  }
  if (BigInt(sigs.length) < meta.threshold) {
    die(`have ${sigs.length} valid signature(s), Safe threshold is ${meta.threshold}`);
  }

  const { blob, signers } = await orderSignatures(localHash, sigs, "ascending");
  const data = encodeFunctionData({
    abi: safeAbi,
    functionName: "execTransaction",
    args: [
      tx.to,
      tx.value,
      tx.data,
      tx.operation,
      tx.safeTxGas,
      tx.baseGas,
      tx.gasPrice,
      tx.gasToken,
      tx.refundReceiver,
      blob,
    ],
  });
  const json = JSON.stringify(
    {
      kind: "robbed-safe-exec-data",
      safe,
      chainId,
      safeTxHash: localHash,
      signers,
      data,
    },
    null,
    2,
  );
  const out = cliFlag("out");
  if (out) {
    writeFileSync(out, json + "\n");
    log(`wrote exec calldata JSON ${out}`);
  } else {
    console.log(json);
  }
}

// ─────────────────────────────── dispatch ───────────────────────────────────
async function cli(): Promise<void> {
  const sub = process.argv[2];
  switch (sub) {
    case "hash":
      return cmdHash();
    case "sign":
      return cmdSign();
    case "exec":
      return cmdExec();
    case "exec-data":
      return cmdExecData();
    default:
      console.error(
        "usage: bun run safe:tx <hash|sign|exec> [flags]\n" +
          "  hash --safe <addr> (--preset accept-ownership --target <addr> |\n" +
          "                      --preset transfer-eth --to <addr> --value <wei> |\n" +
          "                      --to <addr> [--value <wei>] [--data 0x..]) [--nonce n] [--out tx.json]\n" +
          "  sign --tx <tx.json> [--out sig.json]        (env: SIGNER_PRIVATE_KEY, or --signature 0x.. --signer 0x..)\n" +
          "  exec --tx <tx.json> --sig a.json --sig b.json  (env: EXECUTOR_PRIVATE_KEY)\n" +
          "  exec-data --tx <tx.json> --sig a.json --sig b.json [--out exec.json]\n" +
          "  common: --rpc-url <url> (default http://localhost:4545)",
      );
      process.exit(sub ? 1 : 0);
  }
}

// Only run the CLI when invoked directly; importing this file (the fork drill)
// pulls the exported helpers without dispatching.
if (import.meta.main) {
  await cli();
}
