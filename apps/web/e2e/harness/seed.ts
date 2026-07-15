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
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalizeJson, metadataHash } from "@robbed/shared/metadata";
import { type Address, keccak256, toBytes } from "viem";

import { curveFactoryAbi } from "@robbed/shared/abi";

import {
  type CreatedToken,
  type CurvePhase,
  type DeployedAddresses,
  type GraduatedLog,
  buyOnChain,
  createTokenOnChain,
  ensureFunded,
  graduateOnChain,
  loadDeployedAddresses,
  publicClient,
  readCurvePhase,
  readGraduatedEvent,
  readGraduationEth,
  readReserves,
  sanitizeAccount,
  setPauseBuys,
  setPauseCreates,
  warpTime,
} from "./anvil";
import { waitForIndexed, api } from "./api";
import { KEEPER_ADDRESS, ROLES, STACK, type DevAccount } from "./config";

/**
 * Neutralize the forked Robinhood mainnet's HOSTILE EIP-7702 sweeper delegations
 * on the well-known anvil dev accounts and keep the spenders funded. Those
 * addresses are squatted on-chain by forwarders that drain any ETH they RECEIVE
 * (buy refund, sell proceeds, graduation caller reward), which would otherwise
 * make trades/graduations non-deterministic across the whole suite. Idempotent
 * (no-op once clean/funded) and called at the top of every seed so any flow —
 * not just the keeper-driven ones — runs against plain, funded EOAs. Strip only
 * for the treasury fee-sink (do not fund it; COLLECT-1/ERR-5 reason about it).
 */
export async function sanitizeDevAccounts(): Promise<void> {
  await sanitizeAccount(ROLES.treasury.address);
  for (const a of [ROLES.creator, ROLES.trader, ROLES.trader2]) {
    await ensureFunded(a.address);
  }
  await ensureFunded(KEEPER_ADDRESS);
}

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

/**
 * @deprecated Reads the STATIC M0 notebook (`constants.fork.json`), which can lag
 * the deployed value — the graduation target moved 8.076869 → 7.916610 ETH.
 * Prefer `readGraduationEth(curve)` (live `GRADUATION_ETH()`), which is what the
 * deploy actually baked in. Retained only as an offline fallback / documentation.
 */
export function graduationEthWei(): bigint {
  return BigInt(forkConstants().curve.graduationEthWei as string);
}

