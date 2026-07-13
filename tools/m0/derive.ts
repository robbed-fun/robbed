/**
 * derive.ts — ROBBED_ Milestone 0 parameter notebook (spec §11.0).
 *
 * Derives every deploy-time curve constant (spec §6.2 math, §6.4 targets),
 * the V3 graduation price/tick in both token orderings (§6.3), LP tranche
 * sizing, and fee / anti-sniper proposals; validates with randomized
 * round-trip simulations; emits:
 *   out/constants.json    — canonical artifact (schema: docs/developers/contracts.md §4)
 *   out/Constants.sol.txt — generated Solidity rendering (never hand-edited)
 *   out/constants.ts      — generated TS rendering for apps/web / packages/shared
 *   out/plots/*.svg + out/plots/checkpoints.md
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ STATUS: final tick + constants remain OPEN ITEM (spec §13) until this  │
 * │ output is reviewed and gate-approved by hoodpad-architect.             │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Hard rule (§2): ETH/USD is fetched LIVE at run time with source + timestamp
 * provenance. There is NO baked-in fallback price — fetch failure exits 1.
 *
 * Usage: bun run derive [--source=coingecko|defillama] [--reuse-snapshot]
 *                       [--network=mainnet|testnet]   (or M0_NETWORK env)
 *   Graduation-target env overrides (network-scoped, fail-closed cross-network):
 *     M0_MAINNET_GRADUATION_ETH=<decimal ETH>  — mainnet only; overrides the flat 5.7-ETH default.
 *     M0_TESTNET_GRADUATION_ETH=<decimal ETH>  — testnet only; faucet-scale small-G rescale.
 *   --reuse-snapshot re-derives from the ETH/USD snapshot already recorded in
 *   out/constants.json (recompute-only mode; provenance is preserved).
 *   --network=testnet (Phase T-1) emits out/constants.testnet.json — same schema,
 *   same validations, chainId 46630, with external.* taken from the checked-in
 *   fixture external.testnet.json (spec §12.52 ratified set; derive FAILS CLOSED
 *   naming that fixture while any of its values is null). Testnet mode emits ONLY
 *   the JSON: the Sol/TS renderings + plots stay mainnet-canonical (a testnet run
 *   must never overwrite them with a different live snapshot). Recommended:
 *   `--network=testnet --reuse-snapshot` so testnet economics match the reviewed
 *   mainnet constants exactly (ETH/USD is chain-agnostic; only chainId + external
 *   differ).
 *
 * ── TESTNET-ONLY graduation-target override ─────────────────────────────────
 *   M0_TESTNET_GRADUATION_ETH=<decimal ETH, e.g. 0.005>  (env var; testnet mode only)
 *   Re-derives the FULL self-consistent constant set around a small, faucet-testable
 *   graduation target instead of the $69k-mcap-derived one: the solver keeps the
 *   §6.4 supply split (793.1M curve / 206.9M LP tranche) and inverts constraint (c)
 *   `G = p·L + F + R` to pick the graduation price, so virtual reserves, the
 *   pre-created V3 pool price/ticks, LP amounts, the anti-sniper cap (2.5% of G),
 *   the beta caps (1.5×G / 50×G) and the organic floor all stay consistent at the
 *   new G. Fee policy under the override (small-G rescale, review-required):
 *     callerReward   = 10% of target G      (maxCallerReward = 2× → 20% of G)
 *     graduationFee  = min(cost-based §12.26, 10% of G)
 *                                            (maxGraduationFee = min(10×, 20% of G))
 *     ⇒ maxCallerReward + maxGraduationFee ≤ 40% of G — Deploy.s.sol's
 *       GraduationUnfundable guard passes with ≥60% margin (checked below).
 *     §12.34 caller-reward gas floor is relaxed 10× → 1.5× (still strictly
 *     profitable to call graduate(); the 10× margin is a MAINNET liveness knob).
 *   creationFee is independent of G and is NOT rescaled. FAILS CLOSED if the env
 *   var is set while deriving mainnet (--network=mainnet or default): the override
 *   must never be able to influence the reviewed mainnet economics.
 *
 * ── MAINNET flat graduation target (approved change 2026-07-13; retargeted 5.7 ETH 2026-07-13) ──────
 *   Mainnet G is now a FLAT net-of-fee ETH raise (§12.11): DEFAULT 5.7 ETH (MAINNET_GRADUATION_ETH;
 *   matches RobinFun's ~5.74 ETH / ~$44k graduation bar), env-overridable via M0_MAINNET_GRADUATION_ETH=<decimal ETH>.
 *   Same MECHANISM as the testnet override — invert constraint (c) `G = p·L + F + R` around the target —
 *   but the MAINNET fee policy is UNCHANGED (USD-sized ~$5 caller reward, cost-based §12.26 graduation fee,
 *   10× gas floor): at 5.7 ETH those fees are ≪ G, so NO faucet-scale %-of-G rescale and NO gas-floor
 *   relaxation apply.
 *   The `smallGOverride` flag (TRUE only for the testnet faucet path) gates every rescale; the mainnet
 *   flat-G path shares ONLY the constraint-(c) inversion. FAILS CLOSED if M0_MAINNET_GRADUATION_ETH is
 *   set under --network=testnet (and M0_TESTNET_GRADUATION_ETH under mainnet).
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  solveCurveConstants,
  simulateFullCurve,
  sampleCurve,
  type CurveTargets,
  type CurveConstants,
  type SimResult,
} from "./lib/curve.ts";
import {
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
  nearestUsableTick,
  minUsableTick,
  maxUsableTick,
  sqrtPriceX96FromPrice,
  fullRangeMint,
  Q96,
  Q192,
  MIN_TICK,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MAX_SQRT_RATIO,
} from "./lib/v3tick.ts";
import { linePlotSvg, markdownTable } from "./lib/plot.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Spec constants (§6.4 economics targets — these are SPEC TARGETS, not market
// data; every market-dependent number below is computed from the live fetch).
// ─────────────────────────────────────────────────────────────────────────────
const MAINNET_CHAIN_ID = 4663;
// Official Robinhood Chain TESTNET id (spec §12.49/§12.52; docs.robinhood.com/chain/connecting —
// beware: some third-party lists print 46646; the official docs say 46630). Selected via
// --network=testnet; the deploy script keys its TESTNET mode on the same id.
const TESTNET_CHAIN_ID = 46630;
const E18 = 10n ** 18n;
const TOTAL_SUPPLY = 1_000_000_000n * E18; // §6.4: fixed 1B
const CURVE_SUPPLY = 793_100_000n * E18; // §6.4: ~793.1M (79.31%), pump.fun ratio
const LP_TOKEN_TRANCHE = 206_900_000n * E18; // §6.4: ~206.9M (20.69%)
const GRAD_MCAP_USD = 69_000n; // LEGACY $69k-mcap parity target — retained for provenance ONLY. The
// mainnet graduation target is now a FLAT ETH raise (MAINNET_GRADUATION_ETH below), not mcap-derived;
// this constant only still drives the (vestigial) testnet-without-override mcap fallback path.
// ── MAINNET graduation target (approved product change 2026-07-13; retargeted 5.7 ETH 2026-07-13) ──
// A FLAT net-of-fee ETH raise (§12.11), DEFAULT 5.7 ETH (matches RobinFun's ~5.74 ETH / ~$44k bar),
// replacing the earlier flat 2.5-ETH default (itself replacing the retired $69k-mcap derivation,
// ~7.9166 ETH). Env-overridable via M0_MAINNET_GRADUATION_ETH (mirrors the testnet
// M0_TESTNET_GRADUATION_ETH mechanism): the solver INVERTS constraint (c) `G = p·L + F + R` around
// this target while keeping the §6.4 supply split (793.1M curve / 206.9M LP tranche). Unlike the
// testnet faucet-scale override, the MAINNET fee policy is UNCHANGED (USD-sized ~$5 caller reward +
// cost-based §12.26 graduation fee, 10× gas floor) — 5.7 ETH funds those fees with ≳300× headroom vs
// the GraduationUnfundable ceiling, so NO faucet-scale %-of-G rescale is applied.
const MAINNET_GRADUATION_ETH = 5_700_000_000_000_000_000n; // 5.7 ETH (net-of-fee real reserves, §12.11; RobinFun ~5.74 ETH / ~$44k bar)
const TRADE_FEE_BPS = 100n; // §6.4: 1% ETH leg, both directions
const MAX_TRADE_FEE_BPS = 200; // §6.4: hard cap ≤2% (structural, hardcoded in factory)
// §7 / §12.63: creator-fee leg. MAINNET = 50 bps (approved 2026-07-13: 0.5% creator leg; treasury 100
// + creator 50 = 150 ≤ the 200/2% additive cap, asserted in run() AND in the factory constructor).
// TESTNET = the architect-ratified §12.63 value 50 (identical split) so Phase-T exercises the creator
// leg end-to-end. Selected per-network in run(); NEVER inlined into curve logic (read from constants).
const CREATOR_FEE_BPS_MAINNET = 50;
const CREATOR_FEE_BPS_TESTNET = 50; // §12.63 (treasury 100 + creator 50 = 150)
const V3_FEE_TIER = 10_000; // §12.1: 1% tier
const V3_TICK_SPACING = 200; // 1% tier spacing

// §6.4: creation fee ~$1–2 equivalent → take the midpoint as the target.
const CREATION_FEE_USD_TENTHS = 15n; // $1.50, expressed in tenths of USD
// O-9 (§12.34): graduation caller reward sized in USD terms (~$5). M1 RE-VALIDATION
// (2026-07-12) DONE — the ≥10×-graduate()-gas floor is now checked against the
// FORK-MEASURED graduate() gas × live gas price (see the §12.34 `check` below);
// passes with margin at current gas. Retunable within [0, maxCallerReward] in beta.
const CALLER_REWARD_USD = 5n;
// ── Graduation fee: small flat, COST-BASED (spec §12.26 / decision 26) ───────
// Ratified: the graduation fee is a *small flat* fee sized to ≈ the V3-migration
// gas cost + a thin margin — explicitly NOT a %-of-raise, and NEVER a hardcoded
// USD figure. M0 carries it as a transparent gas formula whose inputs are
// clearly-labeled PLACEHOLDERS; the exact number is finalized at M1 against real
// `graduate()` gas on testnet (contracts.md §4, §6.4).
//
//   graduationFeeWei = migrationGasEstimate × gasPriceWei × (marginNum / marginDen)
//
// migrationGasEstimate — full graduate() path: flat grad-fee transfer, slot0
// read, bounded arb-back swap loop (≤ MAX_ARB_ITERATIONS), full-range V3 mint via
// the NonfungiblePositionManager, LP-NFT transfer to the vault, and dust handling.
//
// M1 RE-VALIDATION (2026-07-12) — MEASURED on a mainnet-fork of chain 4663 at the
// LATEST block through the REAL §12.28 V3 factory/NPM (contracts/test/fork/
// Lifecycle.t.sol `test_fork_lifecycleGas` / `test_fork_fullLifecycle`):
//   graduate()+V3 migration = 814_729 gas (CLEAN, pool at target, no arb-back)
//                             817_845 gas (WITH arb-back, polluted pool).
// The placeholder was 3_000_000 (unfounded). MIGRATION_GAS_ESTIMATE is now grounded
// in that measurement and rounded UP to a conservative bound that covers the full
// MAX_ARB_ITERATIONS=8 arb-back loop under heavier griefing (each bounded arb swap
// ≈ 50–130k gas): 1_500_000 ≈ 1.83× the measured worst case. Still a placeholder-
// class knob per §12.26 (finalized at deploy against live gas), now measurement-based.
const MEASURED_GRADUATE_GAS = 817_845n; // fork-measured worst case (arb-back), 2026-07-12
const MIGRATION_GAS_ESTIMATE = 1_500_000n; // conservative fee basis; covers full arb-back
// gasPriceWei — chain-4663 (Orbit L2) gas price. Fetched LIVE from
// ROBINHOOD_RPC_URL when set (provenance recorded); otherwise this labeled
// placeholder is used. Unlike ETH/USD (§2 hard-fail, no fallback), a placeholder
// IS permitted here because §12.26 explicitly defers the exact figure to M1.
const GAS_PRICE_WEI_PLACEHOLDER = 100_000_000n; // 0.1 gwei — M0 PLACEHOLDER
// marginNum/marginDen — thin margin over raw gas cost (gas-price variance / L1
// data-fee spikes). 3/2 = 1.5×. M0 PLACEHOLDER, tuned at M1.
const GRAD_FEE_MARGIN_NUM = 3n;
const GRAD_FEE_MARGIN_DEN = 2n;
// PROPOSAL (O-7, review-required): anti-sniper window 8s (§12.18 timestamp
// mechanism; §6.5 suggests 5–10s ≈ 80 blocks at ~100ms) and per-tx early cap
// of 2.5% of GRADUATION_ETH — bounds a single-tx sweep to a small slice of the
// curve while not blocking ordinary early buys; multi-wallet bypass is a
// documented limitation, not a claimed guarantee.
const EARLY_WINDOW_SECONDS = 8;
const MAX_EARLY_BUY_BPS_OF_G = 250n;
// PROPOSALS (O-8, review-required): arb-back parameters. toleranceTicks = half
// a tick spacing (pool must land within ±100 ticks ≈ ±1% of target price);
// bounded loop of 8 swaps; 1% mint slippage.
const TOLERANCE_TICKS = 100;
const MAX_ARB_ITERATIONS = 8;
const MIGRATION_SLIPPAGE_BPS = 100;
// PLACEHOLDERS (O-10, gate 7): beta caps — testnet placeholders only; mainnet
// numbers set with hoodpad-security before beta deploy.
const PER_TOKEN_CAP_X_G = { num: 3n, den: 2n }; // 1.5 × GRADUATION_ETH
const GLOBAL_CAP_X_G = 50n;

// ── M0-4 (spec §2.2/§8.5/§10/§14): governance / monitoring thresholds ────────
// These are OFF-CHAIN governance + monitoring inputs — they are NOT deployed
// contract constants (the §8.5 heuristics are advisory and never gate chain
// state, §8.4/§8.5; the Gate G-A.1 floor is a human go/no-go input, §14). They
// therefore land in constants.json + the TS rendering (indexer / dashboard
// consumers) but NOT in Constants.sol.txt.
//
// (a) Organic-volume floor for Gate G-A.1 (§14): the market-collapse threshold
// below which a mainnet launch is a no-go. Hard rule (§2): NO headline / chain-
// wide / Dune volume figure is baked in. The floor is expressed SELF-REFERENTIALLY
// as a multiple of the curve's own GRADUATION_ETH constant, and is compared
// against the OWN INDEXER's organic-volume estimate (§8.5), never a headline
// metric. Chosen basis: N graduations-equivalent of genuinely-organic curve
// volume per rolling window. Default N = 5 / 7 days = "if fewer than ~5
// graduations' worth of organic curve flow happens in a week, the niche has
// effectively collapsed for our purposes." The magnitude of N is a genuine
// product/policy call (what counts as "not collapsed") → labeled M0 default,
// hoodpad-architect ratifies before Gate G-A.
const ORGANIC_FLOOR_GRADUATIONS_EQUIV = 5n; // N — M0 DEFAULT (architect ratifies §14)
const ORGANIC_FLOOR_WINDOW_DAYS = 7; // rolling window for the organic-volume estimate
// §2.2 binding assumption: assume ≤50% of headline DEX volume is organic until
// own-indexer data says otherwise. The floor is evaluated against the indexer's
// organic estimate directly; this cap governs the headline→organic conversion
// when only headline data is available and is recorded so the assumption is
// explicit and reviewable.
const ORGANIC_FLOW_DISCOUNT_MAX_PCT = 50;
//
// (b) Funding-cluster alert thresholds (gate 7, §10 amend / §8.5): alert (never
// gate — §8.4/§8.5 advisory-only) when a single §8.5 funder cluster dominates
// volume. X = % of one token's curve volume; Y = % of platform-wide curve
// volume, both over a trailing window. Early-warning for metric distortion +
// coordinated dumps. Defaults are tunable engineering values; final tuning is
// with hoodpad-security before beta (gate 7). Y < X by design: a single cluster
// at 10% of ALL platform flow is a rarer, louder signal than 25% of one token.
const CLUSTER_ALERT_PER_TOKEN_PCT = 25; // X — M0 default
const CLUSTER_ALERT_PLATFORM_PCT = 10; // Y — M0 default
const CLUSTER_ALERT_WINDOW_HOURS = 24; // matches §5.2 trailing-24h flow-quality metric

const OUT_DIR = join(import.meta.dir, "out");
const PLOTS_DIR = join(OUT_DIR, "plots");
const SIM_SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const bmin = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/**
 * Exact decimal-ETH → wei parser for a graduation-target override (no floats — `0.005` must land on
 * exactly 5_000_000_000_000_000 wei, `2.5` on exactly 2_500_000_000_000_000_000). Fail-closed on
 * anything that is not a plain decimal, and on out-of-band magnitudes (a fat-fingered target would
 * silently produce a degenerate fee set otherwise). `envName` names the offending env var in the
 * error so the mainnet (M0_MAINNET_GRADUATION_ETH) and testnet (M0_TESTNET_GRADUATION_ETH) paths
 * report against the right knob.
 */
