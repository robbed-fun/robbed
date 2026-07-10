"use client";

import { formatEther, formatUnits } from "viem";
import { TOTAL_SUPPLY_WEI } from "@robbed/shared";

import { MonoText } from "@/shared/ui";
import { LP_DESTINY_COPY } from "@/shared/config/copy";
import { formatEthFromWei, formatEthNumber } from "@/shared/lib/format";

import { useLaunchEconomics } from "../model/use-launch-economics";

/**
 * "Economics displayed plainly" (§5.3) — ROBBED_ terminal summary block
 * (docs/Robbed.html "Create"): a hairline-topped stack of label→value rows,
 * exactly the mockup's Deploy cost / Starting price / Supply, extended with the
 * §5.3-mandated Trade fee + Graduation rows and the verbatim LP sentence (those
 * are product guarantees the mockup omits; kept, styled to match).
 *
 * Every figure is READ LIVE from the CurveFactory (`useLaunchEconomics`) — the
 * deploy fee, the trade-fee bps, the graduation threshold in ETH, the seed
 * virtual reserves that yield the starting price — never a constant (§2,
 * CLAUDE.md). The graduation threshold shows its on-chain ETH value, never a USD
 * literal (§5 copy rule 3). Supply is the fixed protocol constant from
 * `@robbed/shared` (§6.1), not a hardcoded market metric. The LP line is the
 * single shared constant, verbatim (§12.14) — the forbidden LP verb never appears.
 *
 * Until the M1-14 deploy codegen furnishes the factory address the reads are
 * disabled (`available === false`) and the live numbers show "read on-chain"
 * rather than a fabricated value.
 */
export function EconomicsPanel({ ticker }: { ticker?: string }) {
  const econ = useLaunchEconomics();
  const unit = ticker?.trim() ? ticker.trim() : "tokens";

  const ethValue = (wei: bigint | null): string =>
    wei !== null ? `${formatEthFromWei(wei)} ETH` : liveHint(econ.available, econ.isError);

  // Starting price = seed virtual ETH ÷ seed virtual tokens (curve config, read
  // live — a derived on-chain value, never a market-price constant, §2).
  const startingPrice =
    econ.virtualEth0 !== null && econ.virtualToken0 !== null && econ.virtualToken0 !== 0n
      ? `${formatEthNumber(
          Number(formatEther(econ.virtualEth0)) / Number(formatUnits(econ.virtualToken0, 18)),
        )} ETH`
      : liveHint(econ.available, econ.isError);

  const supply = `${new Intl.NumberFormat("en-US").format(
    TOTAL_SUPPLY_WEI / 10n ** 18n,
  )} ${unit}`;

  const tradeFee =
    econ.tradeFeeBps !== null
      ? `${(econ.tradeFeeBps / 100).toFixed(econ.tradeFeeBps % 100 === 0 ? 0 : 2)}% curve fee → treasury`
      : liveHint(econ.available, econ.isError);

  return (
    <div className="flex flex-col">
      <div className="h-px w-full bg-border" />
      <dl className="flex flex-col gap-2 pt-4">
        <Row label="Deploy cost">{ethValue(econ.deployFeeWei)}</Row>
        <Row label="Starting price">{startingPrice}</Row>
        <Row label="Supply">{supply}</Row>
        <Row label="Trade fee">{tradeFee}</Row>
        <Row label="Graduation">{ethValue(econ.graduationEthWei)}</Row>
      </dl>
      {/* The exact, single-sourced LP sentence — verbatim (§12.14). */}
      <MonoText tone="faint" size="xs" className="pt-3 leading-relaxed">
        {LP_DESTINY_COPY}
      </MonoText>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <MonoText tone="muted" size="sm" className="shrink-0">
        {label}
      </MonoText>
      <MonoText tone="secondary" size="sm" numeric className="text-right">
        {children}
      </MonoText>
    </div>
  );
}

function liveHint(available: boolean, isError: boolean): string {
  if (isError) return "on-chain read unavailable";
  return available ? "reading…" : "read on-chain";
}