/** Trade fee as the widget's plain label ("1%") — derived from the notebook, never hardcoded. */
export function tradeFeeLabel(): string {
  const bps = Number(forkConstants().fees.tradeFeeBps);
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/** Anti-sniper early-window length (M0 notebook) — warp past it before bulk buys. */
export function antiSniperWindowSeconds(): number {
  return Number(forkConstants().antiSniper.windowSeconds);
}

/** Graduated-pool V3 params from the M0 notebook (fee tier / tick spacing) — the
 * post-grad venue's 1% pool. Read from the notebook, never hardcoded. Used
 *  by the CFEE-* creator-fee flows' SwapRouter02 volume-generation leg. */
export function forkV3(): { feeTier: number; tickSpacing: number } {
  const v3 = forkConstants().v3;
  return { feeTier: Number(v3.feeTier), tickSpacing: Number(v3.tickSpacing) };
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
  // 1) image → POST /v1/uploads/image (multipart; API sniffs + re-encodes)
  const form = new FormData();
  form.append("image", new Blob([ONE_PX_PNG], { type: "image/png" }), "seed.png");
  const upRes = await fetch(`${STACK.apiUrl}/v1/uploads/image`, { method: "POST", body: form });
  const up = (await upRes.json()) as { data: { imageUrl: string; imageHash: string }; error: any };
  if (up.error) throw new Error(`upload failed: ${up.error.code}`);

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

  // 3) SHARED re-verify (normative) the fixture's own hash must
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
 * the API. `POST /v1/metadata` requires a real uploaded image, so pinning every
 * synthetic seed would add avoidable API/storage work to the suite. On-chain `createToken` only needs the bytes32
 * hash + a URI string; the indexer lists the token from the `TokenCreated` event
 * regardless of whether the JSON is pinned (metadata verification just reads
 * "unfetched", exactly like the seeded canary). Flows that must exercise the REAL
 * upload/pin path (LAUNCH-1/2, ERR-6a) drive the browser form.
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
 * `pin: true` routes through the REAL API upload+pin path so
 * the metadata JSON exists in object storage and the indexer's verifier can fetch
 * it (description/links render only then) — use it ONLY where a flow asserts
 * fetched-metadata display (TD-11). */
export async function seedToken(opts: {
  creator?: DevAccount;
  name: string;
  ticker: string;
  description?: string;
  initialBuyWei?: bigint;
  pin?: boolean;
}): Promise<SeededToken> {
  // Restore plain, funded EOAs before any tx — the forked mainnet squats the
  // anvil dev accounts with balance-sweeping EIP-7702 delegations (see the fn).
  await sanitizeDevAccounts();
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

/**
 * ERR-6b fixture: a token whose ON-CHAIN committed metadataHash ≠ the keccak of
 * its STORED canonical JSON — i.e. the pinned object was tampered with
 * post-pin. Build order avoids any race with the indexer's 30s verifier pass:
 *  1. pin real metadata via the API (hash H, object at metadata/H.json);
 *  2. OVERWRITE the stored object with mutated bytes (object-store manipulation
 *     via `mc` inside the minio container — a fixture operation on test infra,
 *     exactly like `anvil_setCode`; no product surface is touched);
 *  3. only then create the token committing H, so the verifier's FIRST fetch
 *     already sees the tampered body → verdict `mismatch`.
 * Requires docker access to the compose minio container; callers should skip
 * with a clear message when unavailable (remote-stack runs).
 */
export async function seedMismatchToken(opts?: {
  name?: string;
  ticker?: string;
}): Promise<SeededToken> {
  await ensureCreatesEnabled();
  const tag = nonce();
  const name = `${opts?.name ?? "Tampered Coin"} ${tag}`;
  const ticker = `${(opts?.ticker ?? "TMPR").slice(0, 7)}${tag}`;
  const metadata = await pinMetadata({
    name,
    ticker,
    description: "ERR-6b original description.",
  });

  // Mutate ONE field; keep the JSON valid so the verifier reaches the hash
  // comparison (not a parse failure).
  const mutated = metadata.canonicalJson.replace(
    "ERR-6b original description.",
    "ERR-6b TAMPERED post-pin.",
  );
  if (mutated === metadata.canonicalJson) {
    throw new Error("[e2e seed] mismatch fixture: mutation did not apply");
  }
  const container = process.env.E2E_MINIO_CONTAINER ?? "robbed-minio-1";
  const user = process.env.MINIO_ROOT_USER ?? "robbed";
  const pass = process.env.MINIO_ROOT_PASSWORD ?? "robbed_dev_secret";
  const bucket = process.env.R2_BUCKET ?? "robbed-assets";
  const b64 = Buffer.from(mutated, "utf8").toString("base64");
  // Object layout is `metadata/{keccak-NO-0x}.json` (apps/api/src/media/storage.ts).
  const key = metadata.metadataHash.replace(/^0x/, "");
  execSync(
    `docker exec ${container} sh -c "mc alias set local http://localhost:9000 ${user} ${pass} >/dev/null && ` +
      `echo ${b64} | base64 -d | mc pipe local/${bucket}/metadata/${key}.json"`,
    { stdio: "pipe" },
  );

  const addresses = loadDeployedAddresses();
  const created = await createTokenOnChain({
    name,
    symbol: ticker,
    metadataHash: metadata.metadataHash,
    metadataUri: metadata.metadataUri,
    deployFeeWei: deployFeeWei(),
  });
  await waitForIndexed(
    () => api.token(created.token),
    (t) => Boolean(t?.address),
    { label: `mismatch token ${created.token} indexed` },
  );
  return { ...created, name, ticker, addresses, metadata };
}

/** True when the compose minio container is reachable for the ERR-6b fixture. */
export function canProvisionMismatchFixture(): boolean {
  try {
    const container = process.env.E2E_MINIO_CONTAINER ?? "robbed-minio-1";
    execSync(`docker exec ${container} sh -c "mc --version >/dev/null 2>&1"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
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
  // LIVE threshold from the deployed curve — never the (possibly-stale) notebook
  // value (8.08 vs 7.92); the loop must target exactly what the contract graduates at.
  const target = await readGraduationEth(curve);
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
 * Returns the graduation tx hash (its `Graduated` log carries the LP tokenId).
 *
 * NOTE: this MANUAL trigger is retained for the non-keeper post-grad fixtures
 * (TD-4/TD-5/COLLECT-1) that need a graduated token FAST and don't care who
 * fired it. On a stack whose compose keeper is running, the keeper may win the
 * race — `graduateOnChain` then reverts `NotReady()`; that revert is swallowed
 * and we fall through to poll for the (keeper-produced) graduated status, so the
 * fixture is correct either way. The KEEPER-DRIVEN flows (TD-6b/GRAD-AUTO) use
 * `crossGraduationThreshold` + `waitForKeeperGraduation` instead and NEVER call
 * graduate() themselves. */
export async function graduateToken(
  token: Address,
  curve: Address,
): Promise<`0x${string}`> {
  // Keeper-safe cross (never buys a curve the keeper already graduated). If the
  // curve is still locked (ReadyToGraduate) the keeper hasn't fired yet — attempt
  // the manual trigger, but TOLERATE a NotReady revert (the keeper won the race
  // between the read and our send; graduation is permissionless — who fires it is
  // immaterial to a "give me a graduated token" fixture).
  const phase = await crossGraduationThreshold(token, curve);
  if (phase === "ready") {
    await graduateOnChain(curve)
      .then((h) => publicClient.waitForTransactionReceipt({ hash: h }))
      .catch(() => {});
  }
  await waitForIndexed(
    () => api.token(token),
    (t) => t?.status === "graduated",
    { label: `token ${token} graduated` },
  );
  // The Graduated event's tx hash — whoever fired graduate() (keeper or us).
  const ev = await readGraduatedEvent(token);
  return ev!.txHash;
}

/**
 * Buy the curve until it CROSSES `GRADUATION_ETH` and LOCKS — keeper-safe. Unlike
 * `pushCurveTowardGraduation`, it re-reads on-chain `phase()` before EVERY buy, so
 * it never sends a trade against a curve the compose keeper has already graduated
 * (that buy would revert `NotTrading()`). Warps past the anti-sniper early window
 * so the large buys aren't clamped by `MAX_EARLY_BUY`. Returns the phase reached:
 * `ready` (ReadyToGraduate — the normal lock) or `graduated` (the keeper already
 * won the race). Used by the keeper-driven graduation flows (TD-6b/GRAD-AUTO).
 */
export async function crossGraduationThreshold(
  token: Address,
  curve: Address,
): Promise<CurvePhase> {
  await ensureBuysEnabled();
  await warpTime(Number(forkConstants().antiSniper.windowSeconds) + 2);
  const target = await readGraduationEth(curve);
  const buyer = ROLES.trader;
  for (let i = 0; i < 30; i++) {
    const phase = await readCurvePhase(curve);
    if (phase !== "trading") return phase; // locked (ready) or keeper already graduated
    const { realEth } = await readReserves(curve);
    if (realEth >= target) return "ready";
    const remaining = target - realEth;
    // Below a quarter-target remaining, buy the gap grossed up 5% (> the 1% fee)
    // so the final buy's net comfortably reaches the threshold; the contract
    // CLAMPS net to the exact remaining and refunds the overshoot.
    const step = remaining < target / 4n ? (remaining * 105n) / 100n + 1n : target / 4n;
    const hash = await buyOnChain({ buyer, token, ethWei: step });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  return readCurvePhase(curve);
}

/**
 * Precisely buy the curve DOWN to a small remaining gap (`leaveWei` net short of
 * `GRADUATION_ETH`) WITHOUT crossing — keeper-safe (re-reads phase before each
 * buy) and never overshoots (the final buy nets exactly `gap − leaveWei`). Used
 * to pre-position for a UI threshold-crossing buy: the browser's anti-sniper cap
 * (`MAX_EARLY_BUY`, checked against WALL-clock while the harness warps CHAIN time
 * ahead) would DISABLE an over-cap UI buy, so the crossing buy must stay under
 * `MAX_EARLY_BUY` — which requires the remaining gap to be smaller than that cap.
 */
export async function pushCurveNearThreshold(
  token: Address,
  curve: Address,
  leaveWei: bigint,
): Promise<void> {
  await ensureBuysEnabled();
  await warpTime(Number(forkConstants().antiSniper.windowSeconds) + 2);
  const target = await readGraduationEth(curve);
  const buyer = ROLES.trader;
  for (let i = 0; i < 40; i++) {
    if ((await readCurvePhase(curve)) !== "trading") return;
    const { realEth } = await readReserves(curve);
    const gap = target - realEth;
    if (gap <= leaveWei) return;
    const wantNet = gap - leaveWei;
    // Gross the wanted net up by the 1% fee; cap the step so a fresh curve takes
    // several buys. Never exceeds `wantNet` net → cannot cross the threshold here.
    const grossWant = (wantNet * 100n) / 99n + 1n;
    const step = grossWant < target / 5n ? grossWant : target / 5n;
    const hash = await buyOnChain({ buyer, token, ethWei: step });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

/**
 * Wait for the COMPOSE KEEPER to fire the permissionless `graduate()` on a curve
 * that has crossed the threshold — the test NEVER calls graduate() itself. Polls
 * on-chain `phase()` until Graduated, allowing a generous window for the keeper's
 * WS reaction (`GraduationReady` → graduate() within ~1-2 blocks) PLUS its DB-poll
 * fallback interval (`KEEPER_POLL_MS`, default 15s). Returns the single-fire
 * `Graduated` event (its args carry the LP `tokenId`, `caller`, `callerReward`,
 * `wethDustToTreasury`). Throws — with the last observed phase — if the keeper
 * never graduates (pre-F-1-fix, a large donation would brick it here: the keeper
 * hits its persistent-revert cooldown and the curve stays `ReadyToGraduate`).
 */
export async function waitForKeeperGraduation(
  curve: Address,
  token: Address,
  opts: { timeoutMs?: number } = {},
): Promise<GraduatedLog> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const deadline = Date.now() + timeoutMs;
  let phase: CurvePhase = "unknown";
  while (Date.now() < deadline) {
    phase = await readCurvePhase(curve);
    if (phase === "graduated") {
      const ev = await readGraduatedEvent(token);
      if (ev) return ev;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    `[e2e] compose keeper did not graduate ${curve} within ${timeoutMs}ms (last phase=${phase}). ` +
      `Check the keeper container (/healthz) + its GraduationReady watch; a persistent revert ` +
      `here is the F-1 donation-brick signature.`,
  );
}
