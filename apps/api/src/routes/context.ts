/**
 * Per-request projection context: the confirmation watermarks + latest ETH/USD
 * snapshot, fetched once and threaded into every DTO projection so
 * `confirmationState` (§2.1) and USD (§2) are recomputed freshly and never a
 * constant. Two cheap singleton reads shared across all rows in a response.
 */
import type { ConfirmationWatermarksRow } from "@robbed/shared";
import type { AppDeps } from "../deps";
import type { EthUsdSnapshot } from "../lib/usd";

export interface ProjectionContext {
  wm: Pick<ConfirmationWatermarksRow, "safe_block" | "finalized_block">;
  ethUsd: EthUsdSnapshot | null;
}

export async function loadProjectionContext(deps: AppDeps): Promise<ProjectionContext> {
  const [wmRow, ethUsd] = await Promise.all([
    deps.db.getWatermarks(),
    deps.db.getLatestEthUsd(),
  ]);
  return {
    wm: wmRow ?? { safe_block: 0, finalized_block: 0 },
    ethUsd: ethUsd ? { price_usd: ethUsd.price_usd, fetched_at: ethUsd.fetched_at } : null,
  };
}
