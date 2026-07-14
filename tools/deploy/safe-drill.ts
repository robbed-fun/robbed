#!/usr/bin/env bun
/**
 * safe-drill.ts — `bun run safe:drill` (O-6 Phase 2: fork rehearsal).
 * Owner: robbed-contracts (tooling only — touches no contracts/src, no apps).
 *
 * Proves the ENTIRE 2-of-4 treasury-Safe workflow byte-for-byte on a local
 * anvil FORK of Robinhood mainnet (chain 4663), which carries the canonical
 * Safe v1.4.1 set. This is the dress rehearsal for the
 * mainnet O-6 ceremony (Phases 3–5): every step here runs against the exact
 * on-chain Safe primitives the mainnet run will use — only the signers (dev
 * keys → real hardware) and the executor (dev EOA → funded mainnet EOA) change.
 *
 * Drill (each step asserts; the script exits non-zero on any failure):
 *   1. create a 2/4 Safe with anvil dev keys via `safe:create` (canonical v1.4.1).
 *   2. fund the Safe.
 *   3. POSITIVE — two-signature ETH transfer out, driven THROUGH the `safe:tx`
 *      CLI (hash → sign on two "machines" → exec). Assert ExecutionSuccess, the
 *      recipient credited exactly, the Safe debited exactly, nonce++.
 *   4. NEGATIVE — a SINGLE signature must revert on-chain (threshold is 2).
 *   5. NEGATIVE — two valid signatures in DESCENDING signer order must revert;
 *      the SAME two in ascending order then succeed (isolates ordering as the
 *      only difference — Safe requires strictly-increasing signer addresses).
 *   6. POSITIVE — `accept-ownership`: deploy the CurveFactory via the existing
 *      Deploy script (Fork mode transfers ownership to the treasury Safe), then
 *      the Safe `acceptOwnership()`s it via `safe:tx`. Assert factory.owner()==Safe.
 *
 * The positives run through the real `safe:tx` CLI (JSON files exchanged on
 * disk, exactly as two separated signers would). The negatives call the
 * exported safe-tx helpers directly, since they must BYPASS the CLI's
 * fail-closed threshold/ordering guards to prove the on-chain contract itself
 * rejects the bad blob (defense in depth: the CLI refuses these too).
 *
 * Config (env):
 *   DRILL_RPC_URL     use an already-running fork; else anvil is spawned here.
 *   ROBINHOOD_RPC_URL fork source when spawning (default mainnet public RPC).
 *   DRILL_KEEP_ALIVE  "1" leaves a spawned anvil running for inspection.
 *
 * Module resolution mirrors create-safe.ts / safe-tx.ts.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeSafeTxHash, orderSignatures, sendExecTransaction, signSafeTxHash, type SafeSignature, type SafeTx } from "./safe-tx.ts";

const sharedRequire = createRequire(
  fileURLToPath(new URL("../../packages/shared/package.json", import.meta.url)),
);
const viem: typeof import("viem") = await import(sharedRequire.resolve("viem"));
const viemAccounts: typeof import("viem/accounts") = await import(sharedRequire.resolve("viem/accounts"));
const { createPublicClient, createWalletClient, defineChain, getAddress, http, parseAbi, parseEther } = viem;
const { privateKeyToAccount, generatePrivateKey } = viemAccounts;

type Address = `0x${string}`;
type Hex = `0x${string}`;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HERE = fileURLToPath(new URL(".", import.meta.url));
// JSON tx/signature exchange files live in an OS temp dir — the drill never
// writes into the repo tree (the only exception is the gitignored
// tools/localstack/out/constants.drill.json, which foundry fs_permissions
// requires to sit under ../tools/localstack for Deploy.s.sol to read it).
const SCRATCH = mkdtempSync(join(tmpdir(), "robbed-safe-drill-"));
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

// anvil default dev accounts (well-known public keys — NOT secrets; same set
// seed-chain.ts / Deploy.s.sol use). 0 = deployer/executor, 1–4 = Safe owners.
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  owner1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // 0x7099…79C8
  owner2: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // 0x3C44…93BC
  owner3: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // 0x90F7…b906
  owner4: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // 0x15d3…6A65
} as const satisfies Record<string, Hex>;

const safeAbi = parseAbi([
  "function nonce() view returns (uint256)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
]);
const ownable2StepAbi = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
]);

let step = 0;
const pass = (msg: string) => console.log(`  ✅ PASS  ${msg}`);
const info = (msg: string) => console.log(`         ${msg}`);
function head(title: string) {
  console.log(`\n── step ${++step}: ${title} ─────────────────────────────────────`);
}
function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(`  ❌ FAIL  ${msg}`);
    throw new Error(`drill assertion failed: ${msg}`);
  }
  pass(msg);
}

/** Spawn `bun tools/deploy/<file> …`, return stdout (throws on non-zero exit). */
async function runBun(file: string, args: string[], env: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(["bun", `${HERE}${file}`, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${file} ${args.join(" ")} exited ${code}\n${out}\n${err}`);
  return out + err;
}

async function main() {
  const spawnOwn = !process.env.DRILL_RPC_URL;
  const port = 4600 + Math.floor(Math.random() * 300);
  const rpc = process.env.DRILL_RPC_URL ?? `http://127.0.0.1:${port}`;
  const forkUrl = process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

  let anvil: ReturnType<typeof Bun.spawn> | undefined;
  if (spawnOwn) {
    console.log(`booting anvil fork of ${forkUrl} on :${port} …`);
    anvil = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", String(port), "--fork-url", forkUrl, "--silent"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  }

  try {
    // wait for RPC readiness (chain id 4663).
    const probe = createPublicClient({ transport: http(rpc) });
    let chainId = 0;
    for (let i = 0; i < 60; i++) {
      try {
        chainId = await probe.getChainId();
        break;
      } catch {
        await Bun.sleep(500);
      }
    }
    if (chainId !== 4663) throw new Error(`fork chain id is ${chainId}, expected 4663 (not a Robinhood-mainnet fork)`);

    const chain = defineChain({
      id: 4663,
      name: "robinhood-fork",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    });
    const pub = createPublicClient({ chain, transport: http(rpc) });
    const deployer = privateKeyToAccount(KEYS.deployer);
    const wallet = createWalletClient({ account: deployer, chain, transport: http(rpc) });
    const owners = {
      [getAddress(privateKeyToAccount(KEYS.owner1).address)]: KEYS.owner1,
      [getAddress(privateKeyToAccount(KEYS.owner2).address)]: KEYS.owner2,
      [getAddress(privateKeyToAccount(KEYS.owner3).address)]: KEYS.owner3,
      [getAddress(privateKeyToAccount(KEYS.owner4).address)]: KEYS.owner4,
    } as Record<Address, Hex>;
    const ownerAddrs = Object.keys(owners) as Address[];
    console.log(`fork ready: chain ${chainId} @ ${rpc}`);

    // ── step 1: create 2/4 Safe via `safe:create` ───────────────────────────
    head("create a 2/4 Safe with anvil dev keys (safe:create)");
    const createOut = await runBun("create-safe.ts", [], {
      RPC_URL: rpc,
      DEPLOYER_PRIVATE_KEY: KEYS.deployer,
      OWNERS: ownerAddrs.join(","),
      THRESHOLD: "2",
      SALT_NONCE: String(Date.now()),
    });
    const safe = getAddress((createOut.match(/SAFE_ADDRESS=(0x[0-9a-fA-F]{40})/) ?? [])[1]!);
    const [gotThreshold, gotOwners] = await Promise.all([
      pub.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }),
      pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
    ]);
    assert(gotThreshold === 2n, `Safe ${safe} threshold == 2`);
    assert(gotOwners.length === 4, `Safe has 4 owners`);

    // ── step 2: fund the Safe ────────────────────────────────────────────────
    head("fund the Safe");
    const fundHash = await wallet.sendTransaction({ to: safe, value: parseEther("5") });
    await pub.waitForTransactionReceipt({ hash: fundHash });
    const safeBal0 = await pub.getBalance({ address: safe });
    assert(safeBal0 === parseEther("5"), `Safe balance == 5 ETH`);

    // ── step 3: POSITIVE two-signature ETH transfer via `safe:tx` CLI ────────
    head("POSITIVE — two-signature ETH transfer (safe:tx hash/sign/exec)");
    // fresh zero-code burner so balance math is exact (no 7702/contract sweep).
    const recipient = getAddress(privateKeyToAccount(generatePrivateKey()).address);
    const recipCode = await pub.getCode({ address: recipient });
    assert(!recipCode || recipCode === "0x", `recipient ${recipient} is a zero-code EOA`);
    const xferValue = parseEther("1");

    const txFile = `${SCRATCH}/xfer-tx.json`;
    await runBun("safe-tx.ts", ["hash", "--safe", safe, "--preset", "transfer-eth", "--to", recipient, "--value", xferValue.toString(), "--out", txFile], { RPC_URL: rpc });
    // two signers on two "machines" (separate invocations + SIGNER_PRIVATE_KEY).
    const [sA, sB] = ownerAddrs.slice(0, 2);
    const sigA = `${SCRATCH}/xfer-sigA.json`;
    const sigB = `${SCRATCH}/xfer-sigB.json`;
    await runBun("safe-tx.ts", ["sign", "--tx", txFile, "--out", sigA], { RPC_URL: rpc, SIGNER_PRIVATE_KEY: owners[sA!]! });
    await runBun("safe-tx.ts", ["sign", "--tx", txFile, "--out", sigB], { RPC_URL: rpc, SIGNER_PRIVATE_KEY: owners[sB!]! });
    const execOut = await runBun("safe-tx.ts", ["exec", "--tx", txFile, "--sig", sigA, "--sig", sigB], { RPC_URL: rpc, EXECUTOR_PRIVATE_KEY: KEYS.deployer });
    assert(/ExecutionSuccess/.test(execOut), `safe:tx exec reported ExecutionSuccess`);
    const [recipBal, safeBal1, nonce1] = await Promise.all([
      pub.getBalance({ address: recipient }),
      pub.getBalance({ address: safe }),
      pub.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
    ]);
    assert(recipBal === xferValue, `recipient credited exactly 1 ETH`);
    assert(safeBal1 === safeBal0 - xferValue, `Safe debited exactly 1 ETH (5 → 4)`);
    assert(nonce1 === 1n, `Safe nonce advanced 0 → 1`);

    // ── helper: build a fresh transfer-eth SafeTx at the live nonce ──────────
    const buildTx = async (to: Address, value: bigint): Promise<{ tx: SafeTx; hash: Hex }> => {
      const nonce = await pub.readContract({ address: safe, abi: safeAbi, functionName: "nonce" });
      const tx: SafeTx = { to, value, data: "0x", operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce };
      return { tx, hash: computeSafeTxHash(4663, safe, tx) };
    };
    const sigOf = async (owner: Address, hash: Hex): Promise<SafeSignature> => ({ signer: owner, signature: await signSafeTxHash(hash, owners[owner]!) });
    const expectRevert = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        assert(false, `${label} — expected on-chain REVERT but the call SUCCEEDED`);
      } catch (e) {
        // Surface the Safe GSxxx code when present (GS020 = signatures too short;
        // GS026 = invalid owner / bad signature order).
        const gs = (e as Error).message.match(/GS0\d\d/)?.[0] ?? "revert";
        pass(`${label} reverted on-chain (${gs})`);
      }
    };

    // ── step 4: NEGATIVE — a single signature must revert ────────────────────
    head("NEGATIVE — single signature must revert (threshold 2)");
    {
      const burner = getAddress(privateKeyToAccount(generatePrivateKey()).address);
      const { tx, hash } = await buildTx(burner, parseEther("1"));
      const one = await sigOf(ownerAddrs[0]!, hash);
      const { blob } = await orderSignatures(hash, [one], "none");
      await expectRevert("single-signature exec", () => sendExecTransaction(pub, wallet, safe, tx, blob));
      const n = await pub.readContract({ address: safe, abi: safeAbi, functionName: "nonce" });
      assert(n === 1n, `Safe nonce UNCHANGED at 1 (no partial execution)`);
    }

    // ── step 5: NEGATIVE — descending sigs revert; ascending then succeeds ───
    head("NEGATIVE — descending signatures revert; ascending control succeeds");
    {
      const burner = getAddress(privateKeyToAccount(generatePrivateKey()).address);
      const value = parseEther("1");
      const { tx, hash } = await buildTx(burner, value);
      const two = [await sigOf(ownerAddrs[0]!, hash), await sigOf(ownerAddrs[1]!, hash)];
      const desc = await orderSignatures(hash, two, "descending");
      info(`descending order: ${desc.signers.join(" > ")}`);
      await expectRevert("descending-order exec", () => sendExecTransaction(pub, wallet, safe, tx, desc.blob));
      let n = await pub.readContract({ address: safe, abi: safeAbi, functionName: "nonce" });
      assert(n === 1n, `Safe nonce UNCHANGED at 1 after descending revert`);
      // control: the identical signatures, only re-ordered ascending, execute.
      const asc = await orderSignatures(hash, two, "ascending");
      info(`ascending order:  ${asc.signers.join(" < ")}`);
      const res = await sendExecTransaction(pub, wallet, safe, tx, asc.blob);
      assert(res.executionSuccess, `same two sigs ASCENDING → ExecutionSuccess (ordering was the only difference)`);
      const bal = await pub.getBalance({ address: burner });
      assert(bal === value, `control recipient credited exactly 1 ETH`);
      n = await pub.readContract({ address: safe, abi: safeAbi, functionName: "nonce" });
      assert(n === 2n, `Safe nonce advanced 1 → 2 on the ascending success`);
    }

    // ── step 6: POSITIVE — accept-ownership of a fork-deployed CurveFactory ──
    head("POSITIVE — Safe acceptOwnership() of a Deploy-scripted CurveFactory");
    // Patch the dev-fork constants so Deploy hands ownership to THIS Safe, then
    // run the existing Deploy.s.sol in Fork mode (chainid 4663, unaffirmed).
    const constantsSrc = `${ROOT}/tools/localstack/constants.fork.json`;
    const constantsOut = `${ROOT}/tools/localstack/out/constants.drill.json`;
    mkdirSync(`${ROOT}/tools/localstack/out`, { recursive: true });
    const cj = JSON.parse(readFileSync(constantsSrc, "utf8"));
    cj.external.treasurySafe = safe;
    writeFileSync(constantsOut, JSON.stringify(cj, null, 2) + "\n");
    info(`patched constants.drill.json treasurySafe → ${safe}; running Deploy.s.sol (Fork mode) …`);
    const deploy = Bun.spawn(
      ["forge", "script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast", "--slow"],
      {
        cwd: `${ROOT}/contracts`,
        env: { ...process.env, ROBBED_CONSTANTS: "../tools/localstack/out/constants.drill.json", DEPLOYER_PRIVATE_KEY: KEYS.deployer },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const dOut = (await new Response(deploy.stdout).text()) + (await new Response(deploy.stderr).text());
    if ((await deploy.exited) !== 0) throw new Error(`Deploy.s.sol failed:\n${dOut.slice(-2000)}`);
    const factory = getAddress(JSON.parse(readFileSync(`${ROOT}/contracts/deployments/4663.json`, "utf8")).curveFactory);
    const pendingOwner = getAddress(await pub.readContract({ address: factory, abi: ownable2StepAbi, functionName: "pendingOwner" }));
    assert(pendingOwner === safe, `factory ${factory} pendingOwner == Safe (Ownable2Step transfer initiated)`);

    const aoTx = `${SCRATCH}/ao-tx.json`;
    await runBun("safe-tx.ts", ["hash", "--safe", safe, "--preset", "accept-ownership", "--target", factory, "--out", aoTx], { RPC_URL: rpc });
    const ao1 = `${SCRATCH}/ao-sig1.json`;
    const ao2 = `${SCRATCH}/ao-sig2.json`;
    await runBun("safe-tx.ts", ["sign", "--tx", aoTx, "--out", ao1], { RPC_URL: rpc, SIGNER_PRIVATE_KEY: owners[ownerAddrs[0]!]! });
    await runBun("safe-tx.ts", ["sign", "--tx", aoTx, "--out", ao2], { RPC_URL: rpc, SIGNER_PRIVATE_KEY: owners[ownerAddrs[1]!]! });
    const aoOut = await runBun("safe-tx.ts", ["exec", "--tx", aoTx, "--sig", ao1, "--sig", ao2], { RPC_URL: rpc, EXECUTOR_PRIVATE_KEY: KEYS.deployer });
    assert(/ExecutionSuccess/.test(aoOut), `safe:tx exec accept-ownership reported ExecutionSuccess`);
    const [ownerAfter, pendingAfter] = await Promise.all([
      pub.readContract({ address: factory, abi: ownable2StepAbi, functionName: "owner" }),
      pub.readContract({ address: factory, abi: ownable2StepAbi, functionName: "pendingOwner" }),
    ]);
    assert(getAddress(ownerAfter) === safe, `factory.owner() == Safe (handoff complete)`);
    assert(getAddress(pendingAfter) === ZERO, `factory.pendingOwner() cleared to 0x0`);

    console.log(`\n══ DRILL PASSED ══ Safe ${safe}, factory ${factory} now Safe-owned.\n`);
  } finally {
    if (anvil && process.env.DRILL_KEEP_ALIVE !== "1") anvil.kill();
  }
}

await main();
