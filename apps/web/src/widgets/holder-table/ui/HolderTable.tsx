"use client";

import { type HolderRow, type TokenDetail, tokenTrades } from "@robbed/shared";
import { useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  type Row,
  type SortingFn,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Fragment, useRef } from "react";

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

/**
 * Holder distribution — top 20 (§5.2). Structural flags (creator / bonding curve /
 * LP pool / LP fee vault) plus the v1.2 funding-cluster grouping: rows sharing a
 * `clusterId` (same gas-funding source, §8.5) are visually grouped and `botFlags`
 * render as small ADVISORY badges — heuristic labels only, gating nothing (spec
 * §5.2/§8.5). Refreshes on WS trades, throttled ≥5s (web.md §3.2).
 *
 * Driven by a headless `@tanstack/react-table` row model (v8, docs-first
 * tanstack.com/table 2026-07-10): typed `ColumnDef<HolderRow>[]` supply each
 * row's cells (address+flags+progress · balance+pct), the BALANCE column is
 * sortable (spec-directed "holders by balance"; default order = the API's
 * balance-DESC ranking, so no sort is applied and the DOM is unchanged), and the
 * funding-cluster grouping runs over the table's (sorted) row model. Cells
 * reproduce the mockup spans verbatim → byte-identical DOM.
 */

/** Balance sort (wei decimal string). */
const byBalance: SortingFn<HolderRow> = (a, b) => {
  const d = BigInt(a.original.balance) - BigInt(b.original.balance);
  return d > 0n ? 1 : d < 0n ? -1 : 0;
};

const holderColumns: ColumnDef<HolderRow>[] = [
  {
    id: "distribution",
    cell: ({ row }) => {
      const holder = row.original;
      return (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-1">
            <AddressLink
              address={holder.address}
              kind="address"
              label={shortAddress(holder.address)}
            />
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
      );
    },
  },
  {
    id: "amounts",
    enableSorting: true,
    sortingFn: byBalance,
    cell: ({ row }) => {
      const holder = row.original;
      return (
        <div className="flex w-24 shrink-0 flex-col items-end">
          <span className="tabular-nums text-foreground">
            {formatTokenFromWei(holder.balance)}
          </span>
          <span className="tabular-nums text-muted-foreground">{formatPercent(holder.pct)}</span>
        </div>
      );
    },
  },
];

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

  const table = useReactTable({
    data: holders,
    columns: holderColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.address,
  });

  // Group the (sorted) row model by funding cluster, reusing the pure helper on
  // the ordered originals, then render each holder from its table Row.
  const orderedRows = table.getRowModel().rows;
  const rowByAddress = new Map<string, Row<HolderRow>>(
    orderedRows.map((r) => [r.original.address, r]),
  );
  const clusters = groupHoldersByCluster(orderedRows.map((r) => r.original));
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
          {clusters.map((cluster) =>
            cluster.clusterId ? (
              <div
                key={`cluster-${cluster.clusterId}`}
                className="rounded-md border border-soft-confirmed/30 bg-soft-confirmed/5 p-1"
              >
                <div className="px-1 pb-0.5 text-[10px] uppercase tracking-wide text-soft-confirmed">
                  Funding cluster · {cluster.rows.length} addresses (heuristic)
                </div>
                {cluster.rows.map((h) => (
                  <HolderRowItem key={h.address} row={rowByAddress.get(h.address)!} rank={++rank} />
                ))}
              </div>
            ) : (
              <HolderRowItem
                key={cluster.rows[0]!.address}
                row={rowByAddress.get(cluster.rows[0]!.address)!}
                rank={++rank}
              />
            ),
          )}
        </div>
      )}
    </Card>
  );
}

function HolderRowItem({ row, rank }: { row: Row<HolderRow>; rank: number }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-xs">
      <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{rank}</span>
      {row.getVisibleCells().map((cell) => (
        <Fragment key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </Fragment>
      ))}
    </div>
  );
}
