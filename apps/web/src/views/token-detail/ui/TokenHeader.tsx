import type { TokenDetail } from "@robbed/shared";

import { AddTokenToWalletButton } from "@/features/add-token-to-wallet";
import { TokenAddressLink } from "@/entities/token";
import {
  CopyAddressButton,
  Delta,
  EthAmount,
  MonoLabel,
  MonoText,
  PriceEth,
  RelativeTime,
  SideBadge,
  StatCell,
  TokenAvatar,
  UsdAmount,
} from "@/shared/ui";

/**
 * Token Detail above-the-fold header (web.md) — ROBBED_ terminal skin
 * (redesign mockup, — panel "2a Token detail"). Rendered inside the client island (TD-6)
 * so the status pill tracks the LIVE token status, but still
 * SERVER-pre-rendered: the identity row (avatar · NAME TICKER ·
 * addr·created·creator) and the stat cells (PRICE / VOL 24H / 24H / MCAP /
 * RAISED/TARGET ETH) are meaningful without client JS so crawlers and JS-off
 * users get the pitch (SSR-vs-client decision, web.md).
 *
 * All metrics are indexer/on-chain SUPPLIED values : PRICE = `priceEth`,
 * VOL 24H = `volume24h` (ETH wei, ETH-first denomination), 24H = `change24hPct`,
 * MCAP = the live-priced `mcap` (source+asOf disclosed by `UsdAmount`), and
 * raised/target ETH = `reserves.realEth` / `graduation.thresholdEth`. No metric
 * is computed or hardcoded here.
 */
export function TokenHeader({ token }: { token: TokenDetail }) {
  return (
    // Full-bleed identity row (fidelity audit fix 2; template 2a line 351):
    // border-bottom ONLY — no side/top border, no fill — padding 16px 24px,
    // gap 14px.
    <div className="flex flex-col gap-3.5 px-4 py-4 md:flex-row md:items-center md:gap-6 sm:px-6">
      {/* ── Identity: avatar · NAME TICKER · addr·created·creator ─────────── */}
      <div className="flex min-w-0 items-center gap-3.5">
        <TokenAvatar
          imageUrl={token.imageUrl}
          name={token.name}
          ticker={token.ticker}
          size={34}
          className="h-[34px] w-[34px]"
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
          <MonoText tone="faint" size="xs" className="flex items-center truncate">
            <TokenAddressLink address={token.address} kind="token" tone="faint" />
            <CopyAddressButton value={token.address} className="ml-1" />
            <AddTokenToWalletButton token={token} className="ml-1" />
          </MonoText>
        </div>
      </div>

      {/* ── Stat cells — wrap on mobile; mockup container is text-align:right ── */}
      <div className="grid grid-cols-3 gap-x-6 gap-y-3 sm:grid-cols-5 md:ml-auto md:flex md:flex-wrap md:items-start md:justify-end md:gap-x-7">
        <StatCell label="Price" align="right">
          {token.priceEth === null ? (
            <MonoText tone="muted">—</MonoText>
          ) : (
            // Compact subscript for the tiny curve prices memecoins live at
            // (0.0₁₀63 ETH), plain decimal at normal magnitude (format-price.ts).
            <PriceEth value={token.priceEth} unit="ETH" />
          )}
        </StatCell>
        <StatCell label="Vol 24H" align="right">
          <EthAmount wei={token.volume24h} />
        </StatCell>
        <StatCell label="24H" align="right">
          <Delta value={token.change24hPct} className="text-sm" />
        </StatCell>
        <StatCell label="Mcap" align="right">
          <UsdAmount value={token.mcap} />
        </StatCell>
        <RaisedTargetCell token={token} />
      </div>
    </div>
  );
}

/**
 * Raised-vs-target ETH, read from the token payload. The threshold varies per
 * token and is not a constant.
 */
function RaisedTargetCell({ token }: { token: TokenDetail }) {
  const graduated = token.graduated || token.status === "graduated";
  return (
    // Right-aligned like the StatCells (mockup line 363: justify-content:flex-end).
    <div className="flex min-w-0 flex-col gap-0.5 md:items-end md:text-right">
      <MonoLabel>Raised</MonoLabel>
      {graduated ? (
        <MonoText tone="green" size="sm">
          Graduated
        </MonoText>
      ) : (
        <MonoText tone="faint" size="xs" numeric>
          <EthAmount wei={token.reserves.realEth} unit={null} />
          {" / "}
          <EthAmount wei={token.graduation.thresholdEth} />
        </MonoText>
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
      return null;
  }
}
