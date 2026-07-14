/**
 * Launch initial-buy preview + non-zero slippage floor (M3-6).
 *
 * The optional atomic creator buy targets a NOT-YET-DEPLOYED token, so it cannot
 * be quoted on-chain (`Router.quoteBuy` reverts `UnknownToken`). Instead we PREVIEW
 * it with the SHARED curve math — byte-identical to the on-chain `CurveMath`
 * library — seeded by the factory's initial virtual reserves (`virtualEth0` /
 * `virtualToken0`, read live from `curveDefaults()`). At curve start these reserves
 * are exact and the graduation clamp cannot engage, so `previewBuy` is EXACT here
 * (the module @dev note in `@robbed/shared/curve-quote`). We never re-implement the
 * curve math (CLAUDE.md anti-drift) — we import it.
 *
 * The slippage floor reuses the curve entity's `applySlippageFloor` /
 * `DEFAULT_SLIPPAGE_BPS` (2%) so the launch and trade paths derive
 * `minOut` identically.
 */
import { previewBuy } from "@robbed/shared/curve-quote";

import { DEFAULT_SLIPPAGE_BPS, applySlippageFloor } from "@/entities/curve";

export interface InitialBuyPreview {
  /** Tokens the creator receives for the initial buy, wei (floored, curve-favoring). */
  tokensOut: bigint;
  /** Net ETH priced on the curve after the in-contract fee, wei. */
  netEth: bigint;
  /** In-contract trade fee on the initial buy, wei. */
  fee: bigint;
}

/**
 * Preview the atomic initial creator buy off-chain. Returns `null` when the inputs
 * aren't usable yet (no buy amount, or the factory's seed reserves / fee haven't
 * been read) — the caller then leaves the display blank rather than inventing a
 * number.
 * @param ethInGrossWei The creator's initial-buy ETH (gross, pre-fee), wei.
 */
export function previewInitialBuy(args: {
  virtualEth0: bigint | null;
  virtualToken0: bigint | null;
  tradeFeeBps: number | null;
  ethInGrossWei: bigint;
}): InitialBuyPreview | null {
  const { virtualEth0, virtualToken0, tradeFeeBps, ethInGrossWei } = args;
  if (ethInGrossWei <= 0n) return null;
  if (virtualEth0 === null || virtualEth0 <= 0n) return null;
  if (virtualToken0 === null || virtualToken0 <= 0n) return null;
  if (tradeFeeBps === null) return null;

  const { tokensOut, netEth, fee } = previewBuy(
    virtualEth0,
    virtualToken0,
    ethInGrossWei,
    tradeFeeBps,
  );
  return { tokensOut, netEth, fee };
}

/**
 * The non-zero `minTokensOut` for the atomic initial buy: `tokensOut · (1 −
 * slippageBps/1e4)`. `preview` is `null` when there is no initial buy OR the
 * seed reserves aren't readable yet — either way `minTokensOut` is 0 (nothing is
 * bought, or the caller can't safely floor). Because the initial buy executes
 * inside the SAME `createToken` tx on a single FCFS sequencer, there is no
 * intervening block for anyone to front-run it, so a 0 floor in the
 * not-yet-readable case is safe; once the seed reserves are read, this returns the
 * real, non-zero floor.
 */
export function initialBuyMinTokensOut(
  preview: InitialBuyPreview | null,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
): bigint {
  if (preview === null) return 0n;
  return applySlippageFloor(preview.tokensOut, slippageBps);
}
