/**
 * ── fixture seeding (plan I-5a) ──────────────────────────────────────────────
 * Builds on-chain + indexed fixtures for the specs the SAME way the product
 * does: API-mediated image upload → API metadata pin (canonical bytes + hash) →
 * single `Router.createToken`. The metadata hash is verified against the SHARED
 * canonicalizer so a seed can never drift from the client's pre-sign re-verify.
 *
 * `dev:seed` (root) may pre-populate the stack; these helpers let a spec that
 * needs a bespoke state (near-graduation, freshly-graduated, hostile-treasury)
 * build exactly what it asserts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalizeJson, metadataHash } from "@robbed/shared/metadata";
import { type Address, keccak256, toBytes } from "viem";

import { curveFactoryAbi } from "@robbed/shared/abi";

import {
  type CreatedToken,
  type DeployedAddresses,
  buyOnChain,
  createTokenOnChain,
  graduateOnChain,
  loadDeployedAddresses,
  publicClient,
  readReserves,
  setPauseBuys,
  setPauseCreates,
  warpTime,
} from "./anvil";
import { waitForIndexed, api } from "./api";
import { ROLES, STACK, type DevAccount } from "./config";

/** M0 fork constants (fees/curve). Never hardcode metrics — read the notebook. */
function forkConstants(): any {
  const path = fileURLToPath(
    new URL("../../../../tools/localstack/constants.fork.json", import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

export function deployFeeWei(): bigint {
  return BigInt(forkConstants().fees.creationFeeWei as string);
}

export function graduationEthWei(): bigint {
  return BigInt(forkConstants().curve.graduationEthWei as string);
}

/** Anti-sniper early-window length (M0 notebook) — warp past it before bulk buys. */
export function antiSniperWindowSeconds(): number {
  return Number(forkConstants().antiSniper.windowSeconds);
}

/** The single V3 fee tier (M0 notebook `v3.feeTier` — 1%; never hardcoded). */
export function v3FeeTier(): number {
  return Number(forkConstants().v3.feeTier);
}

/** A minimal valid PNG (1×1) for the API upload path (it re-encodes anyway). */
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

export interface PinnedMetadata {
  metadataHash: `0x${string}`;
  metadataUri: string;
  canonicalJson: string;
}

/** Upload image + pin metadata via the API; assert the shared-hash match. */
export async function pinMetadata(fields: {
  name: string;
  ticker: string;
  description?: string;
}): Promise<PinnedMetadata> {
  // 1) image → POST /v1/uploads/image (multipart; API sniffs + re-encodes).
  // The route is rate-limited (uploads_m 3/min, uploads_h 10/h — api mw); a
  // suite run does several real uploads, so back off and retry on
  // `rate_limited` exactly like a well-behaved client (bounded, ~95s).
  let up: { data: { imageUrl: string; imageHash: string }; error: any } | undefined;
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append("image", new Blob([ONE_PX_PNG], { type: "image/png" }), "seed.png");
    const upRes = await fetch(`${STACK.apiUrl}/v1/uploads/image`, { method: "POST", body: form });
    up = (await upRes.json()) as { data: { imageUrl: string; imageHash: string }; error: any };
    if (!up.error) break;
    if (up.error.code === "rate_limited" && attempt < 4) {
      await new Promise((r) => setTimeout(r, 22_000));
      continue;
    }
    throw new Error(`upload failed: ${up.error.code}`);
  }

  // 2) metadata → POST /v1/metadata (server canonicalizes + keccak)
  const body = {
    name: fields.name,
    ticker: fields.ticker,
    description: fields.description,
    imageUrl: up.data.imageUrl,
    imageHash: up.data.imageHash,
  };
  const mdRes = await fetch(`${STACK.apiUrl}/v1/metadata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const md = (await mdRes.json()) as {
    data: PinnedMetadata;
    error: any;
  };
  if (md.error) throw new Error(`metadata pin failed: ${md.error.code}`);

  // 3) SHARED re-verify (spec §12.19 normative): the fixture's own hash must
  // equal the API's, exactly as the client does before signing.
  const local = metadataHash({
    version: 1,
    name: body.name,
    ticker: body.ticker,
    ...(body.description ? { description: body.description } : {}),
    imageUrl: body.imageUrl,
    imageHash: body.imageHash,
  });
  if (local !== md.data.metadataHash) {
    throw new Error(
      `[e2e seed] metadata hash mismatch: shared=${local} api=${md.data.metadataHash}`,
    );
  }
  void canonicalizeJson; // referenced so the shared canonicalizer stays wired
  return md.data;
}

export interface SeededToken extends CreatedToken {
  /** Effective (uniquified) name/ticker actually committed on-chain. */
  name: string;
  ticker: string;
  addresses: DeployedAddresses;
  metadata: PinnedMetadata;
}

/** Short run nonce so each seeded token is uniquely identifiable across reruns. */
function nonce(): string {
  return Math.random().toString(36).slice(2, 5).toUpperCase();
}

/**
 * Compute a metadata commitment LOCALLY (shared canonicalizer + keccak) without
 * the API. The API's image-upload path is hourly-rate-limited (`uploads_h`) and
 * `POST /v1/metadata` requires a real uploaded image, so pinning per-seed is
 * infeasible for a 36-flow suite. On-chain `createToken` only needs the bytes32
 * hash + a URI string; the indexer lists the token from the `TokenCreated` event
 * regardless of whether the JSON is pinned (metadata verification just reads
 * "unfetched", exactly like the seeded canary). Flows that must exercise the REAL
 * upload/pin path (LAUNCH-1/2, ERR-6a) drive the browser form and are gated by
 * the same rate limit — reported as an environmental constraint.
 */
export function localMetadata(fields: {
  name: string;
  ticker: string;
  description?: string;
}): PinnedMetadata {
  const imageHash = keccak256(toBytes(`img:${fields.ticker}:${fields.name}`));
  const obj = {
    version: 1,
    name: fields.name,
    ticker: fields.ticker,
    ...(fields.description ? { description: fields.description } : {}),
    imageUrl: `https://img.robbed.example/${imageHash}.png`,
    imageHash,
  };
  const hash = metadataHash(obj);
  return {
    metadataHash: hash,
    metadataUri: `https://meta.robbed.example/metadata/${hash}.json`,
    canonicalJson: canonicalizeJson(obj),
  };
}

/**
 * Ensure `pauseCreates` is off before a create (the owner is anvil account #0 =
 * ROLES.creator). The stack can come up (or be left by ERR-8) with creates
 * paused; seeds/launch self-heal so a global flag never blocks unrelated flows.
 */
export async function ensureCreatesEnabled(): Promise<void> {
  const { curveFactory } = loadDeployedAddresses();
  const paused = (await publicClient.readContract({
    address: curveFactory,
    abi: curveFactoryAbi,
    functionName: "pauseCreates",
  })) as boolean;
  if (paused) {
    const h = await setPauseCreates(false);
    await publicClient.waitForTransactionReceipt({ hash: h });
  }
}

/** Ensure `pauseBuys` is off before a seed buy (ERR-4 may leave it set). */
export async function ensureBuysEnabled(): Promise<void> {
  const { curveFactory } = loadDeployedAddresses();
  const paused = (await publicClient.readContract({
    address: curveFactory,
    abi: curveFactoryAbi,
    functionName: "pauseBuys",
  })) as boolean;
  if (paused) {
    const h = await setPauseBuys(false);
    await publicClient.waitForTransactionReceipt({ hash: h });
  }
}

/** Full happy fixture: local hash → createToken → wait until the indexer lists it.
 * `pin: true` routes through the REAL API pin path (upload + POST /v1/metadata,
 * rate-limited `uploads_h`) so the indexer's verifier can actually FETCH the
 * JSON and materialize description/links — required by flows that assert
 * metadata-sourced display (TD-11). Default stays the local (unfetchable) hash. */
export async function seedToken(opts: {
  creator?: DevAccount;
  name: string;
  ticker: string;
  description?: string;
  initialBuyWei?: bigint;
  pin?: boolean;
}): Promise<SeededToken> {
  await ensureCreatesEnabled();
  await ensureBuysEnabled();
  // Uniquify so search/grid/ticker assertions target THIS run's token, not a
  // dupe left by an earlier run (ticker ≤10 bytes, name unbounded here).
  const tag = nonce();
  const ticker = `${opts.ticker.slice(0, 7)}${tag}`;
  const name = `${opts.name} ${tag}`;
  const metadata = opts.pin
    ? await pinMetadata({ name, ticker, description: opts.description })
    : localMetadata({ name, ticker, description: opts.description });
  const addresses = loadDeployedAddresses();
  const created = await createTokenOnChain({
    creator: opts.creator,
    name,
    symbol: ticker,
    metadataHash: metadata.metadataHash,
    metadataUri: metadata.metadataUri,
    deployFeeWei: deployFeeWei(),
    initialBuyWei: opts.initialBuyWei,
  });
  await waitForIndexed(
    () => api.token(created.token),
    (t) => Boolean(t?.address),
    { label: `token ${created.token} indexed` },
  );
  return { ...created, name, ticker, addresses, metadata };
}

/** Drive a curve to just under (or over) the graduation threshold via buys. */
export async function pushCurveTowardGraduation(
  token: Address,
  curve: Address,
  opts: { crossThreshold?: boolean } = {},
): Promise<void> {
  await ensureBuysEnabled();
  // Warp past the anti-sniper early window (windowSeconds) so the large buys
  // needed to reach graduation aren't clamped by MAX_EARLY_BUY (EarlyBuyCapExceeded).
  await warpTime(Number(forkConstants().antiSniper.windowSeconds) + 2);
  const target = graduationEthWei();
  const buyer = ROLES.trader;
  for (let i = 0; i < 20; i++) {
    const { realEth } = await readReserves(curve);
    const overshoot = opts.crossThreshold ? 0n : (target * 5n) / 100n; // ~5% short
    if (realEth >= target - overshoot) break;
    const step = target / 5n;
    const hash = await buyOnChain({ buyer, token, ethWei: step });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

/** Cross the threshold then execute the permissionless `graduate()`.
 * Returns the graduation tx hash (its `Graduated` log carries the LP tokenId). */
export async function graduateToken(
  token: Address,
  curve: Address,
): Promise<`0x${string}`> {
  await pushCurveTowardGraduation(token, curve, { crossThreshold: true });
  const hash = await graduateOnChain(curve);
  await publicClient.waitForTransactionReceipt({ hash });
  await waitForIndexed(
    () => api.token(token),
    (t) => t?.status === "graduated",
    { label: `token ${token} graduated` },
  );
  return hash;
}
