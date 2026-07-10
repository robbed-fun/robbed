"use client";

import { type HolderRow, type TokenDetail, tokenTrades } from "@robbed/shared";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import {
  BOT_FLAG_LABELS,
  HOLDER_FLAG_LABELS,
  groupHoldersByCluster,
} from "@/entities/holder";
import { AddressLink, Badge, Card, ProgressBar } from "@/shared/ui";
import { getHolders } from "@/shared/api";
import { qk } from "@/shared/lib/query-keys";
import { useWsChannel } from "@/shared/lib/ws";
import { formatPercent, formatTokenFromWei, shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * Holder distribution — top 20 (§5.2). Structural flags (creator / bonding curve /
 * LP pool / LP fee vault) plus the v1.2 funding-cluster grouping: rows sharing a
 * `clusterId` (same gas-funding source, §8.5) are visually grouped and `botFlags`
 * render as small ADVISORY badges — heuristic labels only, gating nothing (spec
 * §5.2/§8.5). Refreshes on WS trades, throttled ≥5s (web.md §3.2).
 */
export function HolderTable({
  token,
  initialData,
}: {
  token: TokenDetail;
  initialData?: { holders: HolderRow[]; holderCount: number };
}) {
  const query = useQuery({
    queryKey: qk.holders(token.address),
    queryFn: ({ signal }) => getHolders(token.address, { limit: 20 }, { signal }),
    initialData,
    staleTime: 5_000,
  });

  const lastRefetch = useRef(0);
  useWsChannel(tokenTrades(token.address), (msg) => {
    if (msg.type !== "trade") return;
    const now = Date.now();
    if (now - lastRefetch.current < 5_000) return; // throttle ≥5s
    lastRefetch.current = now;
    void query.refetch();
  });

  const holders = query.data?.holders ?? [];
  const clusters = groupHoldersByCluster(holders);
  let rank = 0;

  return (
    <Card className="flex flex-col p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Top holders</h3>
        {query.data?.holderCount !== undefined && (
          <span className="text-xs text-muted-foreground">
            {query.data.holderCount.toLocaleString("en-US")} holders
          </span>
        )}
      </div>

      {holders.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No holders yet — the bonding curve holds the full supply until the first
          trade.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {clusters.map((cluster, ci) =>
            cluster.clusterId ? (
              <div
                key={`cluster-${cluster.clusterId}`}
                className="rounded-md border border-soft-confirmed/30 bg-soft-confirmed/5 p-1"
              >
                <div className="px-1 pb-0.5 text-[10px] uppercase tracking-wide text-soft-confirmed">
                  Funding cluster · {cluster.rows.length} addresses (heuristic)
                </div>
                {cluster.rows.map((h) => (
                  <HolderRowItem key={h.address} holder={h} rank={++rank} />
                ))}
              </div>
            ) : (
              <HolderRowItem key={cluster.rows[0]!.address} holder={cluster.rows[0]!} rank={++rank} />
            ),
          )}
        </div>
      )}
    </Card>
  );
}

function HolderRowItem({ holder, rank }: { holder: HolderRow; rank: number }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-xs">
      <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{rank}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1">
          <AddressLink address={holder.address} kind="address" label={shortAddress(holder.address)} />
          {holder.flags.map((f) => (
            <Badge key={f} variant="outline" className="px-1 py-0 text-[10px]">
              {HOLDER_FLAG_LABELS[f]}
            </Badge>
          ))}
          {holder.botFlags?.map((b) => (
            <Badge
              key={b}
              variant="soft-confirmed"
              className="px-1 py-0 text-[10px]"
              title="Advisory heuristic label (§8.5) — not a fact, gates nothing"
            >
              {BOT_FLAG_LABELS[b]}
            </Badge>
          ))}
        </div>
        <ProgressBar pct={holder.pct} showValue={false} />
      </div>
      <div className="flex w-24 shrink-0 flex-col items-end">
        <span className="tabular-nums text-foreground">{formatTokenFromWei(holder.balance)}</span>
        <span className="tabular-nums text-muted-foreground">{formatPercent(holder.pct)}</span>
      </div>
    </div>
  );
}
