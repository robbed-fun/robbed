"use client";

import type { TokenCard, WsMessage } from "@robbed/shared";
import { GLOBAL_LAUNCHES, GLOBAL_TRADES } from "@robbed/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type TapeEvent,
  type TapeFilter,
  type TokenInfo,
  TAPE_FILTER_LABELS,
  TAPE_FILTER_ORDER,
  buildRegistry,
  filterEvents,
  graduateToEvent,
  launchToEvent,
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
 * DECISIONS (hoodpad-frontend; basis recorded):
 * - Filter state is LOCAL, not URL: the tape is an ephemeral live view (unlike
 *   the retired grid's shareable sort/filter). A tab click never navigates.
 * - Age is recomputed on a 10s tick so "4s → 1m" stays honest without a per-row
 *   timer; the tick is a cheap `now` bump, not a refetch.
 * - Rows link to `/t/[address]`; unknown-token rows still link (address known)
 *   and show mcap/Δ% "—" rather than inventing aggregates.
 */
export function EventTape({ tokens }: { tokens: TokenCard[] }) {
  const registry = useMemo<Map<string, TokenInfo>>(() => buildRegistry(tokens), [tokens]);
  const [events, setEvents] = useState<TapeEvent[]>(() => seedLaunches(tokens));
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
          {visible.map((e, i) => (
            <li key={e.id}>
              {i > 0 && <Divider />}
              <EventRow event={e} info={registry.get(e.token)} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EventRow({
  event,
  info,
  now,
}: {
  event: TapeEvent;
  info: TokenInfo | undefined;
  now: number;
}) {
  const name = info?.name ?? (event.kind === "launch" ? event.name : shortAddress(event.token));
  const imageUrl =
    info?.imageUrl ?? (event.kind === "launch" ? event.imageUrl : null);
  const ticker = info?.ticker ?? (event.kind === "launch" ? event.ticker : "");
  const delta = info?.change24hPct ?? null;

  return (
    <Link
      href={`/t/${event.token}`}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface md:px-6"
    >
      {/* age */}
      <MonoText tone="tertiary" size="xs" numeric className="w-9 shrink-0">
        {formatAge(event.ts, now)}
      </MonoText>

      {/* side */}
      <span className="w-[4.5rem] shrink-0">
        <SideBadge side={event.kind} />
      </span>

      {/* token */}
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

      {/* amount ETH (trades only) */}
      <span className="hidden w-28 shrink-0 text-right text-text-secondary sm:block">
        {event.kind === "buy" || event.kind === "sell" ? (
          <EthAmount wei={event.ethAmount} unit="ETH" className="text-sm" />
        ) : null}
      </span>

      {/* mcap — resolved from the registry, never fabricated (§2) */}
      <span className="hidden w-28 shrink-0 text-right md:block">
        <Mcap info={info} />
      </span>

      {/* Δ% */}
      <span className="w-16 shrink-0 text-right">
        {event.kind === "launch" ? (
          <MonoText tone="faint" size="sm">
            new
          </MonoText>
        ) : (
          <Delta value={delta} className="text-sm" />
        )}
      </span>
    </Link>
  );
}

/** mcap cell — only renders a USD figure when a live-priced snapshot exists (§2). */
function Mcap({ info }: { info: TokenInfo | undefined }) {
  const hasLiveUsd = info?.mcap?.usd != null && info.mcap.asOf != null;
  return (
    <span className={cn("text-sm tabular-nums text-muted")}>
      <span className="mr-1">mcap</span>
      {hasLiveUsd ? (
        <UsdAmount value={info!.mcap} className="text-text-secondary" />
      ) : (
        <span className="text-faint">—</span>
      )}
    </span>
  );
}