function parseGradOverrideEthToWei(raw: string, envName: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(raw.trim());
  if (!m) {
    console.error(`FATAL: ${envName}="${raw}" is not a plain decimal ETH amount (e.g. 0.005 or 2.5).`);
    process.exit(1);
  }
  const wei = BigInt(m[1]!) * E18 + BigInt((m[2] ?? "0").padEnd(18, "0"));
  const MIN_WEI = 10n ** 15n; // 0.001 ETH — below this the fee/reward set degenerates to dust
  const MAX_WEI = 100n * E18; // sanity ceiling: a graduation target beyond 100 ETH is a typo, not a plan
  if (wei < MIN_WEI || wei > MAX_WEI) {
    console.error(`FATAL: ${envName}=${raw} is outside the sane band [0.001, 100] ETH — refusing.`);
    process.exit(1);
  }
  return wei;
}

const eth = (wei: bigint, dp = 6): string => {
  const neg = wei < 0n;
  const w = neg ? -wei : wei;
  const int = w / E18;
  const frac = (w % E18).toString().padStart(18, "0").slice(0, dp);
  return `${neg ? "-" : ""}${int}.${frac}`;
};
const tokensM = (wei: bigint): string => `${(Number(wei / 10n ** 12n) / 1e12).toFixed(4)}M`.replace("M", "e6");
const roundWei = (wei: bigint, unit = 10n ** 12n): bigint => ((wei + unit / 2n) / unit) * unit;
const ethFloat = (wei: bigint): number => Number(wei / 10n ** 6n) / 1e12;

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

