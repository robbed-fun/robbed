"use client";

import {
  type HolderRow,
  type HolderSortField,
  type Paginated,
  type TokenDetail,
  tokenTrades,
} from "@robbed/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, HeaderContext } from "@tanstack/react-table";
import { useCallback, useMemo, useRef, useState } from "react";

import { HOLDER_FLAG_LABELS } from "@/entities/holder";
import { AddressLink, Badge, DataTable, SortHeader } from "@/shared/ui";
import { getHolders } from "@/shared/api";
import { HOLDERS_PAGE_SIZE } from "@/shared/config/tables";
import { qk } from "@/shared/lib/query-keys";
import {
  type SortState,
  type TableSortMeta,
  isDefaultSort,
  nextSort,
  useCursorStack,
} from "@/shared/lib/table";
import { useWsChannel } from "@/shared/lib/ws";
import { formatPercent, formatTokenFromWei, shortAddress } from "@/shared/lib/format";

/**
 * Top Holders table — the right-column table that REPLACES the
 * deleted Trust panel. RULED row shape: `rank · address · label · amount
 * · percent`, where **label** is only the structural account role (Bonding curve
 * / Creator / LP fee vault). Advisory bot flags stay off this public table.
 *
 * SERVER-AUTHORITATIVE : the DataTable is `manualSorting` — column
 * headers dispatch a `?sort=&dir=` refetch, the browser NEVER re-ranks. Keyset
 * pagination is an opaque forward cursor (`useCursorStack`). The bare query key is
 * the WS-live default window (amount DESC ≡ rank ASC, page 1); a sorted/paginated
 * view is a distinct REST snapshot. Balances are the indexer's Transfer-derived
 * truth — no new on-chain surface. Refreshes on WS trades, throttled ≥5s.
 */

/** Default order = amount DESC (≡ rank ASC), the SSR-seeded live window. */
const DEFAULT_HOLDER_SORT: SortState<HolderSortField> = { field: "amount", dir: "desc" };

/** Row with a resolved rank (server `rank` when present, else page position). */
interface HolderRowView extends HolderRow {
  displayRank: number;
}

/** Text columns default to ASC on first click; magnitude columns to DESC. */
function defaultDirFor(field: string): "asc" | "desc" {
  return field === "address" || field === "label" || field === "rank" ? "asc" : "desc";
}

const metaOf = (ctx: HeaderContext<HolderRowView, unknown>): TableSortMeta<string> =>
  (ctx.table.options.meta ?? {}) as TableSortMeta<string>;

/** Shared 5-track grid for the header + every row (byte-identical alignment). */
const GRID =
  "grid grid-cols-[18px_minmax(0,1fr)_auto_64px_46px] items-center gap-x-2";

const holderColumns: ColumnDef<HolderRowView>[] = [
  {
    id: "rank",
    header: (ctx) => <SortHeader label="#" field="rank" meta={metaOf(ctx)} />,
    cell: ({ row }) => (
      <span className="tabular-nums text-text-tertiary">{row.original.displayRank}</span>
    ),
  },
  {
    id: "address",
    header: (ctx) => <SortHeader label="Holder" field="address" meta={metaOf(ctx)} />,
    cell: ({ row }) => (
      <AddressLink
        address={row.original.address}
        kind="address"
        label={shortAddress(row.original.address)}
        className="truncate text-muted"
      />
    ),
  },
  {
    id: "label",
    header: (ctx) => <SortHeader label="Label" field="label" meta={metaOf(ctx)} />,
    cell: ({ row }) => <LabelCell holder={row.original} />,
  },
  {
    id: "amount",
    header: (ctx) => (
      <SortHeader label="Amount" field="amount" align="right" meta={metaOf(ctx)} />
    ),
    cell: ({ row }) => (
      <span className="text-right tabular-nums text-foreground">
        {formatTokenFromWei(row.original.balance)}
      </span>
    ),
  },
  {
    id: "percent",
    header: (ctx) => (
      <SortHeader label="%" field="percent" align="right" meta={metaOf(ctx)} />
    ),
    cell: ({ row }) => (
      <span className="text-right tabular-nums text-muted-foreground">
        {formatPercent(row.original.pct)}
      </span>
    ),
  },
];

/** Structural role chips (creator/curve/vault) only. */
function LabelCell({ holder }: { holder: HolderRow }) {
  if (holder.flags.length === 0) return <span className="text-text-tertiary">—</span>;
  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      {holder.flags.map((f) => (
        <Badge key={f} variant="outline" className="px-1 py-0 text-[10px]">
          {HOLDER_FLAG_LABELS[f]}
        </Badge>
      ))}
    </span>
  );
}

export function HolderTable({
  token,
  initialData,
}: {
  token: TokenDetail;
  initialData?: Paginated<HolderRow>;
}) {
  const [sort, setSort] = useState<SortState<HolderSortField>>(DEFAULT_HOLDER_SORT);
  const cursors = useCursorStack();
  const isDefaultView =
    isDefaultSort(sort, DEFAULT_HOLDER_SORT) && cursors.cursor === null;

  const canonicalKey = qk.holders(token.address);
  const queryKey = isDefaultView
    ? canonicalKey
    : qk.holders(token.address, {
        sort: sort.field,
        dir: sort.dir,
        cursor: cursors.cursor,
      });

  const query = useQuery<Paginated<HolderRow>>({
    queryKey,
    queryFn: ({ signal }) =>
      getHolders(
        token.address,
        {
          sort: sort.field,
          dir: sort.dir,
          cursor: cursors.cursor ?? undefined,
          limit: HOLDERS_PAGE_SIZE,
        },
        { signal },
      ),
    initialData: isDefaultView ? initialData : undefined,
    placeholderData: keepPreviousData,
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

  const items = query.data?.items ?? [];
  const offset = cursors.pageIndex * HOLDERS_PAGE_SIZE;
  const rows = useMemo<HolderRowView[]>(
    () => items.map((h, i) => ({ ...h, displayRank: h.rank ?? offset + i + 1 })),
    [items, offset],
  );

  const onSort = useCallback(
    (field: string) => {
      setSort((cur) => nextSort(cur, field as HolderSortField, defaultDirFor(field)));
      cursors.reset();
    },
    [cursors],
  );

  const meta: TableSortMeta<string> = { sort, onSort };

  const pagination = {
    hasPrev: cursors.hasPrev,
    hasNext: query.data?.nextCursor != null,
    onPrev: cursors.prev,
    onNext: () => {
      const nc = query.data?.nextCursor;
      if (nc) cursors.next(nc);
    },
    isFetching: query.isFetching,
    pageIndex: cursors.pageIndex,
  };

  return (
    // FLAT region (fidelity audit fix 1): no Card — the token-detail column
    // supplies padding; the DataTable's TableLabel titles the table.
    <DataTable<HolderRowView>
      data={rows}
      columns={holderColumns}
      getRowId={(h) => h.address}
      aria-label="Top holders"
      meta={meta}
      tableLabel={{ title: "Top holders" }}
      renderHeader={(cells) => (
        <div className={`${GRID} border-b border-border-soft pb-2 text-[11px]`}>
          {cells}
        </div>
      )}
      renderRow={({ cells }) => (
        <div className={`${GRID} border-b border-border-soft py-1.5 text-xs last:border-b-0`}>
          {cells}
        </div>
      )}
      empty={
        <p className="py-6 text-center text-xs text-muted-foreground">
          No holders yet — the bonding curve holds the full supply until the first
          trade.
        </p>
      }
      pagination={pagination}
    />
  );
}
