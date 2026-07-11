"use client";

import type { TokenCard, WsMessage } from "@robbed/shared";
import { GLOBAL_LAUNCHES, GLOBAL_TRADES } from "@robbed/shared";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  DataTable,
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
 * (mcap/Δ% resolve from the registry, never fabricated from a trade; §2).
 *
 * Rows are driven by the shared headless `DataTable` (TanStack Table v8): typed
 * `ColumnDef<TapeEvent>[]` supply the cell renderers, and `renderRow` wraps each
 * row's cells in the mockup's clickable `<Link>`. `data` (filtered events) and
 * `columns` are BOTH memoized — a stable reference is REQUIRED (unstable `data`
 * every render is what froze Discover: the table thrashes its row model → a
 * silent CPU loop with no console error). The tape has no visible column header
 * (the filter tabs sit where a header would).
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

  // Age recomputes on a 10s tick so "4s → 1m" stays honest without a per-row timer.
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

  // STABLE references into DataTable — only rebuild when their inputs change.
  const data = useMemo(() => filterEvents(events, filter), [events, filter]);
  const columns = useMemo(() => buildTapeColumns(registry, now), [registry, now]);

  return (
    <section aria-label="Live event tape">
      {/* filter tabs + LIVE — mockup: single bottom border (border token), 12px pad, no letter-spacing */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
        <TabBar aria-label="Event filter">
          {TAPE_FILTER_ORDER.map((f) => (
            <Tab key={f} active={filter === f} onClick={() => setFilter(f)}>
              {TAPE_FILTER_LABELS[f]}
            </Tab>
          ))}
        </TabBar>
        <LiveDot />
      </div>

      {/* rows */}
      <DataTable
        data={data}
        columns={columns}
        getRowId={(event) => event.id}
        empty={
          <div className="px-4 py-10 text-center md:px-6">
            <MonoText tone="faint" size="xs">
              watching for live activity…
            </MonoText>
          </div>
        }
        renderRow={({ row, cells, index }) => (
          <>
            {index > 0 && <Divider />}
            <Link
              href={`/t/${row.original.token}`}
              className={cn(
                // Mobile keeps the compact flex row (mockup is desktop-only, 1080px);
                // at md+ the row is the mockup's exact CSS grid (template.html:277):
                // grid-template-columns: 64px 90px 1fr 130px 130px 110px; gap:16px.
                // Grid is gated at md (not sm) because the mcap cell is `hidden`
                // below md — a display:none grid item would shift the delta into
                // the mcap track and misalign columns at sm–md widths.
                "flex items-center gap-3 px-4 py-[11px] transition-colors hover:bg-surface md:grid md:grid-cols-[64px_90px_minmax(0,1fr)_130px_130px_110px] md:gap-4 md:px-6",
                // mockup: LAUNCH rows carry a subtle raised surface background
                row.original.kind === "launch" && "bg-surface",
              )}
            >
              {cells}
            </Link>
          </>
        )}
      />
    </section>
  );
}

/**
 * Column model for the tape row — cells close over the token `registry` and the
 * age `now` tick so mcap/Δ%/age resolve from live indexer aggregates by reference
 * (§2), never fabricated. Rebuilt only on the 10s `now` tick or a registry change.
 */
function buildTapeColumns(
  registry: Map<string, TokenInfo>,
  now: number,
): ColumnDef<TapeEvent>[] {
  return [
    {
      id: "age",
      cell: ({ row }) => (
        // mockup age column: faint tone, 11px (template.html:278)
        <MonoText tone="faint" size="xs" numeric className="w-9 shrink-0 md:w-auto">
          {formatAge(row.original.ts, now)}
        </MonoText>
      ),
    },
    {
      id: "side",
      cell: ({ row }) => (
        <span className="w-[4.5rem] shrink-0 md:w-auto">
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
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
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
              // mockup: purple, matching the GRADUATE side (template.html:304)
              <MonoText tone="purple" size="xs" className="hidden shrink-0 sm:inline">
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
          // mockup: amount inherits the 13px base ramp (text-base), right-aligned
          <span className="hidden w-28 shrink-0 text-right text-text-secondary sm:block md:w-auto">
            {amountWei !== null ? <EthAmount wei={amountWei} unit="ETH" className="text-base" /> : null}
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
          // mockup: delta / "new" inherit the 13px base ramp (text-base)
          <span className="w-16 shrink-0 text-right md:w-auto">
            {event.kind === "launch" ? (
              <MonoText tone="faint" size="base">
                new
              </MonoText>
            ) : (
              <Delta value={delta} className="text-base" />
            )}
          </span>
        );
      },
    },
  ];
}

/**
 * mcap cell — only renders a USD figure when a live-priced snapshot exists (§2).
 * Mockup renders the WHOLE mcap cell (label + value) in text-muted
 * (template.html:282) at the 13px base ramp — the value is NOT brightened.
 */
function Mcap({ info }: { info: TokenInfo | undefined }) {
  const hasLiveUsd = info?.mcap?.usd != null && info.mcap.asOf != null;
  return (
    <span className="hidden w-28 shrink-0 text-right md:block md:w-auto">
      <span className="text-base tabular-nums text-muted">
        <span className="mr-1">mcap</span>
        {hasLiveUsd ? (
          <UsdAmount value={info!.mcap} />
        ) : (
          <span className="text-faint">—</span>
        )}
      </span>
    </span>
  );
}
