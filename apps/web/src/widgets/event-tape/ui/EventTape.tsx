"use client";

import type { TokenCard, WsMessage } from "@robbed/shared";
import { GLOBAL_LAUNCHES, GLOBAL_TRADES } from "@robbed/shared";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type TapeEvent,
  type TapeFilter,
  type TokenInfo,
  TAPE_FILTER_LABELS,
  TAPE_FILTER_ORDER,
  buildRegistry,
  eventFromFeedRow,
  filterEvents,
  graduateToEvent,
  launchToEvent,
  mergeFeed,
  prependCapped,
  seedLaunches,
  tradeToEvent,
} from "../model/events";
import { getEvents } from "@/shared/api";
import {
  DataTable,
  Divider,
  LiveDot,
  MonoText,
  PriceEth,
  SideBadge,
  Tab,
  TabBar,
  TokenAvatar,
  UsdAmount,
} from "@/shared/ui";
import { formatAge, shortAddress } from "@/shared/lib/format";
import { useNowTick } from "@/shared/lib/use-now";
import { cn } from "@/shared/lib/utils";
import { useWsChannel } from "@/shared/lib/ws";

/**
 * Live event tape (Discover, ROBBED_ redesign —, panel "2d").
 *
 * Filter tabs (ALL/LAUNCHES/TRADES/GRADUATIONS) + a LIVE dot, then rows:
 * age · colored SIDE · token · amount ETH · mcap · flag (LAUNCH "new"). The
 * per-row 24h Δ% chip was REMOVED (user-directed, via the orchestrator): a
 * token-level metric painted identically on every row reads as noise. Rows are
 * seeded from the merged `GET /v1/events` feed (launches ∪ trades ∪ graduations —
 * so historical graduations paint on first load) folded over the synchronous
 * launch-only `/v1/tokens` snapshot, then kept live by the WS streams
 * (`global:trades`, `global:launches`). Stable per-event ids de-dupe the REST
 * seed against live rows. See model/events.ts for the protocol-discipline notes
 * (mcap resolves from the registry, never fabricated from a trade).
 *
 * Rows are driven by the shared headless `DataTable` (TanStack Table v8): typed
 * `ColumnDef<TapeEvent>[]` supply the cell renderers, and `renderRow` wraps each
 * row's cells in the mockup's clickable `<Link>`. `data` (filtered events) and
 * `columns` are BOTH memoized — a stable reference is REQUIRED (unstable `data`
 * every render is what froze Discover: the table thrashes its row model → a
 * silent CPU loop with no console error). The tape has no visible column header
 * (the filter tabs sit where a header would).
 */
/** `/v1/events` seed page size — fills the ~60-row buffer (prependCapped cap). */
const EVENT_SEED_LIMIT = 60;

export function EventTape({ tokens }: { tokens: TokenCard[] }) {
  const registry = useMemo<Map<string, TokenInfo>>(() => buildRegistry(tokens), [tokens]);
  const [events, setEvents] = useState<TapeEvent[]>(() => seedLaunches(tokens));
  const [filter, setFilter] = useState<TapeFilter>("all");
  // Hydration-safe age clock (hardening fix 2026-07-12): `null` until mount so
  // SSR and hydration markup match deterministically (the previous
  // `useState(Date.now())` seed mismatched server vs client text); then a 10s
  // tick keeps "4s → 1m" honest without a per-row timer.
  const now = useNowTick(10_000);

  // Seed the initial mixed snapshot from `GET /v1/events` at mount (gap CLOSED —
  // model/events.ts note): the launch-only `seedLaunches(tokens)` above is the
  // synchronous first paint; this fold-in adds HISTORICAL trades AND graduations
  // (incl. a graduation that landed during indexer catch-up, which WS — no replay
  // buffer, backfill publishes suppressed — would never paint for a browser
  // opening Discover now). One fetch of `type=all`; the tabs filter locally.
  // React `ignore`-flag + AbortController cleanup (react.dev/reference/react/
  // useEffect) so a late response can't set state after unmount; `mergeFeed`
  // de-dupes seed vs any live-WS rows that arrived first. Best-effort: a failed
  // seed leaves the launch snapshot + live stream intact.
  useEffect(() => {
    let ignore = false;
    const ctrl = new AbortController();
    getEvents({ type: "all", limit: EVENT_SEED_LIMIT }, { signal: ctrl.signal })
      .then((res) => {
        if (ignore) return;
        const seeded = res.events.map(eventFromFeedRow);
        setEvents((prev) => mergeFeed(prev, seeded));
      })
      .catch(() => {
        /* seed is best-effort — launch snapshot + WS stream still paint */
      });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, []);

  const onTrade = useCallback((msg: WsMessage) => {
    if (msg.type !== "trade") return;
    setEvents((prev) => prependCapped(prev, tradeToEvent(msg.data)));
  }, []);

  const onLaunches = useCallback((msg: WsMessage) => {
    if (msg.type === "launch") {
      setEvents((prev) => prependCapped(prev, launchToEvent(msg.data)));
    } else if (msg.type === "graduated") {
      setEvents((prev) => prependCapped(prev, graduateToEvent(msg.data)));
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
 *, never fabricated. Rebuilt only on the 10s `now` tick or a registry change.
 */
function buildTapeColumns(
  registry: Map<string, TokenInfo>,
  now: number | null,
): ColumnDef<TapeEvent>[] {
  return [
    {
      id: "age",
      cell: ({ row }) => (
        // mockup age column: faint tone, 11px (template.html:278). `now` is null
        // for the single pre-mount frame (hydration-safe clock) → placeholder.
        <MonoText tone="faint" size="xs" numeric className="w-9 shrink-0 md:w-auto">
          {now === null ? "…" : formatAge(row.original.ts, now)}
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
          // mockup: amount inherits the 13px base ramp (text-base), right-aligned.
          // Compact subscript for tiny trade amounts (0.0₁₀63 ETH), 4-dec
          // zero-padded at normal magnitude — shared PriceEth (format-price.ts).
          <span className="hidden w-28 shrink-0 text-right text-text-secondary sm:block md:w-auto">
            {amountWei !== null ? (
              <PriceEth wei={amountWei} unit="ETH" decimals={4} className="text-base" />
            ) : null}
          </span>
        );
      },
    },
    {
      id: "mcap",
      cell: ({ row }) => <Mcap info={registry.get(row.original.token)} />,
    },
    {
      // Trailing flag column. The per-row 24h Δ% chip was REMOVED (user-directed,
      // routed via the orchestrator): change24hPct is a token-level metric that
      // rendered identically on every row of a token, reading as noise. Only the
      // LAUNCH "new" marker remains here (the GRADUATE "→ AMM pool live" marker
      // lives in the token cell). The 110px grid track is kept for column
      // alignment across kinds.
      id: "flag",
      cell: ({ row }) =>
        row.original.kind === "launch" ? (
          <span className="w-16 shrink-0 text-right md:w-auto">
            <MonoText tone="faint" size="base">
              new
            </MonoText>
          </span>
        ) : (
          <span className="w-16 shrink-0 md:w-auto" aria-hidden />
        ),
    },
  ];
}

/**
 * mcap cell — only renders a USD figure when a live-priced snapshot exists.
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
