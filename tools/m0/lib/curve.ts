/**
 * lib/curve.ts — virtual-reserve constant-product math (spec §6.2, Gnad math hardened)
 * and the M0 constants solver (spec §6.4 targets, §12.11 net-of-fee threshold).
 *
 * All quantities are wei-scale bigints (both ETH and token use 18 decimals, so a
 * price "ETH per token" is numerically identical as a wei/wei ratio).
 *
 * ── Algebra (shown per m0-notebook requirement) ─────────────────────────────
 * Let T = total supply, S = curve supply, L = LP tranche (S + L = T),
 * p = graduation spot price (ETH-wei per token-wei, as ratio pNum/pDen),
 * F = flat graduation fee, R = graduation caller reward,
 * G = GRADUATION_ETH (net-of-trade-fee real reserves, §12.11).
 *
 * Buy:  tokensOut = vT − k/(vE + ethInNet),  k = vE·vT   (§6.2)
 * Sell: ethOutNet = vE − k/(vT + tokensIn)               (inverse)
 * The 1% trade fee is taken on the ETH leg BEFORE curve math, so G counts
 * net ETH — this matches resolved decision §12.11 (threshold = net-of-fee
 * real reserves, i.e. exactly what is available to fund the LP + grad fee).
 *
 * Constraints:
 *  (a) selling exactly S tokens into the curve raises exactly G net ETH:
 *        k = vE0·vT0 = (vE0 + G)·(vT0 − S)
 *  (b) terminal spot price equals the graduation price:
 *        (vE0 + G)/(vT0 − S) = p
 *  (c) zero-dust LP parity: the ETH that reaches the LP after the flat
 *      graduation fee and caller reward equals the LP tranche value at p:
 *        G − F − R = p·L
 *
 * Substituting with f = (F + R)/p (fee expressed in tokens at p):
 *        vT0 = S² / (2S − T − f)
 *        vE0 = p · (L + f)² / (2S − T − f)
 *        G   = p · (L + f)
 * With F = R = 0 this reduces to vT0 = S²/(2S−T) ≈ 1.0731 × 10⁹ tokens for the
 * §6.4 pump.fun split — reproducing pump.fun's published 1.073B virtual token
 * reserve, which confirms the closure is the pump.fun-parity one.
 */

export interface CurveTargets {
  /** graduation spot price ratio: ETH-wei per token-wei = priceNum/priceDen */
  priceNum: bigint;
  priceDen: bigint;
  totalSupplyWei: bigint;
  curveSupplyWei: bigint;
  lpTrancheWei: bigint;
  /**
   * Flat graduation fee, wei — COST-BASED (spec §12.26): sized to ≈ V3-migration
   * gas × gasPrice × thin margin in derive.ts. NOT a %-of-raise and never a
   * hardcoded USD figure. Because it is a flat constant (independent of the
   * realized raise G), constraint (c) reduces to G = p·L + F + R.
   */
  graduationFeeWei: bigint;
  /** flat graduation caller reward, wei */
  callerRewardWei: bigint;
}

export interface CurveConstants {
  virtualEthWei: bigint;
  virtualTokenWei: bigint;
  k: bigint;
  graduationEthWei: bigint; // net-of-trade-fee real reserves at graduation (§12.11)
  graduationFeeWei: bigint; // flat, deducted from G at graduation (§6.3 step 1)
  callerRewardWei: bigint;
  ethToLpWei: bigint; // G − F − R : WETH leg of the full-range mint
  feeTokensWei: bigint; // f = (F+R)/p
  initialPriceNum: bigint; // vE0 (spot = vE/vT)
  initialPriceDen: bigint; // vT0
}

