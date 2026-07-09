/**
 * lib/v3tick.ts — Uniswap V3 tick / sqrtPriceX96 math (bigint port).
 *
 * getSqrtRatioAtTick is a faithful port of Uniswap v3-core `TickMath.sol`
 * (https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol,
 * fetched & constants verified 2026-07-09). Correctness of the ported magic
 * constants is checksummed at runtime in derive.ts against the canonical
 * MIN_SQRT_RATIO / MAX_SQRT_RATIO / tick-0 values.
 *
 * Liquidity/amount helpers mirror v3-periphery `LiquidityAmounts.sol` and
 * v3-core `SqrtPriceMath.sol` (round-up on consumed amounts, as core mints do).
 */

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
export const MIN_SQRT_RATIO = 4295128739n;
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;
export const Q96 = 2n ** 96n;
export const Q192 = 2n ** 192n;

const MAX_UINT256 = 2n ** 256n - 1n;

// (bit, ratio multiplier) pairs from TickMath.getSqrtRatioAtTick, verbatim.
const TICK_RATIOS: ReadonlyArray<readonly [number, bigint]> = [
  [0x1, 0xfffcb933bd6fad37aa2d162d1a594001n],
  [0x2, 0xfff97272373d413259a46990580e213an],
  [0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000, 0x48a170391f7dc42444e8fa2n],
];

/** TickMath.getSqrtRatioAtTick — sqrt(1.0001^tick) * 2^96, Q64.96. */
export function getSqrtRatioAtTick(tick: number): bigint {
  const absTick = tick < 0 ? -tick : tick;
  if (absTick > MAX_TICK) throw new Error(`tick ${tick} out of range`);

  let ratio = (absTick & 0x1) !== 0 ? TICK_RATIOS[0]![1] : 1n << 128n;
  for (let i = 1; i < TICK_RATIOS.length; i++) {
    const [bit, mul] = TICK_RATIOS[i]!;
    if ((absTick & bit) !== 0) ratio = (ratio * mul) >> 128n;
  }
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  // Round up Q128.128 -> Q64.96 (matches Solidity source).
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

/** Inverse: greatest tick whose ratio is <= sqrtPriceX96 (float estimate + exact refine). */
export function getTickAtSqrtRatio(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO)
    throw new Error("sqrtPriceX96 out of range");
  const x = Number(sqrtPriceX96) / Number(Q96);
  let tick = Math.floor((2 * Math.log(x)) / Math.log(1.0001));
  if (tick < MIN_TICK) tick = MIN_TICK;
  if (tick > MAX_TICK) tick = MAX_TICK;
  // Exact refinement (float estimate is within a few ticks).
  let guard = 0;
  while (tick > MIN_TICK && getSqrtRatioAtTick(tick) > sqrtPriceX96) {
    tick--;
    if (++guard > 256) throw new Error("tick refine diverged (down)");
  }
  while (tick < MAX_TICK && getSqrtRatioAtTick(tick + 1) <= sqrtPriceX96) {
    tick++;
    if (++guard > 256) throw new Error("tick refine diverged (up)");
  }
  return tick;
}

/** Nearest tick that is a multiple of `tickSpacing`, by geometric distance in price. */
export function nearestUsableTick(sqrtPriceX96: bigint, tickSpacing: number): number {
  const raw = getTickAtSqrtRatio(sqrtPriceX96);
  const lo = Math.floor(raw / tickSpacing) * tickSpacing;
  const hi = lo + tickSpacing;
  const minUsable = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  const maxUsable = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
  if (lo < minUsable) return minUsable;
  if (hi > maxUsable) return maxUsable;
  // Geometric midpoint test: price(target)^2 vs price(lo)*price(hi).
  const sLo = getSqrtRatioAtTick(lo);
  const sHi = getSqrtRatioAtTick(hi);
  return sqrtPriceX96 * sqrtPriceX96 > sLo * sHi ? hi : lo;
}

export function minUsableTick(tickSpacing: number): number {
  return Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
}
export function maxUsableTick(tickSpacing: number): number {
  return Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
}

/** Integer sqrt (Newton). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = 1n << (BigInt(n.toString(2).length + 1) / 2n);
  let y = (x + n / x) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** sqrtPriceX96 for an exact price ratio `num/den` (token1-units per token0-unit). */
export function sqrtPriceX96FromPrice(num: bigint, den: bigint): bigint {
  return isqrt((num * Q192) / den);
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** LiquidityAmounts.getLiquidityForAmount0 (price range [sqrtA, sqrtB], sqrtA < sqrtB). */
export function liquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  const intermediate = (sqrtA * sqrtB) / Q96;
  return (amount0 * intermediate) / (sqrtB - sqrtA);
}

/** LiquidityAmounts.getLiquidityForAmount1. */
export function liquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return (amount1 * Q96) / (sqrtB - sqrtA);
}

/** SqrtPriceMath.getAmount0Delta, roundUp = true (what a mint consumes). */
export function amount0ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return ceilDiv(ceilDiv(liquidity * (sqrtB - sqrtA) * Q96, sqrtB), sqrtA);
}

/** SqrtPriceMath.getAmount1Delta, roundUp = true. */
export function amount1ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return ceilDiv(liquidity * (sqrtB - sqrtA), Q96);
}

export interface FullRangeMint {
  liquidity: bigint;
  consumed0: bigint;
  consumed1: bigint;
  dust0: bigint;
  dust1: bigint;
}

/**
 * Simulate a full-range mint at pool price `sqrtP` within [tickLower, tickUpper]
 * given available amount0/amount1. Liquidity = min(L0, L1) as the
 * NonfungiblePositionManager computes; consumed amounts round up (core mint),
 * clamped down by 1 unit of liquidity if round-up would exceed availability.
 */
export function fullRangeMint(
  sqrtP: bigint,
  tickLower: number,
  tickUpper: number,
  amount0: bigint,
  amount1: bigint,
): FullRangeMint {
  const sqrtLo = getSqrtRatioAtTick(tickLower);
  const sqrtHi = getSqrtRatioAtTick(tickUpper);
  if (sqrtP <= sqrtLo || sqrtP >= sqrtHi) throw new Error("price outside range");
  const l0 = liquidityForAmount0(sqrtP, sqrtHi, amount0);
  const l1 = liquidityForAmount1(sqrtLo, sqrtP, amount1);
  let liquidity = l0 < l1 ? l0 : l1;
  let consumed0 = amount0ForLiquidity(sqrtP, sqrtHi, liquidity);
  let consumed1 = amount1ForLiquidity(sqrtLo, sqrtP, liquidity);
  while ((consumed0 > amount0 || consumed1 > amount1) && liquidity > 0n) {
    liquidity -= 1n;
    consumed0 = amount0ForLiquidity(sqrtP, sqrtHi, liquidity);
    consumed1 = amount1ForLiquidity(sqrtLo, sqrtP, liquidity);
  }
  return { liquidity, consumed0, consumed1, dust0: amount0 - consumed0, dust1: amount1 - consumed1 };
}
