#!/usr/bin/env bun
/**
 * seed-chain.ts — `bun run dev:seed` (plan item I-4, goal-gate G-2).
 * Owner: robbed-contracts (path-ownership note: `tools/localstack/seed-chain*`
 * + anvil/deploy glue → robbed-contracts; the surrounding compose/orchestration
 * is robbed-indexer's — this file deliberately touches nothing else there).
 *
 * Seeds the running local stack (docker-compose.yml: anvil fork of chain 4663 on
 * :4545, contracts deployed by the `deploychain` one-shot → out/local.env, API on
 * :4001) with three demo tokens through the REAL launch path — never a shortcut:
 *
 * image → POST /v1/uploads/image → POST /v1/metadata (api.md), the
 *   returned `metadataHash` re-verified CLIENT-SIDE with the shared canonicalizer
 * (dual-computation, normative) → `Router.createToken`.
 *
 *   (a) FRESH   — create only (renders the pristine-curve state).
 *   (b) MIDCV   — mid-curve: multi-actor buys AND sells from 3 dev accounts.
 * (c) GRDTD — driven past GRADUATION_ETH (clamp does the landing) →
 * permissionless `graduate()` (ReadyToGraduate lock; the
 * anti-sniper window is warped past with the viem
 * anvil test actions) → 2 real V3 swaps via SwapRouter02 (
 *                 — the real periphery exists on the fork) → `LPFeeVault.collect`
 *                 with the LP-NFT tokenId read from the `Graduated` event.
 *
 * Idempotency (stated choice): APPEND-ONLY. Every run creates 3 new tokens —
 * names are suffixed with the live `factory.tokenCounter()` so re-runs are
 * distinguishable in the UI. No no-op detection: the anvil chain resets on every
 * `docker compose up`, and on-chain create has no uniqueness to key on. Safe to
 * re-run any number of times (upload rate limit 3/min/IP is respected via
 * Retry-After backoff, api.md).
 *
 * Constants discipline : every market/curve parameter is read
 * LIVE from the deployed contracts (creationFee, GRADUATION_ETH, EARLY_WINDOW_END,
 * MAX_EARLY_BUY) — nothing is inlined from M0 output; addresses come from the
 * deploychain artifact `tools/localstack/out/local.env` (env vars override).
 *
 * Module resolution (docs-first, decision recorded): `tools/` is NOT a pnpm
 * workspace member, and the strict pnpm root exposes no packages — so bare
 * `import "viem"` cannot resolve from here (same reason codegen-addresses.ts
 * avoids viem). Chosen: `createRequire` anchored at packages/shared/package.json
 * (Node's documented resolution escape hatch — nodejs.org/api/module.html) which
 * resolves the exact viem/zod versions packages/shared pins (catalog viem 2.55.0);
 * shared SOURCE modules (canonicalizer, ABIs, constants) are imported by relative
 * path and resolve their own deps from packages/shared/node_modules. Alternatives
 * weighed: adding tools/ to pnpm-workspace.yaml (robbed-shared's file — not ours
 * to change) or a hardcoded `.pnpm/...` path import (breaks on any version bump).
 *
 * viem API usage verified against the in-repo precedent apps/web/e2e/harness/
 * anvil.ts (docs-first viem.sh 2026-07-10: createTestClient mode:"anvil" with
 * `increaseTime`/`mine`; `parseEventLogs({ abi, eventName, logs })`).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

// ── shared source modules (relative — the ONE canonicalizer) ────
import { metadataHash as computeMetadataHash } from "../../packages/shared/src/metadata";
import { UNISWAP_V3, WETH_ADDRESS } from "../../packages/shared/src/constants";
import {
  bondingCurveAbi,
  curveFactoryAbi,
  launchTokenAbi,
  lpFeeVaultAbi,
  routerAbi,
  swapRouter02Abi,
  v3MigratorAbi,
} from "../../packages/shared/src/abi/index";

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
  createTestClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseAbi,
  parseEther,
  parseEventLogs,
} = viem;
const { privateKeyToAccount } = viemAccounts;

type Address = `0x${string}`;
type Hex = `0x${string}`;

// ── stack endpoints (docker.md host-port convention; env-overridable) ────────
const RPC_URL = process.env.SEED_RPC_URL ?? `http://localhost:${process.env.ANVIL_PORT ?? "4545"}`;
const API_URL = process.env.SEED_API_URL ?? `http://localhost:${process.env.API_PORT ?? "4001"}`;
const CHAIN_ID = 4663; // the anvil service is a FORK of Robinhood Chain (docker.md)

// ── anvil dev accounts (STANDARD, PUBLICLY-KNOWN keys printed by `anvil` on ──
// boot — not secrets; same precedent as Deploy.s.sol ANVIL_ACCOUNT0_PK and the
// e2e harness). Accounts 0 (deployer) and 1 (dev treasury stand-in,
// constants.fork.json) are deliberately not used as traders.
const ANVIL_KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // 0 deployer
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // 1 treasury stand-in
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // 2
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // 3
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // 4
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // 5
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e", // 6
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356", // 7
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97", // 8
];
const actor = (i: number) => privateKeyToAccount(ANVIL_KEYS[i]!);

// ── clients ──────────────────────────────────────────────────────────────────
const chain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain (local fork)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const testClient = createTestClient({ chain, mode: "anvil", transport: http(RPC_URL) });
const walletFor = (i: number) =>
  createWalletClient({ account: actor(i), chain, transport: http(RPC_URL) });

// ── deployed addresses from the deploychain one-shot (env overrides win) ─────
function loadLocalEnv(): Record<string, string> {
  const path = fileURLToPath(new URL("./out/local.env", import.meta.url));
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `[seed] ${path} not found — the compose \`deploychain\` one-shot has not run. ` +
        "Start the stack (`bun run dev:d`) and check `docker compose logs deploychain`.",
    );
  }
  for (const line of raw.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}
const localEnv = loadLocalEnv();
const addr = (k: string): Address => {
  const v = process.env[k] ?? localEnv[k];
  if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`[seed] missing/invalid ${k} in env and out/local.env`);
  }
  return v as Address;
};
const ROUTER = addr("ROUTER_ADDRESS");
const FACTORY = addr("CURVE_FACTORY_ADDRESS");
const MIGRATOR = addr("MIGRATOR_ADDRESS");
const LP_FEE_VAULT = addr("LP_FEE_VAULT_ADDRESS");

// ── tiny helpers ─────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`[seed] ${msg}`);

/** Fresh per-tx deadline from CHAIN time (anvil time is warped ahead of wall clock). */
async function deadline(): Promise<bigint> {
  const block = await pub.getBlock();
  return block.timestamp + 600n;
}

