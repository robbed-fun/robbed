import type { TokenDetail } from "@robbed/shared";

import {
  Delta,
  EthAmount,
  MonoLabel,
  MonoText,
  RelativeTime,
  SideBadge,
  StatCell,
  TokenAvatar,
  UsdAmount,
} from "@/shared/ui";
import { shortAddress } from "@/shared/lib/format";

/**
 * Token Detail above-the-fold header (§5.2, web.md §3.2) — ROBBED_ terminal skin
 * (docs/Robbed.html "2a Token detail"). SERVER-rendered: the identity row
 * (avatar · NAME TICKER · addr·created·creator) and the stat cells (PRICE /
 * VOL 24H / 24H / MCAP / HOLDERS / BONDING) are meaningful without client JS so
 * crawlers and JS-off users get the pitch (SSR-vs-client decision, web.md).
 *
 * All metrics are indexer/on-chain SUPPLIED values (§2): PRICE = `priceEth`,
 * VOL 24H = `volume24h` (ETH wei, ETH-first denomination), 24H = `change24hPct`,
 * MCAP = the live-priced `mcap` (source+asOf disclosed by `UsdAmount`), HOLDERS =
 * the SSR holders page count, BONDING = `graduation.progressPct`. No metric is
 * computed or hardcoded here.
 */
export function TokenHeader({
  token,
  holderCount,
}: {
  token: TokenDetail;
  holderCount?: number;
}) {
  return (
    <div className="flex flex-col gap-4 border border-border bg-bg p-4 md:flex-row md:items-center md:gap-6">
      {/* ── Identity: avatar · NAME TICKER · addr·created·creator ─────────── */}
      <div className="flex min-w-0 items-center gap-3">
        <TokenAvatar
          imageUrl={token.imageUrl}
          name={token.name}
          ticker={token.ticker}
          size={40}
          className="h-10 w-10"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <MonoText size="lg" className="truncate font-semibold">
              {token.name}
            </MonoText>
            <MonoText tone="faint" size="sm">
              {token.ticker}
            </MonoText>
            <StatusTag status={token.status} />
          </div>
          <MonoText tone="faint" size="xs" className="truncate">
            {shortAddress(token.address)} · created{" "}
            <RelativeTime unixSeconds={token.createdAt} /> ago by{" "}
            {shortAddress(token.creator.address)}
          </MonoText>
        </div>
      </div>

      {/* ── Stat cells — wrap on mobile, right-aligned row on desktop ─────── */}
      <div className="grid grid-cols-3 gap-x-6 gap-y-3 sm:grid-cols-6 md:ml-auto md:flex md:flex-wrap md:items-start md:justify-end md:gap-x-7">
        <StatCell label="Price">
          {token.priceEth === null ? (
            <MonoText tone="muted">—</MonoText>
          ) : (
            <EthAmount eth={token.priceEth} />
          )}
        </StatCell>
        <StatCell label="Vol 24H">
          <EthAmount wei={token.volume24h} />
        </StatCell>
        <StatCell label="24H">
          <Delta value={token.change24hPct} className="text-sm" />
        </StatCell>
        <StatCell label="Mcap">
          <UsdAmount value={token.mcap} />
        </StatCell>
        <StatCell label="Holders">
          {holderCount === undefined ? (
            <MonoText tone="muted">—</MonoText>
          ) : (
            <MonoText numeric>{holderCount.toLocaleString("en-US")}</MonoText>
          )}
        </StatCell>
        <BondingCell token={token} />
      </div>
    </div>
  );
}

/**
 * BONDING stat cell — the mockup's mini progress track + percent (or a
 * "Graduated" verdict post-grad). `progressPct` is the indexer value, clamped for
 * bar geometry only.
 */
function BondingCell({ token }: { token: TokenDetail }) {
  const graduated = token.graduated || token.status === "graduated";
  const pct = Math.max(0, Math.min(100, token.graduation.progressPct));
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <MonoLabel>Bonding</MonoLabel>
      {graduated ? (
        <MonoText tone="green" size="sm">
          Graduated
        </MonoText>
      ) : (
        <div className="flex items-center gap-2">
          <span className="h-1 w-14 bg-active" aria-hidden>
            <span className="block h-1 bg-green" style={{ width: `${pct}%` }} />
          </span>
          <MonoText numeric size="sm">
            {pct.toFixed(0)}%
          </MonoText>
        </div>
      )}
    </div>
  );
}

function StatusTag({ status }: { status: TokenDetail["status"] }) {
  switch (status) {
    case "graduated":
      return <SideBadge side="graduate" label="GRADUATED → V3" />;
    case "graduating":
      return <SideBadge side="graduate" label="GRADUATING" />;
    default:
      return (
        <MonoLabel tone="green" size="2xs">
          BONDING
        </MonoLabel>
      );
  }
}
