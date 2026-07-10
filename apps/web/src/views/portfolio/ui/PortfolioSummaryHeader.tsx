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
    <section className="flex flex-col gap-5 border-b border-border px-4 py-5 md:flex-row md:items-center md:gap-6 md:px-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="h-[34px] w-[34px] shrink-0 rounded-full bg-surface-2"
        />
        <div className="flex flex-col gap-0.5">
          <AddressChip
            address={address}
            suffix={isSelf ? "you" : undefined}
            className="text-text"
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
              <PnlRange range={data.pnlAllTime} className="text-lg" />
            )}
          </StatCell>

          <StatCell label="Wallet ETH" size="lg" className="md:items-end md:text-right">
            {isLoading || !data ? (
              <Skeleton className="h-5 w-16" />
            ) : (
              <EthAmount wei={data.walletEthBalance} unit={null} />
            )}
          </StatCell>
        </div>
      )}
    </section>
  );
}