/** simulate → write → wait → assert success (decoded custom errors on revert). */
async function write(
  actorIdx: number,
  params: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  },
): Promise<import("viem").TransactionReceipt> {
  const account = actor(actorIdx);
  const { request } = await pub.simulateContract({ ...params, account } as never);
  const hash = await walletFor(actorIdx).writeContract(request as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`[seed] tx reverted: ${params.functionName} (${hash})`);
  }
  return receipt;
}

const read = <T>(params: {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}): Promise<T> => pub.readContract(params as never) as Promise<T>;

// ── minimal PNG encoder (placeholder art, generated programmatically) ────────
// PNG spec (w3.org/TR/png-3): signature + IHDR + IDAT(zlib scanlines) + IEND,
// each chunk CRC-32 over type+data. 64×64 solid RGB is enough for sharp's
// decode→re-encode pipeline (api.md) and keeps uploads a few hundred bytes.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function makePng(rgb: [number, number, number], size = 64): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr.set([8, 2, 0, 0, 0], 8); // bit depth 8, color type 2 (RGB)
  const row = new Uint8Array(1 + size * 3); // filter byte 0 + pixels
  for (let x = 0; x < size; x++) row.set(rgb, 1 + x * 3);
  const raw = new Uint8Array(row.length * size);
  for (let y = 0; y < size; y++) raw.set(row, y * row.length);
  const idat = new Uint8Array(deflateSync(raw));
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    png.set(c, off);
    off += c.length;
  }
  return png;
}

