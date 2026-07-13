/**
 * Gas-ceiling math (pure).
 *
 * graduate() mints a full-range V3 position with an arb-back loop over
 * `MAX_ARB_ITERATIONS` — the same heavy-gas + ArbOS-L1-cost-inside-the-budget +
 * 63/64 class as createToken. The [[launch-flow-gas-and-error-masking]] lesson:
 * a TIGHT gas ceiling OOGs the inner call and masks the real revert, so we send
 * an explicit `estimate * 2` limit, only clamped by an absolute block-safe cap.
 * NEVER a tight cap.
 *
 * Fork-measured worst case is ~817,845 gas (spec §12.62, Lifecycle.t.sol); 2x an
 * honest estimate clears that with headroom while staying well under the cap.
 */

/** Absolute ceiling — block gas safety. Default 30,000,000 (spec/plan). */
export const DEFAULT_GAS_CAP = 30_000_000n;

/**
 * `min(estimate * 2, cap)`. The 2x buffer absorbs arb-iteration variance and
 * ArbOS L1-data cost; the cap is the hard safety rail. Throws on a non-positive
 * estimate — a zero/negative estimate is never a valid `graduate()` cost and
 * must not silently collapse the buffer to 0 (which would OOG).
 */
export function gasWithBuffer(estimate: bigint, cap: bigint = DEFAULT_GAS_CAP): bigint {
  if (estimate <= 0n) {
    throw new Error(`gasWithBuffer: non-positive estimate ${estimate} — refusing to send a zero-gas tx`);
  }
  const buffered = estimate * 2n;
  return buffered > cap ? cap : buffered;
}
