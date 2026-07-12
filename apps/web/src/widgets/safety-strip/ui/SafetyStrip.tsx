"use client";

import { TOTAL_SUPPLY_WEI, type TokenDetail, tokenTrades } from "@robbed/shared";
import { formatUnits } from "viem";
import type { Address } from "viem";

import { useCurveReads } from "@/entities/curve";
import { AddressLink, Button, MonoLabel, ProgressBar } from "@/shared/ui";
import { LP_DESTINY_COPY } from "@/shared/config/copy";
import { ROBBED, isPlaceholder } from "@/shared/config/addresses";
import { useWsChannel } from "@/shared/lib/ws";
import { formatEthFromWei, formatTokenFromWei } from "@/shared/lib/format";

/**
 * Safety strip (§12.57) — the compact relocation of the Trust panel's HARD-RULE
 * must-render floor after the panel's deletion (§12.57/§12.58). It renders, in a
 * slim strip above the Top Holders table, the three signals that may NOT vanish:
 *
 *   1. LP destination — the ONE shared `LP_COPY` constant, VERBATIM (§12.14 hard
 *      rule; copy-lint asserts its PRESENCE on token detail).
 *   2. Graduation progress toward `GRADUATION_ETH` — LIVE on-chain reserves ÷
 *      threshold (never the API's cached progress).
 *   3. Live curve reserves — LIVE `reserves()` realEth/realToken (pre-grad),
 *      read FROM CHAIN, never the API's cached copy; post-grad → curve retired.
 *
 * Plus the cheap-to-keep signals (§12.57 RECOMMENDED): ownerless ✓, fixed-1B ✓
 * (LIVE `totalSupply`), the metadata content-hash verdict (indexer), and the
 * "1% → treasury" fee (LIVE bps). DROPPED from the public page (§12.57): the
 * standalone organic-holder range + flow-quality blocks (preserved on the §12.54
 * internal endpoint; the surviving §8.5 signal is the holders-table flags).
 *
 * On-chain rows come from `useCurveReads` (batched viem reads on the per-token
 * curve/token addresses), refetched on every WS trade. On RPC failure a row shows
 * "on-chain read unavailable" — NEVER a cached API value.
 */
export function SafetyStrip({ token }: { token: TokenDetail }) {
  const reads = useCurveReads(
    token.address as Address,
    token.curveAddress as Address,
  );

  useWsChannel(tokenTrades(token.address), (msg) => {
    if (msg.type === "trade") reads.refetch();
  });

  const graduated = token.graduated || token.status === "graduated";
  const loading = reads.isLoading;
  const reserves = reads.reserves;
  // A read is "unavailable" once it has SETTLED with no value (revert / RPC down)
  // — never substituted with the API's cached reserves (spec §5.2).
  const showRetry = !loading && (reads.isError || reserves === null);
  const realEth = reserves?.realEth ?? null;
  const graduationEth = reads.graduationEth;
  const supplyOk = reads.totalSupply !== null && reads.totalSupply === TOTAL_SUPPLY_WEI;
  const pct =
    realEth !== null && graduationEth !== null && graduationEth > 0n
      ? (Number(formatUnits(realEth, 18)) / Number(formatUnits(graduationEth, 18))) * 100
      : null;

  return (
    // FLAT region: a hairline-bounded strip above the holders table (right rail),
    // matching the rail padding. No Card fill.
    <div className="flex flex-col gap-2.5 border-b border-border px-5 py-4">
      <div className="flex items-center justify-between">
        <MonoLabel size="xs" className="text-text-tertiary">
          Safety
        </MonoLabel>
        {showRetry && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => reads.refetch()}
          >
            Retry reads
          </Button>
        )}
      </div>

      {/* Graduation progress toward GRADUATION_ETH (LIVE reserves ÷ threshold). */}
      {graduated ? (
        <div className="flex items-center justify-between text-xs">
          <span className="text-green">Graduated ✓ → Uniswap V3</span>
          {token.v3PoolAddress && (
            <AddressLink address={token.v3PoolAddress} kind="address" label="pool ↗" />
          )}
        </div>
      ) : pct === null ? (
        <p className="text-xs text-muted-foreground">
          {loading ? "reading chain…" : "on-chain read unavailable — retry"}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <ProgressBar pct={pct} showValue={false} />
          <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
            <span>
              {formatEthFromWei(realEth!)} / {formatEthFromWei(graduationEth!)} ETH raised
            </span>
            <span>{pct.toFixed(1)}%</span>
          </div>
        </div>
      )}

      {/* Live curve reserves (LIVE reserves — read FROM CHAIN, never cached API). */}
      <div className="text-xs">
        <span className="text-text-tertiary">Curve reserves </span>
        {graduated ? (
          <span className="text-muted-foreground">
            curve retired — {realEth !== null ? formatEthFromWei(realEth) : "0"} ETH held
          </span>
        ) : reserves === null ? (
          <span className="text-muted-foreground">
            {loading ? "reading chain…" : "on-chain read unavailable — retry"}
          </span>
        ) : (
          <span className="tabular-nums text-text">
            {formatEthFromWei(reserves.realEth)} ETH ·{" "}
            {formatTokenFromWei(reserves.realToken)} tokens{" "}
            <span className="text-muted-foreground">— read from chain</span>
          </span>
        )}
      </div>

      {/* Cheap-to-keep ticks: ownerless ✓ · fixed 1B ✓ · metadata verdict · fee. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <Tick ok label="Ownerless token" />
        <Tick ok={supplyOk} label={FIXED_SUPPLY_LABEL} pending={reads.totalSupply === null} />
        <MetadataTick verification={token.trust.metadataVerification} />
        <FeeTick feeBps={reads.tradeFeeBps} />
        <AddressLink address={token.address} kind="token" label="verify ↗" />
      </div>

      {/* LP destination — the ONE canonical sentence, VERBATIM (§12.14). */}
      <p className="text-xs text-muted-foreground">
        {LP_DESTINY_COPY}
        {graduated && !isPlaceholder(ROBBED.lpFeeVault) && (
          <>
            {" "}
            <AddressLink address={ROBBED.lpFeeVault} kind="address" label="vault ↗" />
          </>
        )}
      </p>
    </div>
  );
}

/** "1,000,000,000 fixed" derived from the shared supply constant (not a literal). */
const FIXED_SUPPLY_LABEL = `${Number(formatUnits(TOTAL_SUPPLY_WEI, 18)).toLocaleString("en-US")} fixed`;

function Tick({
  ok,
  label,
  pending = false,
}: {
  ok: boolean;
  label: string;
  pending?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={ok ? "text-green" : pending ? "text-muted" : "text-red"}
      >
        {ok ? "✓" : pending ? "…" : "⚠"}
      </span>
      <span className="text-text-secondary">{label}</span>
    </span>
  );
}

function MetadataTick({
  verification,
}: {
  verification: TokenDetail["trust"]["metadataVerification"];
}) {
  if (verification.status === "mismatch") {
    return (
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="text-red">
          ⚠
        </span>
        <span className="font-semibold text-sell">Metadata MISMATCH</span>
      </span>
    );
  }
  if (verification.status === "unfetched") {
    return <Tick ok={false} pending label="Metadata verifying…" />;
  }
  return <Tick ok label="Metadata matches" />;
}

function FeeTick({ feeBps }: { feeBps: number | null }) {
  if (feeBps === null) {
    return <span className="text-muted-foreground">fee reading…</span>;
  }
  const pct = feeBps / 100;
  const label = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2).replace(/0+$/, "")}%`;
  return <span className="text-text-secondary">{label} → treasury</span>;
}
