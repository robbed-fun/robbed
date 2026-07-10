"use client";

import { Card } from "@/shared/ui";
import { LP_DESTINY_COPY } from "@/shared/config/copy";
import { formatEthFromWei } from "@/shared/lib/format";

import { useLaunchEconomics } from "../model/use-launch-economics";

/**
 * "Economics displayed plainly" (§5.3). Every figure is READ LIVE from the
 * CurveFactory (`useLaunchEconomics`) — the deploy fee, the graduation threshold
 * in ETH, the trade-fee bps — never a constant (§2, CLAUDE.md); the graduation
 * threshold is shown as its on-chain ETH value, never a USD literal (§5 copy
 * rule 3). The LP line is the single shared constant, verbatim (§12.14) —
 * the forbidden LP verb (CLAUDE.md) never appears; this renders LP_DESTINY_COPY.
 *
 * Until the M1-14 deploy codegen furnishes the factory address the reads are
 * disabled (`available === false`) and the live numbers show "read on-chain"
 * rather than a fabricated value.
 */
export function EconomicsPanel() {
  const econ = useLaunchEconomics();

  const feeValue = (wei: bigint | null): string =>
    wei !== null ? `${formatEthFromWei(wei)} ETH` : liveHint(econ.available, econ.isError);

  const tradeFee =
    econ.tradeFeeBps !== null
      ? `${(econ.tradeFeeBps / 100).toFixed(econ.tradeFeeBps % 100 === 0 ? 0 : 2)}% curve fee → treasury`
      : liveHint(econ.available, econ.isError);

  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <h3 className="text-sm font-semibold text-foreground">Economics</h3>

      <Row label="Creation fee">{feeValue(econ.deployFeeWei)}</Row>
      <Row label="Trade fee">{tradeFee}</Row>
      <Row label="Graduation threshold">{feeValue(econ.graduationEthWei)}</Row>

      <div className="mt-1 border-t border-border/60 pt-2">
        <p className="text-xs text-muted-foreground">Liquidity at graduation</p>
        {/* The exact, single-sourced LP sentence — verbatim (§12.14). */}
        <p className="mt-0.5 text-sm text-foreground">{LP_DESTINY_COPY}</p>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Fixed 1,000,000,000 supply · ownerless token · no mint, no blacklist. Fees
        are computed in-contract. All figures read live from chain.
      </p>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{children}</span>
    </div>
  );
}

function liveHint(available: boolean, isError: boolean): string {
  if (isError) return "on-chain read unavailable";
  return available ? "reading…" : "read on-chain";
}