function gitSha(): string {
  try {
    const p = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: import.meta.dir });
    const out = p.stdout.toString().trim();
    return p.exitCode === 0 && out ? out : "no-commit-yet";
  } catch {
    return "no-commit-yet";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Live ETH/USD (hard rule §2: live query, provenance recorded, no fallback)
// ─────────────────────────────────────────────────────────────────────────────
interface EthUsdSnapshot {
  source: string; // human-readable source name + endpoint
  endpoint: string;
  timestamp: string; // ISO8601 fetch time
  value: string; // informational only, never deployed
}

async function fetchEthUsd(source: string): Promise<{ snap: EthUsdSnapshot; ethUsdE8: bigint }> {
  const fetchedAt = new Date().toISOString();
  let endpoint: string;
  let price: number;

  if (source === "defillama") {
    endpoint = "https://coins.llama.fi/prices/current/coingecko:ethereum";
    const res = await fetch(endpoint, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`DefiLlama HTTP ${res.status}`);
    const j = (await res.json()) as { coins?: Record<string, { price?: number }> };
    price = j.coins?.["coingecko:ethereum"]?.price ?? NaN;
  } else if (source === "coingecko") {
    endpoint = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&precision=8";
    const res = await fetch(endpoint, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const j = (await res.json()) as { ethereum?: { usd?: number } };
    price = j.ethereum?.usd ?? NaN;
  } else {
    throw new Error(`unknown --source=${source} (coingecko|defillama)`);
  }

  if (!Number.isFinite(price) || price < 100 || price > 1_000_000)
    throw new Error(`fetched ETH/USD looks invalid: ${price}`);

  return {
    snap: { source: `${source} (${endpoint})`, endpoint, timestamp: fetchedAt, value: price.toString() },
    ethUsdE8: BigInt(Math.round(price * 1e8)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gas price for the cost-based graduation fee (§12.26). Live from the chain when
// ROBINHOOD_RPC_URL is set; otherwise a clearly-labeled M0 placeholder (the exact
// figure is finalized at M1 vs real testnet gas, so a placeholder is by design).
// ─────────────────────────────────────────────────────────────────────────────
interface GasPriceSnapshot {
  basis: "live" | "placeholder";
  source: string;
  timestamp: string;
  gasPriceWei: string;
}

async function fetchGasPriceWei(): Promise<GasPriceSnapshot> {
  const rpc = process.env.ROBINHOOD_RPC_URL;
  const now = new Date().toISOString();
  if (!rpc) {
    return {
      basis: "placeholder",
      source: "ROBINHOOD_RPC_URL unset — M0 placeholder (finalize at M1 vs real testnet gas)",
      timestamp: now,
      gasPriceWei: GAS_PRICE_WEI_PLACEHOLDER.toString(),
    };
  }
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { result?: string };
    if (!j.result) throw new Error("no result in eth_gasPrice response");
    const wei = BigInt(j.result);
    if (wei <= 0n) throw new Error(`non-positive gasPrice ${wei}`);
    return { basis: "live", source: "eth_gasPrice @ ROBINHOOD_RPC_URL (chain 4663)", timestamp: now, gasPriceWei: wei.toString() };
  } catch (e) {
    console.warn(`  gas price: live fetch failed (${(e as Error).message}); using M0 placeholder.`);
    return {
      basis: "placeholder",
      source: `live eth_gasPrice failed (${(e as Error).message}) — M0 placeholder`,
      timestamp: now,
      gasPriceWei: GAS_PRICE_WEI_PLACEHOLDER.toString(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// External addresses per network (canonical/ratified, NEVER invented — §2).
// MAINNET (4663): the §12.28-confirmed set, inline here as before (this is the
// canonical, architect-reviewed record). TESTNET (46630): read from the checked-in
// fixture external.testnet.json (spec §12.52 ratified set) — fail-closed while any
// value is null, so "fill the fixture, re-run derive" is the entire T-1 step.
// ─────────────────────────────────────────────────────────────────────────────
interface ExternalAddresses {
  weth: string;
  v3Factory: string;
  positionManager: string;
  swapRouter02: string;
  quoterV2: string;
  treasurySafe: string;
}
const EXTERNAL_KEYS = [
  "weth",
  "v3Factory",
  "positionManager",
  "swapRouter02",
  "quoterV2",
  "treasurySafe",
] as const;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const MAINNET_EXTERNAL: ExternalAddresses = {
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  swapRouter02: "0xcaf681a66d020601342297493863e78c959e5cb2",
  quoterV2: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  treasurySafe: "0x0000000000000000000000000000000000000000",
};

const TESTNET_FIXTURE = join(import.meta.dir, "external.testnet.json");

/**
 * Load + validate the testnet external set from the fixture. FAIL-CLOSED design
 * (Phase-T requirement): any missing file, null value, or malformed address exits 1
 * with an error naming the fixture — constants.testnet.json simply cannot exist
 * until the ratified addresses are present. treasurySafe MAY be the explicit zero
 * address (same convention as the mainnet canonical constants.json: zero on purpose
 * until the T-2 dev-signer Safe exists; Deploy.s.sol then fails closed with
 * TreasurySafeUnset). All other keys must be real non-zero addresses.
 */
function loadTestnetExternal(): ExternalAddresses {
  if (!existsSync(TESTNET_FIXTURE)) {
    console.error(`FATAL: testnet external fixture not found: ${TESTNET_FIXTURE}`);
    console.error("Author it with the ratified 46630 addresses (spec §12.52), then re-run.");
    process.exit(1);
  }
  const j = JSON.parse(readFileSync(TESTNET_FIXTURE, "utf8")) as {
    external?: Record<string, string | null>;
    status?: string;
  };
  const ext = j.external ?? {};
  const nulls = EXTERNAL_KEYS.filter((k) => ext[k] == null);
  if (nulls.length > 0) {
    console.error(
      `FATAL: ${TESTNET_FIXTURE} still contains null externals: ${nulls.join(", ")} — ` +
        "PENDING Phase-T inventory. Fill them with the ratified 46630 addresses " +
        "(spec §12.52; never invented), then re-run: bun run derive --network=testnet --reuse-snapshot",
    );
    if (j.status) console.error(`fixture status: ${j.status}`);
    process.exit(1);
  }
  for (const k of EXTERNAL_KEYS) {
    const v = ext[k]!;
    if (!ADDRESS_RE.test(v)) {
      console.error(`FATAL: ${TESTNET_FIXTURE}: external.${k} is not a valid address: ${v}`);
      process.exit(1);
    }
    if (k !== "treasurySafe" && v === ZERO_ADDRESS) {
      console.error(`FATAL: ${TESTNET_FIXTURE}: external.${k} is the zero address (only treasurySafe may be).`);
      process.exit(1);
    }
  }
  return {
    weth: ext.weth!,
    v3Factory: ext.v3Factory!,
    positionManager: ext.positionManager!,
    swapRouter02: ext.swapRouter02!,
    quoterV2: ext.quoterV2!,
    treasurySafe: ext.treasurySafe!,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = new Map<string, string>(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k ?? a, v ?? "true"] as [string, string];
    }),
  );

  // ── network selection (Phase T-1): mainnet (default) or testnet ───────────
  const network = (args.get("network") ?? process.env.M0_NETWORK ?? "mainnet").toLowerCase();
  if (network !== "mainnet" && network !== "testnet") {
    console.error(`FATAL: unknown --network=${network} (mainnet|testnet)`);
    process.exit(1);
  }
  const isTestnet = network === "testnet";
  const chainId = isTestnet ? TESTNET_CHAIN_ID : MAINNET_CHAIN_ID;
  // §12.63 creator-fee leg: 50 bps on mainnet (approved 2026-07-13) AND testnet (ratified). Both
  // satisfy the additive ≤2% cap (treasury 100 + creator 50 = 150 ≤ 200); asserted below AND in the
  // factory constructor.
  const creatorFeeBps = isTestnet ? CREATOR_FEE_BPS_TESTNET : CREATOR_FEE_BPS_MAINNET;
  if (Number(TRADE_FEE_BPS) + creatorFeeBps > MAX_TRADE_FEE_BPS) {
    console.error(
      `FATAL: tradeFeeBps ${TRADE_FEE_BPS} + creatorFeeBps ${creatorFeeBps} > ${MAX_TRADE_FEE_BPS} bps additive cap ` +
        "(§6.4/§7/§12.63). Refusing to emit a constant set the factory constructor would reject.",
    );
    process.exit(1);
  }
  // Resolve externals FIRST (fail-closed on a pending fixture before any network fetch).
  const external: ExternalAddresses = isTestnet ? loadTestnetExternal() : MAINNET_EXTERNAL;
  const outName = isTestnet ? "constants.testnet.json" : "constants.json";

  // ── graduation-target resolution (network-scoped, fail-closed cross-network) ──────────────────
  //   TESTNET: M0_TESTNET_GRADUATION_ETH override → faucet-scale small-G rescale (smallGOverride).
  //   MAINNET: a FLAT ETH target — DEFAULT MAINNET_GRADUATION_ETH (5.7 ETH), env-overridable via
  //     M0_MAINNET_GRADUATION_ETH; the MAINNET fee policy is kept (no rescale). Each override env is
  //     FORBIDDEN in the other mode: merely being PRESENT aborts the run, so neither knob can leak
  //     across networks or influence the reviewed economics by accident.
  const testnetOverrideRaw = process.env.M0_TESTNET_GRADUATION_ETH;
  const mainnetOverrideRaw = process.env.M0_MAINNET_GRADUATION_ETH;
  if (testnetOverrideRaw != null && testnetOverrideRaw !== "" && !isTestnet) {
    console.error(
      `FATAL: M0_TESTNET_GRADUATION_ETH=${testnetOverrideRaw} is set while --network=${network}. ` +
        "The testnet faucet-scale override is TESTNET-ONLY; unset it before deriving mainnet constants.",
    );
    process.exit(1);
  }
  if (mainnetOverrideRaw != null && mainnetOverrideRaw !== "" && isTestnet) {
    console.error(
      `FATAL: M0_MAINNET_GRADUATION_ETH=${mainnetOverrideRaw} is set while --network=${network}. ` +
        "The mainnet graduation override is MAINNET-ONLY; unset it before deriving testnet constants.",
    );
    process.exit(1);
  }

  // smallGOverride = the TESTNET faucet-scale fee rescale + relaxed gas floor (NEVER mainnet).
  const smallGOverride = isTestnet && testnetOverrideRaw != null && testnetOverrideRaw !== "";
  // gradTargetWei = the flat net-of-fee graduation target that INVERTS solver constraint (c). Present
  // for the testnet override AND every mainnet run (mainnet is now flat-G by default). `null` only on
  // a testnet run WITHOUT the override (legacy $69k-mcap fallback, unused in practice — kept for the
  // reuse-snapshot compat path).
  let gradTargetWei: bigint | null;
  let gradTargetSource: string;
  if (isTestnet) {
    gradTargetWei = smallGOverride ? parseGradOverrideEthToWei(testnetOverrideRaw!, "M0_TESTNET_GRADUATION_ETH") : null;
    gradTargetSource = smallGOverride ? `env M0_TESTNET_GRADUATION_ETH=${testnetOverrideRaw}` : "legacy $69k-mcap fallback";
  } else if (mainnetOverrideRaw != null && mainnetOverrideRaw !== "") {
    gradTargetWei = parseGradOverrideEthToWei(mainnetOverrideRaw, "M0_MAINNET_GRADUATION_ETH");
    gradTargetSource = `env M0_MAINNET_GRADUATION_ETH=${mainnetOverrideRaw}`;
  } else {
    gradTargetWei = MAINNET_GRADUATION_ETH;
    gradTargetSource = `default MAINNET_GRADUATION_ETH=${eth(MAINNET_GRADUATION_ETH)} ETH`;
  }

  console.log(`ROBBED_ M0 parameter notebook — deriving deploy constants (network=${network}, chainId=${chainId})`);
  if (smallGOverride) {
    console.log(
      `TESTNET FAUCET OVERRIDE ACTIVE: ${gradTargetSource} → target G = ${gradTargetWei} wei ` +
        `(${eth(gradTargetWei!)} ETH); full constant set re-derived around it, small-G fee rescale (header doc).`,
    );
  } else if (!isTestnet) {
    console.log(
      `MAINNET FLAT-G TARGET: ${gradTargetSource} → target G = ${gradTargetWei} wei (${eth(gradTargetWei!)} ETH ` +
        "net-of-fee, §12.11); full constant set re-solved around it, MAINNET fee policy unchanged.",
    );
  }
  console.log("NOTE: final tick/constants are OPEN ITEM (spec §13) until reviewed.\n");

  // ── ETH/USD provenance ────────────────────────────────────────────────────
  let snap: EthUsdSnapshot;
  let ethUsdE8: bigint;
  if (args.get("reuse-snapshot") === "true") {
    // Always reuses the CANONICAL mainnet artifact's snapshot (ETH/USD is chain-agnostic):
    // for --network=testnet this makes the testnet economics byte-equal to the reviewed
    // mainnet constants — only chainId + external differ.
    const prev = join(OUT_DIR, "constants.json");
    if (!existsSync(prev)) {
      console.error("--reuse-snapshot requested but out/constants.json does not exist. Exiting 1.");
      process.exit(1);
    }
    const j = JSON.parse(readFileSync(prev, "utf8")) as { ethUsdSnapshot: EthUsdSnapshot };
    snap = j.ethUsdSnapshot;
    ethUsdE8 = BigInt(Math.round(Number(snap.value) * 1e8));
    console.log(`ETH/USD (REUSED SNAPSHOT): $${snap.value}  source=${snap.source}  at=${snap.timestamp}\n`);
  } else {
    const source = args.get("source") ?? "coingecko";
    try {
      ({ snap, ethUsdE8 } = await fetchEthUsd(source));
    } catch (e) {
      // Hard fail — never a baked-in price (§2 / m0-notebook non-negotiable).
      console.error(`FATAL: live ETH/USD fetch failed (${(e as Error).message}).`);
      console.error("No fallback price exists by design. Retry, or pass --source=defillama.");
      process.exit(1);
    }
    console.log(`ETH/USD (LIVE): $${snap.value}  source=${snap.source}  fetchedAt=${snap.timestamp}\n`);
  }

  const E8 = 10n ** 8n;
  const usdToWei = (usdE0: bigint): bigint => (usdE0 * E18 * E8) / ethUsdE8;
  const weiToUsd = (wei: bigint): number => Number((wei * ethUsdE8) / E8 / 10n ** 12n) / 1e6;

  // ── TickMath port checksum (constants verified against Uniswap v3-core) ──
  console.log("TickMath port verification:");
  check("tickmath.tick0", getSqrtRatioAtTick(0) === Q96, "getSqrtRatioAtTick(0) == 2^96");
  check("tickmath.minSqrtRatio", getSqrtRatioAtTick(MIN_TICK) === MIN_SQRT_RATIO, `tick ${MIN_TICK} == MIN_SQRT_RATIO`);
  check("tickmath.maxSqrtRatio", getSqrtRatioAtTick(MAX_TICK) === MAX_SQRT_RATIO, `tick ${MAX_TICK} == MAX_SQRT_RATIO`);

  // ── 2. Fee proposals sized from the live snapshot ──────────────────────────
  //       (Moved AHEAD of the price derivation: the TESTNET small-G override
  //       inverts solver constraint (c) `G = p·L + F + R`, so the flat fee F and
  //       reward R must exist before the graduation price target is chosen. The
  //       mainnet path is unaffected by the reordering — no fee below reads ticks.)
  const creationFeeWei = roundWei((CREATION_FEE_USD_TENTHS * E18 * E8) / (10n * ethUsdE8));
  const maxCreationFeeWei = creationFeeWei * 20n; // immutable ceiling ≈ $30 equiv. (independent of G)

  // Cost-based graduation fee (§12.26): gas-derived flat wei, NOT %-of-raise,
  // NOT a hardcoded USD figure. Kept exact (no rounding) so the formula IS the
  // value. All inputs are M0 placeholders (gasPrice live when RPC set).
  const gas = await fetchGasPriceWei();
  const gasPriceWei = BigInt(gas.gasPriceWei);
  const costBasedGraduationFeeWei = (MIGRATION_GAS_ESTIMATE * gasPriceWei * GRAD_FEE_MARGIN_NUM) / GRAD_FEE_MARGIN_DEN;
  if (costBasedGraduationFeeWei <= 0n) throw new Error("cost-based graduation fee resolved to zero — check gas inputs");

  let callerRewardWei: bigint;
  let maxCallerRewardWei: bigint;
  let graduationFeeWei: bigint;
  if (smallGOverride) {
    // TESTNET small-G override policy (header doc): the mainnet USD-sized reward (~$5) and its 5×/10×
    // ceilings would dwarf a faucet-scale G and trip Deploy.s.sol's GraduationUnfundable guard
    // (`maxCallerReward + maxGraduationFee >= graduationEth` reverts). Rescale: reward = 10% of G
    // (ceiling 2× → 20% of G); fee stays cost-based but is capped at 10% of G (its ceiling —
    // min(10×, 20% of G) — is applied post-solve where maxGraduationFeeWei is defined). MAINNET
    // (including the flat-5.7-ETH target) never takes this branch: its USD-sized fees are ≪ G.
    callerRewardWei = roundWei(gradTargetWei! / 10n);
    maxCallerRewardWei = callerRewardWei * 2n;
    graduationFeeWei = bmin(costBasedGraduationFeeWei, gradTargetWei! / 10n);
  } else {
    // MAINNET fee policy (applies to the flat-G target too — reward/fee are USD/cost-sized, not
    // G-scaled, and 5.7 ETH funds them with ≳300× headroom).
    callerRewardWei = roundWei(usdToWei(CALLER_REWARD_USD));
    maxCallerRewardWei = callerRewardWei * 5n; // ceiling ≈ $25 equiv.
    graduationFeeWei = costBasedGraduationFeeWei;
  }
  console.log(
    `\nGraduation fee (COST-BASED §12.26, gas ${gas.basis}): ` +
      `${MIGRATION_GAS_ESTIMATE} gas × ${gasPriceWei} wei × ${GRAD_FEE_MARGIN_NUM}/${GRAD_FEE_MARGIN_DEN} ` +
      `= ${costBasedGraduationFeeWei} wei (${eth(costBasedGraduationFeeWei)} ETH); applied = ${graduationFeeWei} wei` +
      `${smallGOverride ? " (TESTNET override cap: ≤10% of target G)" : ""}; source=${gas.source}`,
  );

  // §12.34 M1 re-validation (O-9): the permissionless graduate() caller reward must clear a multiple
  // of the REAL graduate() gas cost so triggering graduation is always profitable (liveness of the
  // §12.12 ReadyToGraduate → Graduated transition). MAINNET floor: 10×. TESTNET small-G override:
  // relaxed to 1.5× — still strictly profitable, but compatible with the ≤50%-of-G fee-ceiling budget
  // (at faucet scale the 10× margin would force the reward toward ~16–33% of G; the 10× margin is a
  // mainnet liveness knob, re-ratified by hoodpad-architect via the override reviewRequired entry).
  // Validated against the FORK-MEASURED graduate() gas × the LIVE gas price — not the placeholder.
  // Advisory when gas is a placeholder (no live RPC), hard when live.
  const graduateGasCostWei = MEASURED_GRADUATE_GAS * gasPriceWei;
  const floorNum = smallGOverride ? 3n : 10n;
  const floorDen = smallGOverride ? 2n : 1n;
  const floorLabel = smallGOverride ? "1.5x (TESTNET small-G override)" : "10x";
  const callerRewardFloorWei = (floorNum * graduateGasCostWei) / floorDen;
  const callerRewardCoversGas = callerRewardWei >= callerRewardFloorWei;
  check(
    `callerReward >= ${floorLabel} real graduate() gas (§12.34, M1)`,
    callerRewardCoversGas,
    `reward ${callerRewardWei} wei (${eth(callerRewardWei)} ETH) vs floor ${floorNum}/${floorDen} × ` +
      `${MEASURED_GRADUATE_GAS} gas × ${gasPriceWei} wei = ${callerRewardFloorWei} wei ` +
      `(${eth(callerRewardFloorWei)} ETH); gas ${gas.basis}`,
  );
  if (gas.basis === "live" && !callerRewardCoversGas) {
    throw new Error(
      `§12.34 VIOLATED at live gas: callerReward ${callerRewardWei} wei < ${floorLabel} graduate() gas cost ` +
        `${callerRewardFloorWei} wei. Raise the reward sizing or retune before deploy.`,
    );
  }

  // ── 3. Graduation price target and tick alignment ─────────────────────────
  // FLAT-G target (every mainnet run + the testnet faucet override): constraint (c)
  // `G = p·L + F + R` is INVERTED — the raw graduation price is chosen as
  // p = (G − F − R)/L so the DERIVED G lands on the requested flat target; tick
  // alignment then shifts it by ≤~1% (asserted by grad.gTracksTarget). We snap to
  // the NEAREST USABLE TICK of the 1% tier (spacing 200) and use THAT exact tick
  // price as the curve's terminal price, so curve terminal price == pool init price
  // == tick-aligned (contracts.md §4) and the LP mint is zero-dust by construction.
  // LEGACY mcap fallback (testnet-without-override only): raw target spot =
  // (69000/ethUsd) ETH / 1e9 tokens — the old $69k-mcap derivation, kept solely for
  // the reuse-snapshot compat path; the mainnet default no longer uses it.
  let gradMcapRawWei: bigint;
  if (gradTargetWei !== null) {
    const ethToLpTarget = gradTargetWei - graduationFeeWei - callerRewardWei;
    if (ethToLpTarget <= 0n) {
      console.error("FATAL: graduation target is smaller than graduationFee + callerReward.");
      process.exit(1);
    }
    gradMcapRawWei = (ethToLpTarget * TOTAL_SUPPLY) / LP_TOKEN_TRANCHE;
  } else {
    gradMcapRawWei = (GRAD_MCAP_USD * E18 * E8) / ethUsdE8; // legacy $69k in ETH-wei
  }
  // Ordering A = launch token is token0 (token address < WETH): price = WETH/token.
  const sqrtRawA = sqrtPriceX96FromPrice(gradMcapRawWei, TOTAL_SUPPLY);
  const rawTickA = getTickAtSqrtRatio(sqrtRawA);
  const tickA = nearestUsableTick(sqrtRawA, V3_TICK_SPACING);
  const sqrtA = getSqrtRatioAtTick(tickA);
  // Ordering B = launch token is token1 (WETH is token0): price = token/WETH = 1/p.
  const tickB = -tickA;
  const sqrtB = getSqrtRatioAtTick(tickB);

  // Canonical graduation spot price ratio (exact tick-A price): p = sqrtA²/2^192.
  const priceNum = sqrtA * sqrtA;
  const priceDen = Q192;
  const gradMcapWei = (priceNum * TOTAL_SUPPLY) / priceDen;
  const gradMcapUsd = weiToUsd(gradMcapWei);

  // Target label: flat-G targets report the requested ETH raise; the legacy fallback reports $69k mcap.
  const gradTargetLabel =
    gradTargetWei !== null ? `target ${eth(gradTargetWei)} ETH flat raise (§12.11)` : `target $${GRAD_MCAP_USD} mcap`;
  console.log("\nGraduation price / tick (1% tier, spacing 200):");
  console.log(`  raw target-price tick (token0=token): ${rawTickA}`);
  console.log(`  aligned target tick token0=token:     ${tickA}   sqrtPriceX96 ${sqrtA}`);
  console.log(`  aligned target tick token0=WETH:      ${tickB}   sqrtPriceX96 ${sqrtB}`);
  console.log(`  tick-aligned graduation mcap:         ${eth(gradMcapWei, 4)} ETH ≈ $${gradMcapUsd.toFixed(2)} (${gradTargetLabel})`);

  // ── 4. Solve virtual reserves (§6.2 — algebra documented in lib/curve.ts) ─
  const targets: CurveTargets = {
    priceNum,
    priceDen,
    totalSupplyWei: TOTAL_SUPPLY,
    curveSupplyWei: CURVE_SUPPLY,
    lpTrancheWei: LP_TOKEN_TRANCHE,
    graduationFeeWei,
    callerRewardWei,
  };
  const c: CurveConstants = solveCurveConstants(targets);
  // Graduation-fee ceiling: 10× the applied fee; under the TESTNET small-G override it is
  // additionally capped at 20% of the target G so maxCallerReward (20% of G) + maxGraduationFee
  // (≤20% of G) ≤ 40% of G — Deploy.s.sol's GraduationUnfundable guard (`maxes >= G` reverts)
  // passes with ≥60% margin (asserted by grad.feeCeilingsFundable below). MAINNET (incl. the flat-G
  // target) keeps the plain 10× ceiling: the USD-sized fees are ≪ 5.7 ETH, so no %-of-G cap is needed.
  const maxGraduationFeeWei =
    smallGOverride ? bmin(c.graduationFeeWei * 10n, gradTargetWei! / 5n) : c.graduationFeeWei * 10n;
  const maxEarlyBuyWei = roundWei((c.graduationEthWei * MAX_EARLY_BUY_BPS_OF_G) / 10_000n);
  const perTokenEthCapWei = (c.graduationEthWei * PER_TOKEN_CAP_X_G.num) / PER_TOKEN_CAP_X_G.den;
  const globalEthCapWei = c.graduationEthWei * GLOBAL_CAP_X_G;
  // M0-4: organic-volume floor as N × GRADUATION_ETH (self-referential; §14/§8.5).
  const organicVolumeFloorWei = ORGANIC_FLOOR_GRADUATIONS_EQUIV * c.graduationEthWei;

  const initialMcapWei = (c.virtualEthWei * TOTAL_SUPPLY) / c.virtualTokenWei;
  console.log("\nDerived curve constants (all wei):");
  console.log(`  VIRTUAL_ETH_0    = ${c.virtualEthWei}  (${eth(c.virtualEthWei)} ETH)`);
  console.log(`  VIRTUAL_TOKEN_0  = ${c.virtualTokenWei}  (${tokensM(c.virtualTokenWei)} tokens)`);
  console.log(`  GRADUATION_ETH   = ${c.graduationEthWei}  (${eth(c.graduationEthWei)} ETH net-of-fee, §12.11; ≈ $${weiToUsd(c.graduationEthWei).toFixed(2)})`);
  console.log(`  GRADUATION_FEE   = ${c.graduationFeeWei}  (${eth(c.graduationFeeWei)} ETH ≈ $${weiToUsd(c.graduationFeeWei).toFixed(2)}, cost-based flat §12.26, gas ${gas.basis})`);
  console.log(`  CALLER_REWARD    = ${callerRewardWei}  (${eth(callerRewardWei)} ETH ≈ $${weiToUsd(callerRewardWei).toFixed(2)})`);
  console.log(`  ETH to LP        = ${c.ethToLpWei}  (${eth(c.ethToLpWei)} ETH = G − gradFee − callerReward)`);
  console.log(`  initial mcap     ≈ ${eth(initialMcapWei, 4)} ETH ≈ $${weiToUsd(initialMcapWei).toFixed(2)} (pump.fun-parity sanity: ~$4–6k)`);

  // Threshold semantics (flagged per m0-notebook): GRADUATION_ETH counts the
  // NET-of-trade-fee real reserves — resolved decision §12.11, restated here.
  console.log("\n  Threshold semantics: GRADUATION_ETH = NET-of-1%-fee real reserves (§12.11, resolved).");

  // ── M0-4: governance / monitoring thresholds (§2.2/§8.5/§10/§14) ───────────
  console.log("\nGovernance / monitoring thresholds (M0-4, off-chain — NOT deployed constants):");
  console.log(
    `  Gate G-A.1 organic-volume floor: ${ORGANIC_FLOOR_GRADUATIONS_EQUIV} × GRADUATION_ETH / ${ORGANIC_FLOOR_WINDOW_DAYS}d ` +
      `= ${eth(organicVolumeFloorWei)} ETH organic curve volume (own-indexer §8.5 estimate, NOT a headline metric; ≤${ORGANIC_FLOW_DISCOUNT_MAX_PCT}% organic-flow discount §2.2)`,
  );
  console.log(
    `  Gate-7 funding-cluster alert: per-token X=${CLUSTER_ALERT_PER_TOKEN_PCT}% / platform Y=${CLUSTER_ALERT_PLATFORM_PCT}% ` +
      `of curve volume over ${CLUSTER_ALERT_WINDOW_HOURS}h (advisory alert, never gates chain state §8.4/§8.5)`,
  );

  // ── 5. Validations ─────────────────────────────────────────────────────────
  console.log("\nValidation:");

  // Supply conservation (exact integers)
  check(
    "supply.conservation",
    CURVE_SUPPLY + LP_TOKEN_TRANCHE === TOTAL_SUPPLY,
    "CURVE_SUPPLY + LP_TOKEN_TRANCHE == 1e9 tokens exactly",
  );

  // Additive fee cap (§6.4/§7/§12.63): treasury leg + creator leg ≤ the 2% structural ceiling. This
  // is the SAME invariant the factory constructor enforces (`FeeAboveCap`); asserting it here keeps a
  // bad constant set from ever reaching the deploy. MAINNET now carries a non-zero creator leg (50).
  check(
    "fees.additiveCap",
    Number(TRADE_FEE_BPS) + creatorFeeBps <= MAX_TRADE_FEE_BPS,
    `tradeFeeBps ${TRADE_FEE_BPS} + creatorFeeBps ${creatorFeeBps} = ${Number(TRADE_FEE_BPS) + creatorFeeBps} ` +
      `≤ ${MAX_TRADE_FEE_BPS} bps cap`,
  );

  // Solver self-consistency: selling exactly CURVE_SUPPLY raises exactly G.
  const vTGrad = c.virtualTokenWei - CURVE_SUPPLY;
  const gImplied = c.k / vTGrad - c.virtualEthWei;
  const gErr = gImplied > c.graduationEthWei ? gImplied - c.graduationEthWei : c.graduationEthWei - gImplied;
  check(
    "curve.raiseMatchesG",
    gErr * 1_000_000_000n <= c.graduationEthWei,
    `k/(vT0−S) − vE0 = ${gImplied} vs G = ${c.graduationEthWei} (Δ ${gErr} wei)`,
  );

  // Terminal spot price == tick-aligned graduation price.
  const termCross = (c.virtualEthWei + c.graduationEthWei) * priceDen - vTGrad * priceNum;
  const termErrPpb = ((termCross < 0n ? -termCross : termCross) * 1_000_000_000n) / (vTGrad * priceNum);
  check("curve.terminalPrice", termErrPpb <= 1000n, `terminal spot vs V3 init price: ${termErrPpb} ppb error`);

  // Flat-G target self-checks (every mainnet run + the testnet faucet override): the derived G must
  // track the requested flat target (only the tick-alignment shift, ≤~1%, separates them) and the fee
  // CEILINGS must leave Deploy.s.sol's GraduationUnfundable guard (maxCallerReward + maxGraduationFee
  // >= G → revert) with ≥2× margin. At mainnet's 5.7 ETH the USD-sized ceilings clear it by ~350×.
  if (gradTargetWei !== null) {
    const maxes = maxCallerRewardWei + maxGraduationFeeWei;
    check(
      "grad.feeCeilingsFundable",
      maxes * 2n <= c.graduationEthWei,
      `maxCallerReward ${maxCallerRewardWei} + maxGraduationFee ${maxGraduationFeeWei} = ${maxes} wei ` +
        `≤ 50% of derived G ${c.graduationEthWei} wei (GraduationUnfundable clears with ≥2× margin)`,
    );
    const gDev =
      c.graduationEthWei > gradTargetWei ? c.graduationEthWei - gradTargetWei : gradTargetWei - c.graduationEthWei;
    check(
      "grad.gTracksTarget",
      gDev * 50n <= gradTargetWei,
      `derived G ${c.graduationEthWei} wei (${eth(c.graduationEthWei)} ETH) within ±2% of requested ` +
        `${gradTargetWei} wei (${eth(gradTargetWei)} ETH); Δ ${gDev} wei (tick-alignment shift)`,
    );
  }

  // Tick sanity: sqrtPriceX96 → tick → price round-trips within one spacing.
  const rtA = getTickAtSqrtRatio(sqrtA);
  const rtB = getTickAtSqrtRatio(sqrtB);
  check(
    "v3.tickRoundTrip",
    rtA === tickA && rtB === tickB && Math.abs(rawTickA - tickA) <= V3_TICK_SPACING && tickB === -tickA,
    `tick(sqrtA)=${rtA}==${tickA}, tick(sqrtB)=${rtB}==${tickB}, |raw−aligned|=${Math.abs(rawTickA - tickA)}≤${V3_TICK_SPACING}`,
  );
  check(
    "v3.usableTicks",
    tickA % V3_TICK_SPACING === 0 && tickB % V3_TICK_SPACING === 0,
    `both target ticks are multiples of tickSpacing ${V3_TICK_SPACING}`,
  );

  // LP tranche sizing / dust check, both orderings (§6.3.5: token dust → dEaD, WETH dust → treasury).
  const frLower = minUsableTick(V3_TICK_SPACING);
  const frUpper = maxUsableTick(V3_TICK_SPACING);
  const mintA = fullRangeMint(sqrtA, frLower, frUpper, LP_TOKEN_TRANCHE, c.ethToLpWei); // token0=token, token1=WETH
  const mintB = fullRangeMint(sqrtB, frLower, frUpper, c.ethToLpWei, LP_TOKEN_TRANCHE); // token0=WETH, token1=token
  const dustTokA = mintA.dust0;
  const dustWethA = mintA.dust1;
  const dustTokB = mintB.dust1;
  const dustWethB = mintB.dust0;
  const dustOkA = dustTokA * 1_000_000n <= LP_TOKEN_TRANCHE && dustWethA * 1_000_000n <= c.ethToLpWei;
  const dustOkB = dustTokB * 1_000_000n <= LP_TOKEN_TRANCHE && dustWethB * 1_000_000n <= c.ethToLpWei;
  check(
    "lp.dust.token0=token",
    dustOkA,
    `residual dust: ${eth(dustTokA, 9)} tokens (→0xdEaD) + ${eth(dustWethA, 9)} WETH (→treasury); liquidity=${mintA.liquidity}`,
  );
  check(
    "lp.dust.token0=WETH",
    dustOkB,
    `residual dust: ${eth(dustTokB, 9)} tokens (→0xdEaD) + ${eth(dustWethB, 9)} WETH (→treasury); liquidity=${mintB.liquidity}`,
  );

  // M0-4 governance / monitoring thresholds: present, positive, self-consistent.
  check(
    "governance.organicFloor",
    ORGANIC_FLOOR_GRADUATIONS_EQUIV >= 1n &&
      organicVolumeFloorWei === ORGANIC_FLOOR_GRADUATIONS_EQUIV * c.graduationEthWei &&
      organicVolumeFloorWei > 0n &&
      ORGANIC_FLOOR_WINDOW_DAYS > 0 &&
      ORGANIC_FLOW_DISCOUNT_MAX_PCT > 0 &&
      ORGANIC_FLOW_DISCOUNT_MAX_PCT <= 100,
    `floor = ${ORGANIC_FLOOR_GRADUATIONS_EQUIV}×G = ${eth(organicVolumeFloorWei)} ETH / ${ORGANIC_FLOOR_WINDOW_DAYS}d, discount ≤${ORGANIC_FLOW_DISCOUNT_MAX_PCT}% (self-referential to G, no headline metric)`,
  );
  check(
    "governance.clusterThresholds",
    CLUSTER_ALERT_PER_TOKEN_PCT > 0 &&
      CLUSTER_ALERT_PER_TOKEN_PCT <= 100 &&
      CLUSTER_ALERT_PLATFORM_PCT > 0 &&
      CLUSTER_ALERT_PLATFORM_PCT <= 100 &&
      CLUSTER_ALERT_PLATFORM_PCT <= CLUSTER_ALERT_PER_TOKEN_PCT &&
      CLUSTER_ALERT_WINDOW_HOURS > 0,
    `per-token X=${CLUSTER_ALERT_PER_TOKEN_PCT}% ≥ platform Y=${CLUSTER_ALERT_PLATFORM_PCT}% over ${CLUSTER_ALERT_WINDOW_HOURS}h, both in (0,100]`,
  );

  // Round-trip fuzz simulations (randomized buy/sell chunks until graduation).
  const sims: SimResult[] = [];
  let maxTermErr = 0n;
  let maxShortfall = 0n;
  for (const seed of SIM_SEEDS) {
    const r = simulateFullCurve(c, targets, seed, TRADE_FEE_BPS);
    sims.push(r);
    if (r.terminalPriceRelErrPpb > maxTermErr) maxTermErr = r.terminalPriceRelErrPpb;
    if (r.curveShortfallTokensWei > maxShortfall) maxShortfall = r.curveShortfallTokensWei;
  }
  const allGraduated = sims.every((r) => r.graduated && r.realEthWei === c.graduationEthWei);
  const allKOk = sims.every((r) => r.kFinal >= r.kInitial);
  check(
    "sim.graduation",
    allGraduated,
    `${sims.length}/${sims.length} fuzz runs graduated with realEth == GRADUATION_ETH exactly (final buy clamped, §12.11)`,
  );
  check("sim.kInvariant", allKOk, "k = vE·vT non-decreasing at every step of every run");
  check(
    "sim.terminalPrice",
    maxTermErr <= 1000n,
    `max terminal spot error across runs: ${maxTermErr} ppb (tolerance 1000 ppb)`,
  );
  check(
    "sim.supplyRoundTrip",
    maxShortfall <= 10n ** 15n,
    `max unsold curve rounding dust: ${maxShortfall} wei-tokens (${eth(maxShortfall, 12)} tokens; joins burn dust)`,
  );
  const stepStats = sims.map((r) => r.steps);
  console.log(
    `  fuzz detail: seeds 1..${SIM_SEEDS.length}, steps min/max ${Math.min(...stepStats)}/${Math.max(...stepStats)}, ` +
      `example gross spend to graduate ≈ ${eth(sims[0]!.grossEthInWei)} ETH (incl. 1% fees ${eth(sims[0]!.tradeFeesWei)} ETH, seed 1)`,
  );

  const failed = checks.filter((k) => !k.pass);
  if (failed.length > 0) {
    console.error(`\nFATAL: ${failed.length} validation(s) failed — not emitting constants.`);
    process.exit(1);
  }

  // ── 6. Plots + checkpoint table (MAINNET ONLY — the plots/ artifacts are the
  //       canonical M0-review renderings; a testnet run must never overwrite them
  //       with a different live snapshot. Testnet economics are identical anyway
  //       under --reuse-snapshot.) ─────────────────────────────────────────────
  if (!isTestnet) {
  mkdirSync(PLOTS_DIR, { recursive: true });
  const pts = sampleCurve(c, CURVE_SUPPLY, 200);
  const xs = pts.map((p) => Number(p.tokensSoldWei / E18) / 1e6); // millions of tokens
  const priceNano = pts.map((p) => (Number(p.priceNum) / Number(p.priceDen)) * 1e9); // nano-ETH per token
  const mcapEth = pts.map((p) => (Number(p.priceNum) / Number(p.priceDen)) * 1e9); // mcap ETH = price × 1e9 supply
  const sub = `virtualEth0=${eth(c.virtualEthWei)} ETH, virtualToken0=${tokensM(c.virtualTokenWei)} — ETH/USD $${snap.value} (${snap.source.split(" ")[0]}, ${snap.timestamp})`;
  writeFileSync(
    join(PLOTS_DIR, "price-vs-tokens-sold.svg"),
    linePlotSvg(
      { x: xs, y: priceNano },
      {
        title: "ROBBED_ curve — spot price vs tokens sold",
        subtitle: sub,
        xLabel: "tokens sold (millions)",
        yLabel: "spot price (nano-ETH per token)",
        markIndex: pts.length - 1,
        markLabel: `graduation @ ${eth(c.graduationEthWei, 3)} ETH`,
      },
    ),
  );
  writeFileSync(
    join(PLOTS_DIR, "mcap-vs-tokens-sold.svg"),
    linePlotSvg(
      { x: xs, y: mcapEth },
      {
        title: "ROBBED_ curve — market cap vs tokens sold",
        subtitle: sub,
        xLabel: "tokens sold (millions)",
        yLabel: "implied mcap (ETH)",
        markIndex: pts.length - 1,
        markLabel: `≈ $${gradMcapUsd.toFixed(0)} mcap`,
      },
    ),
  );

  const cpRows: string[][] = [];
  for (let i = 0; i <= 20; i++) {
    const p = pts[i * 10]!;
    const priceN = (Number(p.priceNum) / Number(p.priceDen)) * 1e9;
    cpRows.push([
      `${i * 5}%`,
      `${(Number(p.tokensSoldWei / E18) / 1e6).toFixed(2)}M`,
      eth(p.realEthWei, 4),
      priceN.toFixed(6),
      priceN.toFixed(4),
      `$${(priceN * Number(ethUsdE8 / 100n) / 1e6).toFixed(0)}`,
    ]);
  }
  writeFileSync(
    join(PLOTS_DIR, "checkpoints.md"),
    `# Curve checkpoints (price / mcap vs tokens sold)\n\n` +
      `ETH/USD snapshot: $${snap.value} — ${snap.source} — ${snap.timestamp} (informational; USD never deployed).\n` +
      `Graduation: ${eth(c.graduationEthWei)} ETH net reserves → mcap ${eth(gradMcapWei, 4)} ETH ≈ $${gradMcapUsd.toFixed(2)}.\n\n` +
      markdownTable(
        ["curve sold", "tokens", "real ETH raised", "price (nano-ETH/token)", "mcap (ETH)", "mcap (USD @snapshot)"],
        cpRows,
      ),
  );
  } // end !isTestnet (plots)

  // ── 7. Emit canonical constants JSON (schema: contracts.md §4) ─────────────
  const generatedAt = new Date().toISOString();
  const reviewRequired = [
    "§13 GATE: ALL constants below are open item §13 until hoodpad-architect reviews this output; gate approval closes the item.",
    "fees.graduationFeeWei: COST-BASED per §12.26 (decision 26) — a small flat fee = migrationGasEstimate × gasPriceWei × margin (see derivation.graduationFeeModel), NOT a %-of-raise and never a hardcoded USD figure. M1 RE-VALIDATION DONE (2026-07-12): migrationGasEstimate is now FORK-MEASURED (real §12.28 V3 factory/NPM, graduate()+V3 = ~817845 gas worst-case), not the old 3,000,000 placeholder. gasPrice is fetched live when ROBINHOOD_RPC_URL is set; the exact fee is still re-confirmed at deploy against live gas per §12.26.",
    "fees.callerRewardWei: O-9 (§12.34) — sized ≈$5 equivalent at snapshot. M1 RE-VALIDATION DONE (2026-07-12): asserted ≥10× the FORK-MEASURED graduate() gas × live gas price (see derivation.graduationFeeModel.callerRewardCoversGasFloor); passes with margin.",
    "fees.creatorFeeBps: §7/§12.63 creator-fee leg = 50 bps (0.5%) on BOTH mainnet and testnet (approved product change 2026-07-13). treasury 100 + creator 50 = 150 ≤ the 200/2% additive cap (asserted by fees.additiveCap here AND the factory constructor's FeeAboveCap). The on-chain fee SPLIT/routing (post-graduation LP-fee share) is a SEPARATE new-factory-version phase, being designed by a spec agent — NOT shipped in this M0 re-derivation; here the leg is only priced into the fee schedule.",
    "antiSniper.*: PROPOSAL (O-7) — 8s timestamp window (§12.18) with per-tx cap = 2.5% of GRADUATION_ETH; multi-wallet bypass documented.",
    "v3.toleranceTicks / maxArbIterations / migrationSlippageBps: PROPOSAL (O-8) — needed before gate-2 fuzz bounds are final.",
    "beta.*: PLACEHOLDER (O-10) — mainnet values set with hoodpad-security before beta deploy.",
    ...(smallGOverride
      ? [
          "TESTNET SMALL-G OVERRIDE ACTIVE (M0_TESTNET_GRADUATION_ETH): curve.*, fees.graduationFee/callerReward (+ their ceilings), antiSniper.maxEarlyBuyWei, beta.* and governance.organicVolumeFloor are re-derived around the faucet-scale graduation target — see derivation.testnetGraduationOverride for the policy. The §12.34 caller-reward gas floor is relaxed 10×→1.5× (still strictly profitable) FOR TESTNET ONLY. Derive fails closed if this env var is set in mainnet mode; the mainnet derivation path is untouched. hoodpad-architect re-ratifies the override policy before it is treated as anything but a lifecycle-testing device.",
        ]
      : []),
    ...(!isTestnet
      ? [
          "curve.graduationEthWei: MAINNET FLAT graduation target (approved product change 2026-07-13; retargeted 5.7 ETH 2026-07-13) — see derivation.mainnetGraduationTarget. The solver inverts constraint (c) `G = p·L + F + R` around a FLAT ETH raise (§12.11), DEFAULT 5.7 ETH (matches RobinFun's ~5.74 ETH / ~$44k bar; env-overridable M0_MAINNET_GRADUATION_ETH), replacing the earlier flat 2.5-ETH default (itself replacing the retired $69k-mcap derivation, ~7.9166 ETH). The MAINNET fee policy is UNCHANGED (USD-sized ~$5 caller reward, cost-based §12.26 graduation fee, 10× gas floor) — at 5.7 ETH the fees are ≪ G, so GraduationUnfundable clears by ~350×. hoodpad-architect gate-approves the new target before deploy (§13).",
        ]
      : []),
    "governance.organicVolumeFloor: M0-4 DEFAULT (§14 Gate G-A.1) — floor = 5 × GRADUATION_ETH / 7d of OWN-INDEXER organic curve volume (§8.5); NOT a headline metric (§2). The magnitude ('what counts as not-collapsed') is a product/policy call → hoodpad-architect ratifies before Gate G-A; recalibrate at M2 with real organic series.",
    "governance.clusterAlertThresholds: M0-4 DEFAULT (§10 gate 7 amend, §8.5) — per-token X=25% / platform Y=10% of curve volume over 24h; ADVISORY alert only, never gates chain state (§8.4/§8.5). Final tuning with hoodpad-security before beta.",
    ...(isTestnet
      ? [
          "external.weth / v3Factory / positionManager / swapRouter02 / quoterV2: TESTNET 46630 set — RATIFIED spec §12.52 (2026-07-11), sourced from tools/m0/external.testnet.json (never inlined in source, §12.49). WETH is official (docs.robinhood.com/chain/protocol-contracts); the V3 set is a Blockscout-VERIFIED community deployment, TESTNET-ONLY with the §12.52 trust caveat (deployer EOA owns the factory) — FORBIDDEN on mainnet/local. Deploy script still runtime-asserts feeAmountTickSpacing(10000)==200, NPM.factory(), NPM.WETH9() (contracts.md §7.2) so a wrong address fails closed.",
          "external.treasurySafe: UNSET (T-2) — zero address on purpose; canonical Safe v1.4.1 contracts are CONFIRMED on 46630 (§12.52) but the dev-signer treasury Safe is not created yet. Create it, fill external.testnet.json, re-run derive; Deploy.s.sol fails closed (TreasurySafeUnset) until then. Never invented.",
        ]
      : [
          "external.v3Factory / positionManager / swapRouter02 / quoterV2: CONFIRMED on 4663 (spec §12.28, O-4 RESOLVED) — registry-sourced + on-chain verified, never invented; deploy script still runtime-asserts feeAmountTickSpacing(10000)==200, NPM.factory(), NPM.WETH9() (contracts.md §7.2) so a wrong address fails closed.",
          "external.treasurySafe: UNSET (O-6, spec §13) — zero address on purpose; deploy script's zero-address guard must fail until filled from the official Safe deployment on 4663. Never invented.",
        ]),
    "Graduation threshold counts NET-of-1%-fee real reserves — resolved §12.11; restated so the deploy reviewer re-confirms.",
  ];

  const constants = {
    chainId,
    generatedAt,
    ethUsdSnapshot: { source: snap.source, timestamp: snap.timestamp, value: snap.value },
    curve: {
      virtualEthWei: c.virtualEthWei.toString(),
      virtualTokenWei: c.virtualTokenWei.toString(),
      curveSupplyWei: CURVE_SUPPLY.toString(),
      lpTrancheWei: LP_TOKEN_TRANCHE.toString(),
      graduationEthWei: c.graduationEthWei.toString(),
    },
    fees: {
      tradeFeeBps: Number(TRADE_FEE_BPS),
      creatorFeeBps,
      creationFeeWei: creationFeeWei.toString(),
      maxCreationFeeWei: maxCreationFeeWei.toString(),
      graduationFeeWei: c.graduationFeeWei.toString(),
      maxGraduationFeeWei: maxGraduationFeeWei.toString(),
      callerRewardWei: callerRewardWei.toString(),
      maxCallerRewardWei: maxCallerRewardWei.toString(),
    },
    antiSniper: {
      windowSeconds: EARLY_WINDOW_SECONDS,
      maxEarlyBuyWei: maxEarlyBuyWei.toString(),
    },
    v3: {
      feeTier: V3_FEE_TIER,
      tickSpacing: V3_TICK_SPACING,
      sqrtPriceX96Token0: sqrtA.toString(),
      sqrtPriceX96Token1: sqrtB.toString(),
      targetTickToken0: tickA,
      targetTickToken1: tickB,
      fullRangeTickLower: frLower,
      fullRangeTickUpper: frUpper,
      toleranceTicks: TOLERANCE_TICKS,
      maxArbIterations: MAX_ARB_ITERATIONS,
      migrationSlippageBps: MIGRATION_SLIPPAGE_BPS,
    },
    beta: {
      perTokenEthCapWei: perTokenEthCapWei.toString(),
      globalEthCapWei: globalEthCapWei.toString(),
    },
    // ── M0-4 (spec §2.2/§8.5/§10/§14): off-chain governance + monitoring ──────
    // Consumed by Gate G-A.1 (§14) and the M2-12 gate-7 metric hooks / M2-13 bot
    // heuristics — NOT deployed on-chain (§8.4/§8.5 advisory-only). All values are
    // labeled M0 defaults; the organic floor references the curve's own
    // GRADUATION_ETH, never a headline/chain-wide market metric (§2).
    governance: {
      organicVolumeFloor: {
        basis:
          "Gate G-A.1 (§14) mainnet market floor: evaluated at Phase-A exit against the OWN INDEXER organic-volume estimate (§8.5), NEVER a headline/chain-wide/Dune metric (§2/§2.2).",
        metric:
          "rolling platform-wide ORGANIC curve volume (buy+sell ETH notional) after excluding §8.5 wash-flagged volume; when only headline data is available, apply the ≤50% organic-flow discount (§2.2) to estimate the organic component.",
        unit: "multiple of GRADUATION_ETH (self-referential to the curve's own economics — no external ETH/USD or chain-volume figure is baked in)",
        windowDays: ORGANIC_FLOOR_WINDOW_DAYS,
        floorGraduationsEquiv: Number(ORGANIC_FLOOR_GRADUATIONS_EQUIV),
        floorWei: organicVolumeFloorWei.toString(),
        organicFlowDiscountMaxPct: ORGANIC_FLOW_DISCOUNT_MAX_PCT,
        status:
          "M0 DEFAULT (tunable) — recalibrate at M2 once the indexer emits real organic-volume series (§8.5); the magnitude of N ('what counts as not-collapsed') is a product/policy call → hoodpad-architect ratifies before Gate G-A (§13/§14).",
      },
      clusterAlertThresholds: {
        basis:
          "Gate 7 capped-beta cluster monitoring (§10 gate 7 amend, §8.5): ALERT (never a chain-state gate — §8.4/§8.5 advisory-only) when one §8.5 funder cluster dominates volume. Early-warning for metric distortion + coordinated dumps.",
        perTokenPct: CLUSTER_ALERT_PER_TOKEN_PCT,
        platformPct: CLUSTER_ALERT_PLATFORM_PCT,
        windowHours: CLUSTER_ALERT_WINDOW_HOURS,
        measuredAgainst:
          "trailing-window curve volume, grouped by §8.5 funder cluster (indexer feed); per-token X% of one token's curve volume, platform Y% of platform-wide curve volume.",
        status:
          "M0 DEFAULT (tunable) — hooks emitted in M2-12; alert delivery + final thresholds tuned with hoodpad-security before beta deploy (gate 7).",
      },
    },
    // ── external addresses (canonical + registry-sourced, NEVER invented) ──────
    // MAINNET (4663): WETH + the four Uniswap V3 addresses are CONFIRMED (spec §12.28,
    // O-4 RESOLVED 2026-07-09), inlined in MAINNET_EXTERNAL above; treasurySafe stays
    // ZERO on purpose (O-6 OPEN — deploy fails closed until the official Safe exists).
    // TESTNET (46630): the §12.52-ratified set from external.testnet.json (fail-closed
    // loader above); treasurySafe ZERO until the T-2 dev-signer Safe is created.
    // Both networks: the deploy script runtime-asserts feeAmountTickSpacing(10000)==200,
    // NPM.factory(), NPM.WETH9() (contracts.md §7.2), so a wrong address fails closed.
    external,
    provenance: {
      generator: "tools/m0/derive.ts (@robbed/m0)",
      gitSha: gitSha(),
      ethUsdSource: snap.source,
      ethUsdPrice: snap.value,
      fetchedAt: snap.timestamp,
      specRefs: ["§2.2", "§6.2", "§6.3", "§6.4", "§6.5", "§8.5", "§10", "§11.0", "§12.11", "§12.18", "§12.26", "§13", "§14"],
      status: "OPEN ITEM §13 — constants not final until reviewed by hoodpad-architect",
      simulation: {
        seeds: SIM_SEEDS,
        runs: sims.length,
        maxTerminalPriceErrPpb: maxTermErr.toString(),
        maxCurveRoundingDustTokenWei: maxShortfall.toString(),
      },
    },
    derivation: {
      note: "vT0 = S²/(2S−T−f), vE0 = p·(L+f)²/(2S−T−f), G = p·(L+f) with f=(gradFee+callerReward)/p; p = exact price of targetTickToken0. Full algebra in tools/m0/lib/curve.ts.",
      graduationTargetBasis: gradTargetWei !== null ? "flat net-of-fee ETH raise (§12.11)" : "legacy $69k mcap",
      // LEGACY $69k-mcap parity figure — retained for provenance only; NOT the graduation driver on any
      // flat-G run (every mainnet run + the testnet faucet override). See mainnetGraduationTarget /
      // testnetGraduationOverride for the operative target.
      gradMcapTargetUsd: GRAD_MCAP_USD.toString(),
      graduationFeeModel: {
        basis: "cost-based (§12.26) — migrationGasEstimate × gasPriceWei × (marginNum/marginDen); NOT %-of-raise, no hardcoded USD",
        migrationGasEstimate: MIGRATION_GAS_ESTIMATE.toString(),
        migrationGasBasis:
          "MEASURED on a mainnet-fork of chain 4663 at the latest block via the real §12.28 V3 factory/NPM " +
          "(contracts/test/fork/Lifecycle.t.sol, 2026-07-12): graduate()+V3 migration = 814729 gas clean / " +
          `817845 gas with arb-back. Estimate rounded up to ${MIGRATION_GAS_ESTIMATE} (~1.83× measured) to cover the full MAX_ARB_ITERATIONS=8 loop.`,
        measuredGraduateGas: MEASURED_GRADUATE_GAS.toString(),
        gasPriceWei: gasPriceWei.toString(),
        gasPriceBasis: gas.basis,
        gasPriceSource: gas.source,
        gasPriceFetchedAt: gas.timestamp,
        marginNum: Number(GRAD_FEE_MARGIN_NUM),
        marginDen: Number(GRAD_FEE_MARGIN_DEN),
        graduationFeeWei: graduationFeeWei.toString(),
        callerRewardGasFloorWei: callerRewardFloorWei.toString(),
        callerRewardCoversGasFloor: callerRewardCoversGas,
        status:
          "M1 gas re-validation DONE (2026-07-12) — migrationGasEstimate is fork-measured; graduation fee " +
          "and the §12.34 ≥10×-graduate()-gas caller-reward floor are validated against live gas. Exact fee " +
          "still finalized at deploy against live gas per §12.26.",
      },
      rawTickToken0BeforeAlignment: rawTickA,
      k: c.k.toString(),
      ethToLpWei: c.ethToLpWei.toString(),
      ...(smallGOverride
        ? {
            testnetGraduationOverride: {
              envVar: "M0_TESTNET_GRADUATION_ETH",
              requested: testnetOverrideRaw,
              requestedWei: gradTargetWei!.toString(),
              derivedGraduationEthWei: c.graduationEthWei.toString(),
              policy: {
                priceTarget: "constraint (c) inverted: raw p = (G − F − R)/L, then tick-aligned (±≤~1%)",
                callerReward: "10% of target G; ceiling 2× (20% of G)",
                graduationFee: "min(cost-based §12.26, 10% of G); ceiling min(10×, 20% of G)",
                callerRewardGasFloor: "relaxed 10× → 1.5× of fork-measured graduate() gas (TESTNET-ONLY)",
                creationFee: "unchanged (independent of G)",
              },
              status:
                "TESTNET-ONLY faucet-scale lifecycle-testing device — derive fails closed if the env var is present in mainnet mode; never a mainnet input (hoodpad-architect re-ratifies the policy).",
            },
          }
        : {}),
      ...(!isTestnet
        ? {
            mainnetGraduationTarget: {
              basis:
                "MAINNET FLAT graduation target (approved product change 2026-07-13; retargeted 5.7 ETH 2026-07-13): G is a flat net-of-fee ETH raise (§12.11), matching RobinFun's ~5.74 ETH / ~$44k bar, NOT the retired $69k-mcap derivation (~7.9166 ETH) nor the earlier flat 2.5-ETH default. Same solver MECHANISM as the testnet override (constraint (c) `G = p·L + F + R` inverted around the target), but the MAINNET fee policy is kept intact — no faucet-scale rescale.",
              source: gradTargetSource,
              envVar: "M0_MAINNET_GRADUATION_ETH",
              envOverridden: mainnetOverrideRaw != null && mainnetOverrideRaw !== "",
              defaultWei: MAINNET_GRADUATION_ETH.toString(),
              requestedWei: gradTargetWei!.toString(),
              derivedGraduationEthWei: c.graduationEthWei.toString(),
              policy: {
                priceTarget: "constraint (c) inverted: raw p = (G − F − R)/L, then tick-aligned (±≤~1%)",
                callerReward: "MAINNET USD-sized ≈$5; ceiling 5× (unchanged)",
                graduationFee: "MAINNET cost-based §12.26; ceiling 10× (unchanged; no %-of-G cap)",
                callerRewardGasFloor: "MAINNET 10× of fork-measured graduate() gas (unchanged)",
                creationFee: "unchanged (independent of G)",
              },
              status:
                "OPEN ITEM §13 — hoodpad-architect gate-approves the 5.7-ETH target before deploy. Fails closed if M0_MAINNET_GRADUATION_ETH is set under --network=testnet.",
            },
          }
        : {}),
      lpDust: {
        token0IsToken: { tokenWei: dustTokA.toString(), wethWei: dustWethA.toString(), liquidity: mintA.liquidity.toString() },
        token0IsWeth: { tokenWei: dustTokB.toString(), wethWei: dustWethB.toString(), liquidity: mintB.liquidity.toString() },
      },
    },
    humanReadable: {
      virtualEth0: `${eth(c.virtualEthWei)} ETH`,
      virtualToken0: `${tokensM(c.virtualTokenWei)} tokens`,
      graduationEth: `${eth(c.graduationEthWei)} ETH (net-of-fee, §12.11) ≈ $${weiToUsd(c.graduationEthWei).toFixed(2)} @snapshot`,
      graduationMcap: `${eth(gradMcapWei, 4)} ETH ≈ $${gradMcapUsd.toFixed(2)} @snapshot (${gradTargetLabel})`,
      initialMcap: `${eth(initialMcapWei, 4)} ETH ≈ $${weiToUsd(initialMcapWei).toFixed(2)} @snapshot`,
      graduationFee: `${eth(c.graduationFeeWei)} ETH ≈ $${weiToUsd(c.graduationFeeWei).toFixed(2)} @snapshot — cost-based flat (§12.26), gas ${gas.basis} (USD shown is informational only)`,
      creationFee: `${eth(creationFeeWei)} ETH ≈ $${weiToUsd(creationFeeWei).toFixed(2)} @snapshot`,
      callerReward: `${eth(callerRewardWei)} ETH ≈ $${weiToUsd(callerRewardWei).toFixed(2)} @snapshot`,
      maxEarlyBuy: `${eth(maxEarlyBuyWei)} ETH ≈ $${weiToUsd(maxEarlyBuyWei).toFixed(2)} @snapshot`,
      ethToLp: `${eth(c.ethToLpWei)} ETH`,
    },
    reviewRequired,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = join(OUT_DIR, outName);
  writeFileSync(jsonPath, JSON.stringify(constants, null, 2) + "\n");

  // ── 8. Generated renderings (never hand-edited; MAINNET ONLY — see section 6
  //       note. The deploy script consumes the JSON, so testnet needs nothing else.)
  if (!isTestnet) {
    writeFileSync(join(OUT_DIR, "Constants.sol.txt"), renderSol(constants));
    writeFileSync(join(OUT_DIR, "constants.ts"), renderTs(constants));
  }

  console.log(`\nEmitted:`);
  console.log(`  ${jsonPath}`);
  if (!isTestnet) {
    console.log(`  ${join(OUT_DIR, "Constants.sol.txt")}`);
    console.log(`  ${join(OUT_DIR, "constants.ts")}`);
    console.log(`  ${join(PLOTS_DIR, "price-vs-tokens-sold.svg")}`);
    console.log(`  ${join(PLOTS_DIR, "mcap-vs-tokens-sold.svg")}`);
    console.log(`  ${join(PLOTS_DIR, "checkpoints.md")}`);
  }
  console.log(`\nAll ${checks.length} validations passed. Reminder: §13 gate approval of these constants is still required.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderings — generated from the canonical JSON object, never hand-edited.
// ─────────────────────────────────────────────────────────────────────────────
type C = {
  chainId: number;
  generatedAt: string;
  ethUsdSnapshot: { source: string; timestamp: string; value: string };
  curve: Record<string, string>;
  fees: Record<string, string | number>;
  antiSniper: { windowSeconds: number; maxEarlyBuyWei: string };
  v3: Record<string, string | number>;
  beta: Record<string, string>;
  governance: {
    organicVolumeFloor: Record<string, string | number>;
    clusterAlertThresholds: Record<string, string | number>;
  };
  external: Record<string, string>;
  provenance: { gitSha: string; status: string };
};

function header(c: C, comment: string): string {
  return [
    `${comment} AUTO-GENERATED by tools/m0/derive.ts — DO NOT EDIT (edit inputs + re-run \`bun run derive\`).`,
    `${comment} ${c.provenance.status}.`,
    `${comment} Provenance: ETH/USD $${c.ethUsdSnapshot.value} — ${c.ethUsdSnapshot.source} — fetched ${c.ethUsdSnapshot.timestamp}.`,
    `${comment} generatedAt ${c.generatedAt} · gitSha ${c.provenance.gitSha} · chainId ${c.chainId}.`,
    `${comment} GRADUATION_ETH counts NET-of-fee real reserves (spec §12.11).`,
  ].join("\n");
}

function renderSol(c: C): string {
  return `${header(c, "//")}
// Ready to paste/import into contracts/script/ — the deploy script's canonical
// source remains out/constants.json via vm.readFile + vm.parseJson (contracts.md §4).

// SPDX-License-Identifier: MIT
// pragma solidity <exact pin per §6.7 — candidate 0.8.35, confirm vs Blockscout (O-5)>;

library RobbedConstants {
    // ── curve (§6.2 / §6.4) ────────────────────────────────────────────────
    uint256 internal constant TOTAL_SUPPLY      = 1_000_000_000e18; // structural, §6.4
    uint256 internal constant CURVE_SUPPLY      = ${c.curve.curveSupplyWei};
    uint256 internal constant LP_TOKEN_TRANCHE  = ${c.curve.lpTrancheWei};
    uint256 internal constant VIRTUAL_ETH_0     = ${c.curve.virtualEthWei};
    uint256 internal constant VIRTUAL_TOKEN_0   = ${c.curve.virtualTokenWei};
    uint256 internal constant GRADUATION_ETH    = ${c.curve.graduationEthWei}; // net-of-fee, §12.11

    // ── fees (§6.4, §7) ────────────────────────────────────────────────────
    uint16  internal constant TRADE_FEE_BPS       = ${c.fees.tradeFeeBps};
    uint16  internal constant MAX_TRADE_FEE_BPS   = ${MAX_TRADE_FEE_BPS};  // hard cap, structural
    uint16  internal constant CREATOR_FEE_BPS     = ${c.fees.creatorFeeBps};    // §7/§12.63: additive under the 200 cap (0.5% = 50 bps)
    uint256 internal constant CREATION_FEE        = ${c.fees.creationFeeWei};
    uint256 internal constant MAX_CREATION_FEE    = ${c.fees.maxCreationFeeWei};
    uint256 internal constant GRADUATION_FEE      = ${c.fees.graduationFeeWei}; // cost-based flat, §12.26 (M0 placeholder; finalized at M1 vs testnet gas)
    uint256 internal constant MAX_GRADUATION_FEE  = ${c.fees.maxGraduationFeeWei};
    uint256 internal constant CALLER_REWARD       = ${c.fees.callerRewardWei};
    uint256 internal constant MAX_CALLER_REWARD   = ${c.fees.maxCallerRewardWei};

    // ── anti-sniper (§6.5, §12.18 — block.timestamp window, NEVER block.number)
    uint64  internal constant EARLY_WINDOW_SECONDS = ${c.antiSniper.windowSeconds};
    uint256 internal constant MAX_EARLY_BUY        = ${c.antiSniper.maxEarlyBuyWei};

    // ── V3 graduation (§6.3; both token orderings, address order unknown pre-deploy)
    uint24  internal constant FEE_TIER               = ${c.v3.feeTier};
    int24   internal constant TICK_SPACING           = ${c.v3.tickSpacing};
    uint160 internal constant SQRT_PRICE_TOKEN0_X96  = ${c.v3.sqrtPriceX96Token0}; // launch token is token0
    uint160 internal constant SQRT_PRICE_TOKEN1_X96  = ${c.v3.sqrtPriceX96Token1}; // launch token is token1
    int24   internal constant TARGET_TICK_TOKEN0     = ${c.v3.targetTickToken0};
    int24   internal constant TARGET_TICK_TOKEN1     = ${c.v3.targetTickToken1};
    int24   internal constant FULL_RANGE_TICK_LOWER  = ${c.v3.fullRangeTickLower};
    int24   internal constant FULL_RANGE_TICK_UPPER  = ${c.v3.fullRangeTickUpper};
    int24   internal constant TOLERANCE_TICKS        = ${c.v3.toleranceTicks};        // PROPOSAL O-8
    uint8   internal constant MAX_ARB_ITERATIONS     = ${c.v3.maxArbIterations};          // PROPOSAL O-8
    uint16  internal constant MIGRATION_SLIPPAGE_BPS = ${c.v3.migrationSlippageBps};        // PROPOSAL O-8

    // ── beta caps (gate 7 — PLACEHOLDER O-10) ──────────────────────────────
    uint256 internal constant PER_TOKEN_ETH_CAP = ${c.beta.perTokenEthCapWei};
    uint256 internal constant GLOBAL_ETH_CAP    = ${c.beta.globalEthCapWei};

    // ── external (V3 addrs CONFIRMED §12.28; TREASURY_SAFE zero = unset O-6, deploy MUST fail if zero)
    address internal constant WETH             = ${c.external.weth};
    address internal constant V3_FACTORY       = ${c.external.v3Factory};       // §12.28, assert feeAmountTickSpacing(10000)==200
    address internal constant POSITION_MANAGER = ${c.external.positionManager};       // §12.28, assert factory()/WETH9()
    address internal constant SWAP_ROUTER_02   = ${c.external.swapRouter02};       // §12.28 (indexer/quoter use)
    address internal constant QUOTER_V2        = ${c.external.quoterV2};       // §12.28 (indexer/quoter use)
    address internal constant TREASURY_SAFE    = ${c.external.treasurySafe};       // O-6 OPEN — zero on purpose, deploy fails if zero
}
`;
}

function renderTs(c: C): string {
  return `${header(c, "//")}
// TS rendering for apps/web / packages/shared. Canonical source: tools/m0/out/constants.json.
// All wei values are decimal strings (safe across Solidity/JS); convert with BigInt(...).

export const ROBBED_CONSTANTS = ${JSON.stringify(
    {
      chainId: c.chainId,
      generatedAt: c.generatedAt,
      ethUsdSnapshot: c.ethUsdSnapshot,
      curve: c.curve,
      fees: c.fees,
      antiSniper: c.antiSniper,
      v3: c.v3,
      beta: c.beta,
      governance: c.governance,
      external: c.external,
    },
    null,
    2,
  )} as const;

export type RobbedConstants = typeof ROBBED_CONSTANTS;
`;
}

main().catch((e) => {
  console.error(`FATAL: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
