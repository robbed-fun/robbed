"use client";

import { TOTAL_SUPPLY_WEI, type TokenDetail, tokenTrades } from "@robbed/shared";
import { formatUnits } from "viem";
import type { Address } from "viem";

import { useCurveReads } from "@/entities/curve";
import { AddressLink, Button, MonoLabel } from "@/shared/ui";
import { LP_DESTINY_COPY } from "@/shared/config/copy";
import { ROBBED, isPlaceholder } from "@/shared/config/addresses";
import { useWsChannel } from "@/shared/lib/ws";
import { formatEthFromWei, formatTokenFromWei } from "@/shared/lib/format";

import { TrustRow } from "./TrustRow";
import { OrganicMetrics } from "./OrganicMetrics";

/**
 * Trust panel (§5.2, §8.3) — the differentiator. Seven rows, each with EXACT
 * sourcing. This component is the enforcement point for the "live reads are live,
 * never cached-API" rule (spec §5.2, web.md §3.2):
 *
 *   Row 1 Ownerless           — structural guarantee (LaunchToken has no owner),
 *                               verified-source Blockscout link. INDEXER/structural.
 *   Row 2 Fixed 1B supply     — LIVE `totalSupply()` === 1e27 wei. ON-CHAIN.
 *   Row 3 Live curve reserves — LIVE `reserves()` realEth/realToken. ON-CHAIN,
 *                               never the API's `reserves` field. Post-grad → 0.
 *   Row 4 Graduation progress — LIVE `GRADUATION_ETH()` + realEth/threshold. ON-CHAIN.
 *   Row 5 LP destination      — the ONE shared constant, verbatim. FIXED COPY.
 *   Row 6 Fee policy          — LIVE `TRADE_FEE_BPS()`, number rendered from chain. ON-CHAIN.
 *   Row 7 Metadata verdict    — `trust.metadataVerification.status`. INDEXER VERDICT.
 *   + v1.2 organic rows       — `trust.organic`. INDEXER (advisory, §8.5).
 *
 * The on-chain rows come from `useCurveReads` (batched viem reads on the per-token
 * curve/token addresses), polled ~5s and refetched on every WS trade. On RPC
 * failure the rows show "on-chain read unavailable — retry" — NEVER the API's
 * cached reserves.
 */
