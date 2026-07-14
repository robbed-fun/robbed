import { parseEther } from "viem";

import { env } from "@/shared/lib/env";

/**
 * large-value disclosure threshold (task B). The ETH-denominated threshold
 * comes from `NEXT_PUBLIC_LARGE_VALUE_ETH_THRESHOLD` (a decimal string — never a
 * JS number literal in code); it defaults to `1.0` ETH when unset (the value
 * recorded in). A trade whose ETH notional ≥ threshold surfaces the
 * extra confirmation-tier disclosure in the widget.
 *
 * Pure + parameterised so it stays trivially testable and holds no market metric
 * of its own (the number is env/spec-supplied).
 */

/** Default from when the env var is unset. Decimal ETH string. */
export const DEFAULT_LARGE_VALUE_ETH = "1.0";

/** Resolve the threshold to wei, tolerating a malformed env value. */
export function largeValueThresholdWei(): bigint {
  const raw = env.largeValueEthThreshold() ?? DEFAULT_LARGE_VALUE_ETH;
  try {
    return parseEther(raw);
  } catch {
    return parseEther(DEFAULT_LARGE_VALUE_ETH);
  }
}

/** True when an ETH notional (wei) meets or exceeds the disclosure threshold. */
export function isLargeValueWei(ethWei: bigint, thresholdWei: bigint): boolean {
  return thresholdWei > 0n && ethWei >= thresholdWei;
}