// ── API client (envelope `{data,error}`, api.md; 429 Retry-After backoff) ─
async function api<T>(path: string, init: RequestInit): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API_URL}${path}`, init);
    if (res.status === 429) {
      // Uploads are limited to 3/min AND 10/hour per IP (api.md). The minute
      // window is worth waiting out; an hour-scale Retry-After means the 10/hour
      // cap is exhausted (>3 seed runs/hour incl. any concurrent e2e traffic) —
      // fail loud instead of stalling dev:seed for up to an hour.
      const retryAfter = Number(res.headers.get("retry-after") ?? "10");
      if (attempt <= 3 && retryAfter <= 90) {
        log(`rate-limited on ${path} — waiting ${retryAfter + 1}s (attempt ${attempt}/3)`);
        await sleep((retryAfter + 1) * 1000);
        continue;
      }
      throw new Error(
        `[seed] API ${path} rate-limited (Retry-After ${retryAfter}s) — the 10/hour ` +
          "upload cap is likely exhausted (>3 seed runs/hour); re-run later or " +
          "`docker compose restart api` (the dev limiter is in-memory — a restart clears it)",
      );
    }
    const body = (await res.json().catch(() => null)) as {
      data: T | null;
      error: { code: string; message: string } | null;
    } | null;
    if (!res.ok || !body || body.error || body.data == null) {
      throw new Error(
        `[seed] API ${path} failed: HTTP ${res.status} ${body?.error ? JSON.stringify(body.error) : ""}`,
      );
    }
    return body.data;
  }
}

interface MetadataResult {
  metadataHash: Hex;
  metadataUri: string;
}

/**
 * The REAL launch path, steps 1–2 (api.md) upload the placeholder
 * image, publish canonical metadata, then re-verify the returned hash with the
 * shared canonicalizer exactly like the web client does (— the
 * client must never sign a hash it did not recompute from canonical bytes).
 */
async function publishMetadata(input: {
  name: string;
  ticker: string;
  description: string;
  links?: { website?: string; x?: string; telegram?: string };
  rgb: [number, number, number];
}): Promise<MetadataResult> {
  const form = new FormData();
  form.append("image", new File([makePng(input.rgb)], "seed.png", { type: "image/png" }));
  const uploaded = await api<{ imageUrl: string; imageHash: Hex }>("/v1/uploads/image", {
    method: "POST",
    body: form,
  });

  const resp = await api<{ metadataHash: Hex; metadataUri: string; canonicalJson: string }>(
    "/v1/metadata",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        ticker: input.ticker,
        description: input.description,
        ...(input.links ? { links: input.links } : {}),
        imageUrl: uploaded.imageUrl,
        imageHash: uploaded.imageHash,
      }),
    },
  );

  // dual computation — both checks with THE shared canonicalizer:
  // (1) hash of the server's canonical bytes matches what it claims;
  // (2) hash of the doc WE meant (fixed field set + version tag, api.md)
  //     matches too, so the server cannot commit us to metadata we didn't write.
  const fromCanonicalBytes = computeMetadataHash(JSON.parse(resp.canonicalJson));
  const fromOurDoc = computeMetadataHash({
    version: 1,
    name: input.name,
    ticker: input.ticker,
    description: input.description,
    ...(input.links ? { links: input.links } : {}),
    imageUrl: uploaded.imageUrl,
    imageHash: uploaded.imageHash,
  });
  if (fromCanonicalBytes !== resp.metadataHash || fromOurDoc !== resp.metadataHash) {
    throw new Error(
      `[seed] metadataHash verification FAILED (server=${resp.metadataHash} ` +
        `canonical=${fromCanonicalBytes} local=${fromOurDoc}) — refusing to sign `,
    );
  }
  return { metadataHash: resp.metadataHash, metadataUri: resp.metadataUri };
}

// ── chain legs ───────────────────────────────────────────────────────────────

interface CreatedToken {
  token: Address;
  curve: Address;
  pool: Address;
}

/** Launch step 3: `Router.createToken` (value = live creationFee + optional buy). */
async function createToken(
  creatorIdx: number,
  meta: MetadataResult,
  name: string,
  ticker: string,
  initialBuyWei: bigint,
): Promise<CreatedToken> {
  const creationFee = await read<bigint>({
    address: FACTORY,
    abi: curveFactoryAbi,
    functionName: "creationFee",
  });
  const receipt = await write(creatorIdx, {
    address: ROUTER,
    abi: routerAbi,
    functionName: "createToken",
    args: [name, ticker, meta.metadataHash, meta.metadataUri, 0n, await deadline()],
    value: creationFee + initialBuyWei,
  });
  const [created] = parseEventLogs({
    abi: curveFactoryAbi,
    eventName: "TokenCreated",
    logs: receipt.logs,
  });
  if (!created) throw new Error("[seed] TokenCreated not found in create receipt");
  const { token, curve, pool } = created.args as { token: Address; curve: Address; pool: Address };
  log(`created ${name} (${ticker}) token=${token} curve=${curve}`);
  return { token, curve, pool };
}

/**
 * Warp the fork clock past the curve's anti-sniper window (—
 * timestamp-based BY SPEC; `EARLY_WINDOW_END` is read live, never assumed).
 */
async function warpPastEarlyWindow(curve: Address): Promise<void> {
  const end = await read<bigint>({
    address: curve,
    abi: bondingCurveAbi,
    functionName: "EARLY_WINDOW_END",
  });
  const now = (await pub.getBlock()).timestamp;
  if (now > end) return;
  const delta = Number(end - now) + 2;
  await testClient.increaseTime({ seconds: delta });
  await testClient.mine({ blocks: 1 });
  log(`warped +${delta}s past the anti-sniper window`);
}

/** Curve buy through the Router with a real quote-derived slippage floor. */
async function buy(traderIdx: number, token: Address, grossWei: bigint): Promise<void> {
  const [tokensOut] = await read<[bigint, bigint, bigint, bigint]>({
    address: ROUTER,
    abi: routerAbi,
    functionName: "quoteBuy",
    args: [token, grossWei],
  });
  await write(traderIdx, {
    address: ROUTER,
    abi: routerAbi,
    functionName: "buy",
    args: [token, actor(traderIdx).address, (tokensOut * 98n) / 100n, await deadline()],
    value: grossWei,
  });
  log(`  buy  ${formatEther(grossWei)} ETH by ${actor(traderIdx).address.slice(0, 8)}…`);
}

/** Curve sell of a balance fraction (approve Router — it pulls into the curve). */
async function sell(traderIdx: number, token: Address, num: bigint, den: bigint): Promise<void> {
  const trader = actor(traderIdx).address;
  const balance = await read<bigint>({
    address: token,
    abi: launchTokenAbi,
    functionName: "balanceOf",
    args: [trader],
  });
  const amount = (balance * num) / den;
  if (amount === 0n) throw new Error(`[seed] nothing to sell for ${trader}`);
  await write(traderIdx, {
    address: token,
    abi: launchTokenAbi,
    functionName: "approve",
    args: [ROUTER, amount],
  });
  const [ethOut] = await read<[bigint, bigint]>({
    address: ROUTER,
    abi: routerAbi,
    functionName: "quoteSell",
    args: [token, amount],
  });
  await write(traderIdx, {
    address: ROUTER,
    abi: routerAbi,
    functionName: "sell",
    args: [token, amount, trader, (ethOut * 98n) / 100n, await deadline()],
  });
  log(`  sell ${formatEther(ethOut)} ETH-worth by ${trader.slice(0, 8)}…`);
}

const wethAbi = parseAbi([
  "function deposit() payable",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

/** One exactInputSingle on the graduated pool via the REAL SwapRouter02. */
async function v3Swap(
  traderIdx: number,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): Promise<void> {
  await write(traderIdx, {
    address: tokenIn,
    abi: tokenIn === WETH_ADDRESS ? wethAbi : launchTokenAbi,
    functionName: "approve",
    args: [UNISWAP_V3.swapRouter02 as Address, amountIn],
  });
  // IV3SwapRouter.ExactInputSingleParams (SwapRouter02: no deadline field; the 1%
  // graduation fee tier per). amountOutMinimum=0 is dev-seed-only: a
  // private anvil fork has no MEV; our own Router paths above always carry real
  // slippage floors.
  await write(traderIdx, {
    address: UNISWAP_V3.swapRouter02 as Address,
    abi: swapRouter02Abi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        fee: 10_000,
        recipient: actor(traderIdx).address,
        amountIn,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  log(`  v3 swap ${tokenIn.slice(0, 8)}… -> ${tokenOut.slice(0, 8)}…`);
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Preflight: right chain, contracts live, API up.
  const chainId = await pub.getChainId();
  if (chainId !== CHAIN_ID) {
    throw new Error(`[seed] RPC ${RPC_URL} is chain ${chainId}, expected ${CHAIN_ID} (fork)`);
  }
  if (!(await pub.getCode({ address: ROUTER }))) {
    throw new Error(`[seed] no code at ROUTER_ADDRESS ${ROUTER} — check compose logs deploychain`);
  }
  await api<{ ok: true }>("/v1/healthz", { method: "GET" });
  // The e2e pause-matrix suite toggles the granular pause flags on this SAME
  // shared anvil (apps/web/e2e harness); fail fast with a pointer instead of a
  // raw BuysPaused()/CreatesPaused() revert mid-run. (Note the flags can still
  // flip mid-seed if e2e runs concurrently — re-run once it finishes.)
  const [pauseCreates, pauseBuys] = await Promise.all([
    read<boolean>({ address: FACTORY, abi: curveFactoryAbi, functionName: "pauseCreates" }),
    read<boolean>({ address: FACTORY, abi: curveFactoryAbi, functionName: "pauseBuys" }),
  ]);
  if (pauseCreates || pauseBuys) {
    throw new Error(
      "[seed] factory pause flags are set (pauseCreates=" +
        `${pauseCreates}, pauseBuys=${pauseBuys}) — another process (e.g. the e2e ` +
        "pause-matrix) is exercising the stack; re-run dev:seed when it finishes",
    );
  }
  const runId = await read<bigint>({
    address: FACTORY,
    abi: curveFactoryAbi,
    functionName: "tokenCounter",
  });
  log(`stack ok (chain ${chainId}, run suffix #${runId}) — seeding 3 tokens`);

  // ── (a) FRESH: create only ─────────────────────────────────────────────────
  const metaA = await publishMetadata({
    name: `Fresh Demo #${runId}`,
    ticker: "FRESH",
    description: "Seeded demo token (a): just launched, no trades yet.",
    links: { website: "https://example.com/fresh" },
    rgb: [0x22, 0xc5, 0x5e],
  });
  const fresh = await createToken(2, metaA, `Fresh Demo #${runId}`, "FRESH", 0n);

  // ── (b) MIDCV: multi-actor buys AND sells from 3 accounts ─────────────────
  const metaB = await publishMetadata({
    name: `Mid Curve Demo #${runId}`,
    ticker: "MIDCV",
    description: "Seeded demo token (b): mid-curve with multi-actor buys and sells.",
    links: { website: "https://example.com/midcv", x: "https://x.com/robbed" },
    rgb: [0xf5, 0x9e, 0x0b],
  });
  // Creator's atomic initial buy stays under MAX_EARLY_BUY (read live) — the
  // anti-sniper cap applies to the creator too (contracts.md, no carve-out).
  const mid = await createToken(3, metaB, `Mid Curve Demo #${runId}`, "MIDCV", parseEther("0.05"));
  await warpPastEarlyWindow(mid.curve);
  log("mid-curve trades (accounts 5/6/7):");
  await buy(5, mid.token, parseEther("0.9"));
  await buy(6, mid.token, parseEther("1.4"));
  await buy(7, mid.token, parseEther("0.6"));
  await sell(5, mid.token, 1n, 2n); // 50% of balance
  await sell(6, mid.token, 3n, 10n); // 30%
  await sell(7, mid.token, 1n, 4n); // 25%
  const [, , realEth] = await read<[bigint, bigint, bigint, bigint]>({
    address: mid.curve,
    abi: bondingCurveAbi,
    functionName: "reserves",
  });
  log(`mid-curve realEthReserves = ${formatEther(realEth)} ETH`);

  // ── (c) GRDTD: clamp to GRADUATION_ETH → graduate() → V3 swaps → collect ──
  const metaC = await publishMetadata({
    name: `Graduated Demo #${runId}`,
    ticker: "GRDTD",
    description: "Seeded demo token (c): graduated to Uniswap V3; LP fees to vault.",
    links: { website: "https://example.com/grdtd", telegram: "https://t.me/robbed" },
    rgb: [0x8b, 0x5c, 0xf6],
  });
  const grad = await createToken(4, metaC, `Graduated Demo #${runId}`, "GRDTD", 0n);
  await warpPastEarlyWindow(grad.curve);

  // One whale buy past the threshold: the boundary clamp accepts exactly
  // up to GRADUATION_ETH net, refunds the rest, and flips phase→ReadyToGraduate.
  const graduationEth = await read<bigint>({
    address: grad.curve,
    abi: bondingCurveAbi,
    functionName: "GRADUATION_ETH",
  });
  await buy(5, grad.token, graduationEth + parseEther("1"));
  const phase = await read<number>({
    address: grad.curve,
    abi: bondingCurveAbi,
    functionName: "phase",
  });
  if (phase !== 1) throw new Error(`[seed] expected ReadyToGraduate (1), got phase=${phase}`);
  log("clamp landed on GRADUATION_ETH — phase=ReadyToGraduate (lock)");

  // Permissionless graduate() from an unrelated account (earns CALLER_REWARD).
  const gradReceipt = await write(6, {
    address: grad.curve,
    abi: bondingCurveAbi,
    functionName: "graduate",
  });
  const [graduated] = parseEventLogs({
    abi: v3MigratorAbi,
    eventName: "Graduated",
    logs: gradReceipt.logs,
  });
  if (!graduated) throw new Error("[seed] Graduated event not found in graduate() receipt");
  const { tokenId, pool } = graduated.args as { tokenId: bigint; pool: Address };
  log(`graduated: pool=${pool} LP-NFT tokenId=${tokenId} (NFT held by LPFeeVault)`);

  // Two real V3 swaps through SwapRouter02 so the position accrues 1%-tier fees.
  await write(7, { address: WETH_ADDRESS, abi: wethAbi, functionName: "deposit", value: parseEther("0.5") });
  await v3Swap(7, WETH_ADDRESS, grad.token, parseEther("0.4"));
  const swapped = await read<bigint>({
    address: grad.token,
    abi: launchTokenAbi,
    functionName: "balanceOf",
    args: [actor(7).address],
  });
  await v3Swap(7, grad.token, WETH_ADDRESS, swapped / 2n);

  // Permissionless fee collection: LP principal stays locked; fees → treasury.
  const collectReceipt = await write(8, {
    address: LP_FEE_VAULT,
    abi: lpFeeVaultAbi,
    functionName: "collect",
    args: [tokenId],
  });
  const [collected] = parseEventLogs({
    abi: lpFeeVaultAbi,
    eventName: "FeesCollected",
    logs: collectReceipt.logs,
  });
  if (!collected) throw new Error("[seed] FeesCollected event not found in collect receipt");
  const { amount0, amount1 } = collected.args as { amount0: bigint; amount1: bigint };
  if (amount0 + amount1 === 0n) throw new Error("[seed] collect() returned zero fees");
  log(`collect(${tokenId}) -> treasury: amount0=${amount0} amount1=${amount1}`);

  // ── verify leg (G-2): the API must reflect all three, one graduated ────────
  log("waiting for the indexer/API to reflect the seed…");
  const want = new Map<string, boolean>([
    [fresh.token.toLowerCase(), false],
    [mid.token.toLowerCase(), false],
    [grad.token.toLowerCase(), true], // must show graduated: true
  ]);
  const deadlineMs = Date.now() + 120_000;
  for (;;) {
    const { tokens } = await api<{ tokens: { address: string; graduated: boolean }[] }>(
      "/v1/tokens?limit=100",
      { method: "GET" },
    );
    const missing = [...want].filter(
      ([a, mustGrad]) =>
        !tokens.some((t) => t.address.toLowerCase() === a && (!mustGrad || t.graduated)),
    );
    if (missing.length === 0) break;
    if (Date.now() > deadlineMs) {
      throw new Error(
        `[seed] indexer/API did not reflect the seed within 120s — still missing: ` +
          missing.map(([a, g]) => `${a}${g ? " (graduated)" : ""}`).join(", ") +
          " (chain leg succeeded — check `docker compose logs indexer`)",
      );
    }
    await sleep(3000);
  }
  log("done — 3 tokens live via API: fresh, mid-curve (3-actor buys+sells), graduated (+V3 swaps, collect)");
  log(`  fresh:     ${fresh.token}`);
  log(`  mid-curve: ${mid.token}`);
  log(`  graduated: ${grad.token}`);
}

await main();