export function TrustPanel({ token }: { token: TokenDetail }) {
  const reads = useCurveReads(
    token.address as Address,
    token.curveAddress as Address,
  );

  // Refresh live reads on each WS trade for this token (web.md §3.2).
  useWsChannel(tokenTrades(token.address), (msg) => {
    if (msg.type === "trade") reads.refetch();
  });

  const graduated = token.graduated || token.status === "graduated";
  const feeBps = reads.tradeFeeBps;
  const readUnavailable = reads.isError && !reads.isLoading;

  return (
    // FLAT region (fidelity audit fix 1): the panel sits in the right rail below
    // the trade widget with only a hairline top border delimiting it — no Card
    // border/fill. Padding matches the rail (18px/20px horizontal rhythm).
    <div className="border-t border-border px-5 py-4">
      <div className="mb-1 flex items-center justify-between border-b border-border pb-2">
        <MonoLabel size="xs" className="text-text-tertiary">
          Trust panel
        </MonoLabel>
        {readUnavailable && (
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

      {/* 1 — Ownerless (structural + verified source) */}
      <TrustRow
        label="Ownerless token"
        tone="ok"
        verify={<AddressLink address={token.address} kind="token" label="verify ↗" />}
      >
        No owner, no mint, no blacklist — verified contract
      </TrustRow>

      {/* 2 — Fixed 1B supply (LIVE totalSupply) */}
      <SupplyRow totalSupply={reads.totalSupply} isError={readUnavailable} />

      {/* 3 — Live curve reserves (LIVE reserves, never cached API) */}
      <TrustRow label="Live curve reserves" tone={graduated ? "neutral" : "ok"}>
        {graduated ? (
          <span className="text-muted-foreground">
            Curve retired — {reads.reserves ? formatEthFromWei(reads.reserves.realEth) : "0"} ETH
            held
          </span>
        ) : readUnavailable || reads.reserves === null ? (
          <UnavailableValue loading={reads.isLoading} />
        ) : (
          <span>
            <span className="tabular-nums">
              {formatEthFromWei(reads.reserves.realEth)} ETH
            </span>
            <span className="mx-1 text-muted-foreground">·</span>
            <span className="tabular-nums">
              {formatTokenFromWei(reads.reserves.realToken)} tokens
            </span>{" "}
            <span className="text-xs text-muted-foreground">— read from chain</span>
          </span>
        )}
      </TrustRow>

      {/* 4 — Graduation threshold + progress (LIVE GRADUATION_ETH + realEth) */}
      <GraduationRow
        graduated={graduated}
        realEth={reads.reserves?.realEth ?? null}
        graduationEth={reads.graduationEth}
        graduatedAt={token.graduatedAt}
        poolAddress={token.v3PoolAddress}
        isError={readUnavailable}
        loading={reads.isLoading}
      />

      {/* 5 — LP destination (the ONE canonical sentence, verbatim) */}
      <TrustRow
        label="LP destination"
        tone="neutral"
        verify={
          graduated && !isPlaceholder(ROBBED.lpFeeVault) ? (
            <AddressLink address={ROBBED.lpFeeVault} kind="address" label="vault ↗" />
          ) : undefined
        }
      >
        {LP_DESTINY_COPY}
      </TrustRow>

      {/* 6 — Fee policy (LIVE TRADE_FEE_BPS — number from chain, not a literal) */}
      <TrustRow label="Fee policy" tone="ok">
        {feeBps === null ? (
          <UnavailableValue loading={reads.isLoading} />
        ) : (
          <span>
            <span className="tabular-nums">{formatFeeBps(feeBps)}</span> curve fee →
            treasury
          </span>
        )}
      </TrustRow>

      {/* 7 — Metadata hash verdict (INDEXER verdict, never client-recomputed) */}
      <MetadataRow verification={token.trust.metadataVerification} />

      {/* v1.2 organic-flow metrics (indexer, advisory) */}
      <OrganicMetrics organic={token.trust.organic} />
    </div>
  );
}

/** "1,000,000,000 fixed" derived from the shared supply constant (not a literal). */
const FIXED_SUPPLY_LABEL = `${Number(formatUnits(TOTAL_SUPPLY_WEI, 18)).toLocaleString("en-US")} fixed`;

function SupplyRow({
  totalSupply,
  isError,
}: {
  totalSupply: bigint | null;
  isError: boolean;
}) {
  if (totalSupply === null) {
    return (
      <TrustRow label="Fixed 1B supply" tone={isError ? "warn" : "pending"}>
        <UnavailableValue loading={!isError} />
      </TrustRow>
    );
  }
  const ok = totalSupply === TOTAL_SUPPLY_WEI;
  return (
    <TrustRow label="Fixed 1B supply" tone={ok ? "ok" : "warn"}>
      {ok ? (
        FIXED_SUPPLY_LABEL
      ) : (
        <span className="text-sell">
          Unexpected supply {formatTokenFromWei(totalSupply)} — verify on chain
        </span>
      )}
    </TrustRow>
  );
}

function GraduationRow({
  graduated,
  realEth,
  graduationEth,
  graduatedAt,
  poolAddress,
  isError,
  loading,
}: {
  graduated: boolean;
  realEth: bigint | null;
  graduationEth: bigint | null;
  graduatedAt?: number;
  poolAddress?: string;
  isError: boolean;
  loading: boolean;
}) {
  if (graduated) {
    return (
      <TrustRow
        label="Graduation"
        tone="ok"
        verify={poolAddress ? <AddressLink address={poolAddress} kind="address" label="pool ↗" /> : undefined}
      >
        Graduated ✓
        {graduatedAt ? (
          <span className="ml-1 text-xs text-muted-foreground">
            {new Date(graduatedAt * 1000).toISOString().slice(0, 10)}
          </span>
        ) : null}
      </TrustRow>
    );
  }
  if (realEth === null || graduationEth === null || graduationEth === 0n) {
    return (
      <TrustRow label="Graduation progress" tone={isError ? "warn" : "pending"}>
        <UnavailableValue loading={loading} />
      </TrustRow>
    );
  }
  const pct =
    (Number(formatUnits(realEth, 18)) / Number(formatUnits(graduationEth, 18))) * 100;
  return (
    <TrustRow label="Graduation progress" tone="neutral">
      <span className="tabular-nums">
        {formatEthFromWei(realEth)} of {formatEthFromWei(graduationEth)} ETH raised
      </span>
      <span className="ml-1 text-xs text-muted-foreground">
        ({pct.toFixed(1)}%)
      </span>
    </TrustRow>
  );
}

function MetadataRow({
  verification,
}: {
  verification: TokenDetail["trust"]["metadataVerification"];
}) {
  if (verification.status === "mismatch") {
    return (
      <TrustRow label="Metadata verdict" tone="warn" className="rounded-md bg-sell/5">
        <span className="font-semibold text-sell">
          MISMATCH — metadata changed after launch
        </span>
      </TrustRow>
    );
  }
  if (verification.status === "unfetched") {
    return (
      <TrustRow label="Metadata verdict" tone="pending">
        <span className="text-muted-foreground">verifying metadata…</span>
      </TrustRow>
    );
  }
  return (
    <TrustRow label="Metadata verdict" tone="ok">
      Metadata matches on-chain commitment
    </TrustRow>
  );
}

function UnavailableValue({ loading }: { loading: boolean }) {
  if (loading) return <span className="text-muted-foreground">reading chain…</span>;
  return (
    <span className="text-muted-foreground">on-chain read unavailable — retry</span>
  );
}

/** bps → "1%" / "1.5%" (rendered from the on-chain value, never a copy literal). */
function formatFeeBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct.toString() : pct.toFixed(2).replace(/0+$/, "")}%`;
}