export function solveCurveConstants(t: CurveTargets): CurveConstants {
  const { priceNum: num, priceDen: den, totalSupplyWei: T, curveSupplyWei: S, lpTrancheWei: L } = t;
  if (S + L !== T) throw new Error("curve supply + LP tranche must equal total supply");
  if (t.graduationFeeWei < 0n) throw new Error("graduation fee must be non-negative");

  // p·L (value of LP tranche at graduation price)
  const pL = (num * L) / den;
  // Cost-based flat graduation fee (§12.26): F is a fixed wei constant, so
  // constraint (c) G − F − R = p·L solves directly, G = p·L + F + R.
  const F = t.graduationFeeWei;
  const G = pL + F + t.callerRewardWei;

  // f = (F + R)/p, in token-wei
  const f = ((F + t.callerRewardWei) * den) / num;
  const denom = 2n * S - T - f;
  if (denom <= 0n) throw new Error("infeasible: 2S − T − f must be positive");

  const vT0 = (S * S) / denom;
  // vE0 = p · (vT0 − T − f)  ==  p · (L + f)² / denom
  const vE0 = (num * (vT0 - T - f)) / den;
  if (vE0 <= 0n) throw new Error("infeasible: negative initial virtual ETH");
  const k = vE0 * vT0;

  // Re-anchor G to the integer reserves so that at realEth == G the curve has
  // sold AT MOST CURVE_SUPPLY (floor division ⇒ vE0 + GExact ≤ k/(vT0−S), so
  // the clamped final buy can never oversell the curve). Wei-level shift only.
  const gExact = k / (vT0 - S) - vE0;
  if (gExact <= 0n) throw new Error("infeasible: non-positive graduation threshold");
  // Flat cost-based fee is a constant, not re-derived from the realized raise (§12.26).
  const fExact = F;
  const ethToLpExact = gExact - fExact - t.callerRewardWei;
  if (ethToLpExact <= 0n) throw new Error("infeasible: graduation fee + caller reward exceed net raise");

  return {
    virtualEthWei: vE0,
    virtualTokenWei: vT0,
    k,
    graduationEthWei: gExact,
    graduationFeeWei: fExact,
    callerRewardWei: t.callerRewardWei,
    ethToLpWei: ethToLpExact,
    feeTokensWei: f,
    initialPriceNum: vE0,
    initialPriceDen: vT0,
  };
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Buy: net ETH in → tokens out. Rounds token output down (against buyer), k non-decreasing. */
export function buyTokensOut(vE: bigint, vT: bigint, ethInNet: bigint): { tokensOut: bigint; vE: bigint; vT: bigint } {
  const k = vE * vT;
  const newVE = vE + ethInNet;
  const newVT = ceilDiv(k, newVE);
  return { tokensOut: vT - newVT, vE: newVE, vT: newVT };
}

/** Sell: tokens in → net ETH out (pre-fee). Rounds ETH output down (against seller). */
export function sellEthOut(vE: bigint, vT: bigint, tokensIn: bigint): { ethOut: bigint; vE: bigint; vT: bigint } {
  const k = vE * vT;
  const newVT = vT + tokensIn;
  const newVE = ceilDiv(k, newVT);
  return { ethOut: vE - newVE, vE: newVE, vT: newVT };
}

/** Deterministic PRNG (mulberry32) so fuzz runs are reproducible from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimResult {
  seed: number;
  steps: number;
  buys: number;
  sells: number;
  graduated: boolean;
  realEthWei: bigint; // net reserves at end (== G on graduation, §12.11 clamp)
  grossEthInWei: bigint; // total gross ETH spent by buyers (incl. 1% fee)
  tradeFeesWei: bigint; // accumulated 1% ETH-leg fees (both directions)
  tokensSoldWei: bigint;
  curveShortfallTokensWei: bigint; // CURVE_SUPPLY − tokens actually sold (rounding dust)
  terminalPriceRelErrPpb: bigint; // |spot − target| / target, in parts-per-billion
  kFinal: bigint;
  kInitial: bigint;
}

/**
 * Round-trip validation (m0-notebook §Validation): buy the full curve in
 * randomized fuzzed chunks (with occasional sells), assert:
 *  - k = vE·vT never decreases,
 *  - reserves never go negative, curve never oversells CURVE_SUPPLY,
 *  - graduation triggers exactly when net reserves hit G (final buy clamped,
 *    excess refunded — §12.11),
 *  - terminal spot price matches the target graduation price.
 */
export function simulateFullCurve(
  c: CurveConstants,
  targets: CurveTargets,
  seed: number,
  tradeFeeBps: bigint,
): SimResult {
  const rng = mulberry32(seed);
  const BPS = 10_000n;
  const G = c.graduationEthWei;
  let vE = c.virtualEthWei;
  let vT = c.virtualTokenWei;
  let kPrev = vE * vT;
  const kInitial = kPrev;
  let realEth = 0n;
  let grossIn = 0n;
  let fees = 0n;
  let buys = 0;
  let sells = 0;
  let steps = 0;
  let graduated = false;

  const randBig = (max: bigint): bigint => {
    if (max <= 0n) return 0n;
    // 48 bits of randomness scaled onto [1, max]
    const r = BigInt(Math.floor(rng() * 2 ** 48));
    return 1n + (r * (max - 1n)) / (2n ** 48n - 1n);
  };

  while (!graduated) {
    if (++steps > 100_000) throw new Error(`seed ${seed}: did not graduate in 100k steps`);
    const soldSoFar = c.virtualTokenWei - vT;
    const doSell = rng() < 0.2 && soldSoFar > 10n ** 18n;

    if (doSell) {
      const tokensIn = randBig(soldSoFar / 4n); // sellers return up to 25% of circulating
      if (tokensIn === 0n) continue;
      const r = sellEthOut(vE, vT, tokensIn);
      if (r.ethOut < 0n) throw new Error(`seed ${seed}: negative sell output`);
      const fee = (r.ethOut * tradeFeeBps) / BPS; // 1% ETH-leg fee on the way out
      fees += fee;
      vE = r.vE;
      vT = r.vT;
      realEth = vE - c.virtualEthWei;
      if (realEth < 0n) throw new Error(`seed ${seed}: negative real reserves after sell`);
      sells++;
    } else {
      // Random gross buy between dust and ~1/6 of the total raise.
      let gross = randBig(G / 6n);
      let fee = (gross * tradeFeeBps) / BPS;
      let net = gross - fee;
      const needed = G - realEth;
      if (net >= needed) {
        // §12.11: final buy clamped to land exactly on the threshold; excess refunded.
        net = needed;
        fee = ceilDiv(net * tradeFeeBps, BPS - tradeFeeBps); // fee on the used portion
        gross = net + fee;
        graduated = true;
      }
      const r = buyTokensOut(vE, vT, net);
      if (r.tokensOut < 0n) throw new Error(`seed ${seed}: negative buy output`);
      vE = r.vE;
      vT = r.vT;
      realEth = vE - c.virtualEthWei;
      grossIn += gross;
      fees += fee;
      buys++;
      if (c.virtualTokenWei - vT > targets.curveSupplyWei)
        throw new Error(`seed ${seed}: curve oversold beyond CURVE_SUPPLY`);
    }

    const kNow = vE * vT;
    if (kNow < kPrev) throw new Error(`seed ${seed}: k decreased (${kPrev} -> ${kNow})`);
    kPrev = kNow;
  }

  if (realEth !== G) throw new Error(`seed ${seed}: graduated with realEth != G`);

  const sold = c.virtualTokenWei - vT;
  const shortfall = targets.curveSupplyWei - sold;
  if (shortfall < 0n) throw new Error(`seed ${seed}: oversold curve supply`);

  // |vE/vT − num/den| / (num/den) in ppb  =  |vE·den − vT·num| · 1e9 / (vT·num)
  const cross = vE * targets.priceDen - vT * targets.priceNum;
  const absCross = cross < 0n ? -cross : cross;
  const relErrPpb = (absCross * 1_000_000_000n) / (vT * targets.priceNum);

  return {
    seed,
    steps,
    buys,
    sells,
    graduated,
    realEthWei: realEth,
    grossEthInWei: grossIn,
    tradeFeesWei: fees,
    tokensSoldWei: sold,
    curveShortfallTokensWei: shortfall,
    terminalPriceRelErrPpb: relErrPpb,
    kFinal: kPrev,
    kInitial,
  };
}

/** Spot price / mcap sampling for plots & checkpoint tables. */
export interface CurvePoint {
  tokensSoldWei: bigint;
  realEthWei: bigint;
  priceNum: bigint; // vE
  priceDen: bigint; // vT
}

export function sampleCurve(c: CurveConstants, curveSupplyWei: bigint, n: number): CurvePoint[] {
  const pts: CurvePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const sold = (curveSupplyWei * BigInt(i)) / BigInt(n);
    const vT = c.virtualTokenWei - sold;
    const vE = c.k / vT; // exact continuous curve (no per-trade rounding)
    pts.push({ tokensSoldWei: sold, realEthWei: vE - c.virtualEthWei, priceNum: vE, priceDen: vT });
  }
  return pts;
}
