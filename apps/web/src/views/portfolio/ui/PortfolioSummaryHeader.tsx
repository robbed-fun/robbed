"use client";

import {
  AddressChip,
  EthAmount,
  ErrorState,
  MonoText,
  Skeleton,
  StatCell,
  UsdAmount,
} from "@/shared/ui";
import {
  PnlRange,
  formatFirstSeen,
  usePortfolioSummary,
} from "@/entities/portfolio";

/**
 * Portfolio address summary (mockup "2c"): avatar · `address · you` ·
 * `first seen … · N trades` · the stat cells TOTAL VALUE / LOOT ALL-TIME /
 * WALLET ETH. Values are the `/v1/portfolio/:address` roll-up — ETH-first, with
 * USD surfaced via `UsdAmount` (live source + timestamp, §2). PnL renders as its
 * honest range/nullable form (§5.2). Mobile: the identity block stacks above the
 * stat cells (which themselves stack), per the redesign's mobile rule.
 */
export function PortfolioSummaryHeader({
  address,
  isSelf,
}: {
  address: string;
  isSelf: boolean;
}) {
  const { data, isLoading, isError, refetch } = usePortfolioSummary(address);

  return (
    // Mockup 2c (template.html:497): 18px vertical padding, 14px identity gap.
    <section className="flex flex-col gap-5 border-b border-border px-4 py-[18px] md:flex-row md:items-center md:gap-6 md:px-6">
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="h-[34px] w-[34px] shrink-0 rounded-full bg-active"
        />
        <div className="flex flex-col gap-0.5">
          {/* Per-instance: 15px address with an 11px "· you" suffix
              (template.html:500) — the AddressChip atom default stays 12px. */}
          <AddressChip
            address={address}
            suffix={isSelf ? "you" : undefined}
            className="text-lg text-text [&>span]:text-xs"
          />
          <MonoText tone="faint" size="xs">
            {isLoading ? (
              "loading…"
            ) : data ? (
              <>
                {formatFirstSeen(data.firstSeenAt)} · {data.tradeCount}{" "}
                {data.tradeCount === 1 ? "trade" : "trades"}
              </>
            ) : (
              "—"
            )}
          </MonoText>
        </div>
      </div>

      {isError ? (
        <ErrorState
          className="md:ml-auto md:max-w-xs"
          title="Couldn't load summary"
          onRetry={() => void refetch()}
        />
      ) : (
        <div className="flex flex-col gap-4 md:ml-auto md:flex-row md:gap-8">
          <div className="flex flex-col items-start gap-0.5 md:items-end">
            <StatCell label="Total value" size="lg" className="md:items-end md:text-right">
              {isLoading || !data ? (
                <Skeleton className="h-5 w-20" />
              ) : (
                <EthAmount wei={data.totalValueEth} unit="ETH" />
              )}
            </StatCell>
            {data ? (
              <UsdAmount value={data.totalValue} className="text-2xs text-muted" />
            ) : null}
          </div>

          <StatCell label="Loot all-time" size="lg" className="md:items-end md:text-right">
            {isLoading || !data ? (
              <Skeleton className="h-5 w-20" />
            ) : (
              // Mockup "+1.94 ETH" — unit shown, same color (template.html:505).
              <PnlRange range={data.pnlAllTime} unit="ETH" className="text-lg" />
            )}
          </StatCell>

          <StatCell label="Wallet ETH" size="lg" className="md:items-end md:text-right">
            {isLoading || !data ? (
              <Skeleton className="h-5 w-16" />
            ) : (
              // Mockup leaves WALLET ETH on the inherited body color — the
              // text-secondary token (template.html:506) — while TOTAL VALUE is
              // explicitly the bright text token; override per-instance.
              <EthAmount
                wei={data.walletEthBalance}
                unit={null}
                className="text-text-secondary"
              />
            )}
          </StatCell>
        </div>
      )}
    </section>
  );
}
