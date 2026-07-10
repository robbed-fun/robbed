"use client";

import type { TokenCard, WsMessage } from "@robbed/shared";
import { GLOBAL_LAUNCHES, GLOBAL_TRADES } from "@robbed/shared";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import {
  type MockTapeEntry,
  type TapeEvent,
  type TapeFilter,
  type TokenInfo,
  TAPE_FILTER_LABELS,
  TAPE_FILTER_ORDER,
  buildRegistry,
  filterEvents,
  graduateToEvent,
  launchToEvent,
  mockTapeEvents,
  prependCapped,
  seedLaunches,
  tradeToEvent,
} from "../model/events";
import {
  Delta,
  Divider,
  EthAmount,
  LiveDot,
  MonoText,
  SideBadge,
  Tab,
  TabBar,
  TokenAvatar,
  UsdAmount,
} from "@/shared/ui";
import { formatAge, shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { useWsChannel } from "@/shared/lib/ws";

/**
 * Live event tape (Discover, ROBBED_ redesign — docs/Robbed.html "2d").
 *
 * Filter tabs (ALL/LAUNCHES/TRADES/GRADUATIONS) + a LIVE dot, then rows:
 * age · colored SIDE · token · amount ETH · mcap · Δ%. It merges a real
 * server-seeded LAUNCH snapshot with the live WS streams (`global:trades`,
 * `global:launches`) — see model/events.ts for the protocol-discipline notes
 * (mcap/Δ% are resolved from the registry, never fabricated from a trade; §2).
 *
 * The row grid is driven by a headless `@tanstack/react-table` model (v8,
 * docs-first tanstack.com/table 2026-07-10): typed `ColumnDef<TapeEvent>[]`
 * (age/side/token/amount ETH/mcap/Δ%) supply the cell renderers, and each visible
 * row iterates the table row model. The tape has no visible column header (the
 * filter tabs sit where a header would); the design's clickable flex `<Link>` row
 * + `Divider` separators are preserved verbatim, and cells reproduce the mockup
 * spans → byte-identical DOM. mcap/Δ% resolve from the token REGISTRY passed to
 * the columns (never invented; unknown tokens render "—").
 *
 * DECISIONS (hoodpad-frontend; basis recorded):
 * - Filter state is LOCAL, not URL: the tape is an ephemeral live view (unlike
 *   the retired grid's shareable sort/filter). A tab click never navigates.
 * - Age is recomputed on a 10s tick so "4s → 1m" stays honest without a per-row
 *   timer; the tick is a cheap `now` bump that rebuilds the column closures.
 * - Rows link to `/t/[address]`; unknown-token rows still link (address known)
 *   and show mcap/Δ% "—" rather than inventing aggregates.
 * - The tape is SEEDED server-side (the Discover view passes `tokens` from its
 *   SSR `/v1/tokens` read) and streamed over WS — it does no ad-hoc client fetch,
 *   so it stays on the App Router server-fetch pattern (no TanStack Query read).
 */
export function EventTape({
  tokens,
  mockEntries,
}: {
  tokens: TokenCard[];
  /**
   * DEMO-ONLY (task A): the gated `discover.eventTape` fixture. Events (and their
   * relative ages) are built on the CLIENT at mount so the age column stays
   * correct regardless of prerender staleness; falls back to the real launch seed.
   */
  mockEntries?: MockTapeEntry[];
}) {
  const registry = useMemo<Map<string, TokenInfo>>(() => buildRegistry(tokens), [tokens]);
  const [events, setEvents] = useState<TapeEvent[]>(() =>
    mockEntries ? mockTapeEvents(mockEntries, tokens) : seedLaunches(tokens),
  );
  const [filter, setFilter] = useState<TapeFilter>("all");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const onTrade = useCallback((msg: WsMessage) => {
    if (msg.type !== "trade") return;
    setEvents((prev) => prependCapped(prev, tradeToEvent(msg.data, msg.seq)));
  }, []);

  const onLaunches = useCallback((msg: WsMessage) => {
    if (msg.type === "launch") {
      setEvents((prev) => prependCapped(prev, launchToEvent(msg.data, msg.seq)));
    } else if (msg.type === "graduated") {
      setEvents((prev) => prependCapped(prev, graduateToEvent(msg.data, msg.seq)));
    }
  }, []);

  useWsChannel(GLOBAL_TRADES, onTrade);
  useWsChannel(GLOBAL_LAUNCHES, onLaunches);

  const visible = filterEvents(events, filter);
  const columns = useMemo(() => buildTapeColumns(registry, now), [registry, now]);

  const table = useReactTable({
    data: visible,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (event) => event.id,
  });

  return (
    <section aria-label="Live event tape">
      {/* filter tabs + LIVE */}
      <div className="flex items-center justify-between gap-3 border-y border-border-soft px-4 py-2.5 md:px-6">
        <TabBar aria-label="Event filter">
          {TAPE_FILTER_ORDER.map((f) => (
            <Tab
              key={f}
              active={filter === f}
              onClick={() => setFilter(f)}
              className="tracking-label"
            >
              {TAPE_FILTER_LABELS[f]}
            </Tab>
          ))}
        </TabBar>
        <LiveDot />
      </div>

      {/* rows */}
      {visible.length === 0 ? (
        <div className="px-4 py-10 text-center md:px-6">
          <MonoText tone="faint" size="xs">
            watching for live activity…
          </MonoText>
        </div>
      ) : (
        <ul>
          {table.getRowModel().rows.map((row, i) => (
            <li key={row.id}>
              {i > 0 && <Divider />}
              <Link
                href={`/t/${row.original.token}`}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface md:px-6",
                  // mockup: LAUNCH rows carry a subtle raised surface background
                  row.original.kind === "launch" && "bg-surface",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <Fragment key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </Fragment>
                ))}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Column model for the tape row — cells close over the token `registry` and the
 * age `now` tick so mcap/Δ%/age resolve from live indexer aggregates by reference
 * (§2), never fabricated. Rebuilt on the 10s `now` tick.
 */
function buildTapeColumns(
  registry: Map<string, TokenInfo>,
  now: number,
): ColumnDef<TapeEvent>[] {
  return [
    {
      id: "age",
      cell: ({ row }) => (
        <MonoText tone="tertiary" size="xs" numeric className="w-9 shrink-0">
          {formatAge(row.original.ts, now)}
        </MonoText>
      ),
    },
    {
      id: "side",
      cell: ({ row }) => (
        <span className="w-[4.5rem] shrink-0">
          <SideBadge side={row.original.kind} />
        </span>
      ),
    },
    {
      id: "token",
      cell: ({ row }) => {
        const event = row.original;
        const info = registry.get(event.token);
        const name =
          info?.name ?? (event.kind === "launch" ? event.name : shortAddress(event.token));
        const imageUrl = info?.imageUrl ?? (event.kind === "launch" ? event.imageUrl : null);
        const ticker = info?.ticker ?? (event.kind === "launch" ? event.ticker : "");
        return (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <TokenAvatar imageUrl={imageUrl} name={name} ticker={ticker} size={22} />
            <MonoText tone="default" size="base" className="truncate">
              {name}
            </MonoText>
            {event.kind === "launch" && (
              <MonoText tone="faint" size="xs" className="hidden shrink-0 sm:inline">
                by {shortAddress(event.creator)}
              </MonoText>
            )}
            {event.kind === "graduate" && (
              <MonoText tone="green" size="xs" className="hidden shrink-0 sm:inline">
                → AMM pool live
              </MonoText>
            )}
          </span>
        );
      },
    },
    {
      id: "amount",
      cell: ({ row }) => {
        const event = row.original;
        const amountWei =
          "ethAmount" in event && event.ethAmount !== undefined ? event.ethAmount : null;
        return (
          <span className="hidden w-28 shrink-0 text-right text-text-secondary sm:block">
            {amountWei !== null ? <EthAmount wei={amountWei} unit="ETH" className="text-sm" /> : null}
          </span>
        );
      },
    },
    {
      id: "mcap",
      cell: ({ row }) => <Mcap info={registry.get(row.original.token)} />,
    },
    {
      id: "delta",
      cell: ({ row }) => {
        const event = row.original;
        const info = registry.get(event.token);
        // Demo rows carry a per-event Δ% override (task A, §2-gated); live rows
        // resolve the token's 24h Δ% from the registry.
        const delta = event.deltaPct !== undefined ? event.deltaPct : info?.change24hPct ?? null;
        return (
          <span className="w-16 shrink-0 text-right">
            {event.kind === "launch" ? (
              <MonoText tone="faint" size="sm">
                new
              </MonoText>
            ) : (
              <Delta value={delta} className="text-sm" />
            )}
          </span>
        );
      },
    },
  ];
}

/** mcap cell — only renders a USD figure when a live-priced snapshot exists (§2). */
function Mcap({ info }: { info: TokenInfo | undefined }) {
  const hasLiveUsd = info?.mcap?.usd != null && info.mcap.asOf != null;
  return (
    <span className="hidden w-28 shrink-0 text-right md:block">
      <span className="text-sm tabular-nums text-muted">
        <span className="mr-1">mcap</span>
        {hasLiveUsd ? (
          <UsdAmount value={info!.mcap} className="text-text-secondary" />
        ) : (
          <span className="text-faint">—</span>
        )}
      </span>
    </span>
  );
}
