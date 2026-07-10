"use client";

import type { WsLaunchData, WsMessage } from "@robbed/shared";
import { GLOBAL_LAUNCHES } from "@robbed/shared";
import Link from "next/link";
import { useCallback, useState } from "react";

import { TokenAvatar } from "@/shared/ui";
import { Badge } from "@/shared/ui";
import { shortAddress } from "@/shared/lib/format";
import { useWsChannel } from "@/shared/lib/ws";

/**
 * Live launch ticker (§5.1) — WS `global:launches`, new entries slide in from the
 * left, capped at ~30 in memory (web.md §3.1). Both message types on the channel
 * are handled: `launch` (new TokenCreated) and `graduated` (announcement). Each
 * entry links to `/t/[address]`. Entries carry a soft-confirmed treatment — a
 * fresh launch is soft-confirmed truth, never rendered as final (§2.1).
 *
 * The ticker is intentionally the ONLY grid-adjacent surface that constructs
 * rows straight from the WS `launch` payload, because `wsLaunchDataSchema` has
 * exactly what a ticker entry needs (address/name/ticker/creator/image) — it
 * lacks the card aggregates (mcap/progress), so the grid does NOT build cards
 * from it (see TokenGrid gap note).
 */

type TickerEntry =
  | { kind: "launch"; key: string; data: WsLaunchData }
  | { kind: "graduated"; key: string; token: string };

const CAP = 30;

export function LaunchTicker() {
  const [entries, setEntries] = useState<TickerEntry[]>([]);

  const onMessage = useCallback((msg: WsMessage) => {
    if (msg.type === "launch") {
      const entry: TickerEntry = {
        kind: "launch",
        key: `l-${msg.data.address}-${msg.seq}`,
        data: msg.data,
      };
      setEntries((prev) => [entry, ...prev].slice(0, CAP));
    } else if (msg.type === "graduated") {
      const entry: TickerEntry = {
        kind: "graduated",
        key: `g-${msg.data.token}-${msg.seq}`,
        token: msg.data.token,
      };
      setEntries((prev) => [entry, ...prev].slice(0, CAP));
    }
  }, []);

  useWsChannel(GLOBAL_LAUNCHES, onMessage);

  return (
    <div className="flex items-center gap-2 overflow-hidden rounded-lg border border-border bg-surface px-3 py-2">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Live
      </span>
      {entries.length === 0 ? (
        <span className="text-xs text-muted-foreground">Watching for new launches…</span>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {entries.map((e) =>
            e.kind === "launch" ? (
              <Link
                key={e.key}
                href={`/t/${e.data.address}`}
                className="animate-in fade-in slide-in-from-left-2 flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 transition-colors hover:border-muted-foreground/40"
              >
                <TokenAvatar
                  imageUrl={e.data.imageUrl ?? null}
                  name={e.data.name}
                  ticker={e.data.ticker}
                  size={16}
                  className="h-4 w-4"
                />
                <span className="text-xs font-medium text-foreground">{e.data.ticker}</span>
                <Badge variant="soft-confirmed" className="px-1 py-0 text-[10px]">
                  new
                </Badge>
              </Link>
            ) : (
              <Link
                key={e.key}
                href={`/t/${e.token}`}
                className="animate-in fade-in slide-in-from-left-2 flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 transition-colors hover:border-muted-foreground/40"
              >
                <span className="text-xs font-mono text-muted-foreground">
                  {shortAddress(e.token)}
                </span>
                <Badge variant="finalized" className="px-1 py-0 text-[10px]">
                  graduated
                </Badge>
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}
