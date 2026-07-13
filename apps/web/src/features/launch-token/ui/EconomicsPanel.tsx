"use client";

import { formatEther, formatUnits } from "viem";
import { TOTAL_SUPPLY_WEI } from "@robbed/shared";

import { describeFeeSplit } from "@/entities/curve";
import { MonoText } from "@/shared/ui";
import { LP_DESTINY_COPY } from "@/shared/config/copy";
import { formatEthFromWei, formatEthNumber } from "@/shared/lib/format";

import { useLaunchEconomics } from "../model/use-launch-economics";

/**
 * "Economics displayed plainly" (§5.3) — ROBBED_ terminal summary block
 * (redesign mockup, spec §12.50 — panel "Create"): a hairline-topped stack of label→value rows,
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

  // Fee split read LIVE from the factory config (§12.63) — treasury + creator.
  const split = describeFeeSplit(econ.tradeFeeBps, econ.tradeFeeBps === null ? null : econ.creatorFeeBps ?? 0);
  const tradeFee = split
    ? split.hasCreatorShare
      ? `${split.totalPct} — ${split.treasuryPct} treasury + ${split.creatorPct} creator`
      : `${split.treasuryPct} curve fee → treasury`
    : liveHint(econ.available, econ.isError);

  return (
    <div className="flex flex-col">
      {/* Mockup 2b summary (template 472): border-soft hairline top, 14px top
          pad, 7px row gap, one 11.5px muted color across the whole block. */}
      <div className="h-px w-full bg-border-soft" />
      <dl className="flex flex-col gap-[7px] pt-3.5">
        <Row label="Deploy cost">{ethValue(econ.deployFeeWei)}</Row>
        <Row label="Starting price">{startingPrice}</Row>
        <Row label="Supply">{supply}</Row>
        <Row label="Trade fee">{tradeFee}</Row>
        {split?.hasCreatorShare && (
          <Row label="You earn">
            {`${split.creatorPct} of every trade — before & after graduation`}
          </Row>
        )}
        <Row label="Graduation">{ethValue(econ.graduationEthWei)}</Row>
      </dl>
      {/* Creator-fee disclosure (§12.68 pre-grad + §12.69 post-grad): the creator
          rate is VENUE-INVARIANT — the same live-read % on the bonding curve and,
          after graduation, on Uniswap V3 (the 50/50 LP-fee split). Read live from
          the factory config, never an inlined knob (§2, §12.68). */}
      {split?.hasCreatorShare && (
        <MonoText tone="faint" size="xs" className="pt-3 leading-relaxed">
          {`You keep ${split.creatorPct} of trading volume for the life of the token — on the bonding curve now, and on Uniswap after it graduates.`}
        </MonoText>
      )}
      {/* The exact, single-sourced LP sentence — verbatim (§12.14). */}
      <MonoText tone="faint" size="xs" className="pt-3 leading-relaxed">
        {LP_DESTINY_COPY}
      </MonoText>
    </div>
  );
}

/**
 * Mockup 2b (template 472-475): label AND value share the single muted token
 * at 11.5px — raw spans, not MonoText, because `text-xs-plus` is a
 * custom size utility tailwind-merge would misclassify as a color and drop the
 * tone class.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs-plus text-muted">
      <dt className="shrink-0">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

function liveHint(available: boolean, isError: boolean): string {
  if (isError) return "on-chain read unavailable";
  return available ? "reading…" : "read on-chain";
}
