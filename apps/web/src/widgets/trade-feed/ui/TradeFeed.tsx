"use client";

import {
  type TokenDetail,
  type TradeRow,
  type WsTradeData,
  tokenTrades,
} from "@robbed/shared";
import { useMemo, useState } from "react";

import { ConfirmationBadge, useOptimisticTradesContext } from "@/entities/trade";
import {
  AddressLink,
  Card,
  MonoLabel,
  MonoText,
  RelativeTime,
  SideBadge,
} from "@/shared/ui";
import { useWsChannel } from "@/shared/lib/ws";
import { formatEthFromWei, shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

import { type FeedRow, buildFeedRows, prependTrade } from "../model/merge";

/**
 * Live trade feed (§5.2/§2.1) — ROBBED_ terminal TRADES TABLE (docs/Robbed.html
 * "2a": AGE · SIDE · TRADER · AMOUNT · PRICE). Seeds from the SSR `GET /trades`
 * page, prepends WS `trade` messages, and MERGES the user's own optimistic
 * trades from the shared store — a buy placed in the widget appears here
 * instantly as soft-confirmed and reconciles in place (§4). Every row shows the
 * `ConfirmationBadge`; a soft-confirmed row never renders as unqualified-final.
 */
export function TradeFeed({
  token,
  initialTrades = [],
}: {
  token: TokenDetail;
  initialTrades?: TradeRow[];
}) {
  const [indexed, setIndexed] = useState<TradeRow[]>(initialTrades);
  const optimistic = useOptimisticTradesContext();

  useWsChannel(tokenTrades(token.address), (msg) => {
    if (msg.type !== "trade") return;
    setIndexed((rows) => prependTrade(rows, wsTradeToRow(msg.data)));
    // Reconcile any matching optimistic row to indexed truth (§4).
    optimistic.applyWsTrade(msg.data);
  });

  const rows = useMemo(
    () =>
      buildFeedRows({
        optimistic: optimistic.trades,
        indexed,
        creator: token.creator.address,
      }),
    [optimistic.trades, indexed, token.creator.address],
  );

  return (
    <Card className="flex flex-col p-4">
      {/* Column header — mockup grid: AGE 70 · SIDE 70 · TRADER 1fr · AMOUNT · PRICE */}
      <div className="grid grid-cols-[52px_52px_1fr_auto] items-center gap-3 border-b border-border-soft pb-2 sm:grid-cols-[64px_64px_1fr_110px_96px]">
        <MonoLabel size="2xs">Age</MonoLabel>
        <MonoLabel size="2xs">Side</MonoLabel>
        <MonoLabel size="2xs">Trader</MonoLabel>
        <MonoLabel size="2xs" className="text-right">
          Amount
        </MonoLabel>
        <MonoLabel size="2xs" className="hidden text-right sm:block">
          Price
        </MonoLabel>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">No trades yet — be the first.</p>
      ) : (
        <div className="flex flex-col">
          {rows.map((r) => (
            <TradeTableRow key={r.key} row={r} />
          ))}
        </div>
      )}
    </Card>
  );
}

function TradeTableRow({ row }: { row: FeedRow }) {
  const ageUnix =
    row.blockTimestamp ??
    (row.submittedAtMs !== null ? Math.floor(row.submittedAtMs / 1000) : null);

  return (
    <div
      className={cn(
        "grid grid-cols-[52px_52px_1fr_auto] items-center gap-3 border-b border-border-soft py-[7px] text-xs last:border-b-0 sm:grid-cols-[64px_64px_1fr_110px_96px]",
        row.isOptimistic && "opacity-90",
        row.justUpdated && "animate-pulse",
      )}
    >
      {/* AGE */}
      <span className="text-faint tabular-nums">
        {ageUnix !== null ? <RelativeTime unixSeconds={ageUnix} /> : "—"}
      </span>

      {/* SIDE */}
      <SideBadge side={row.isBuy ? "buy" : "sell"} />

      {/* TRADER (+ creator flag, confirmation tier) */}
      <span className="flex min-w-0 items-center gap-1.5">
        {row.txHash ? (
          <AddressLink
            address={row.txHash}
            kind="tx"
            label={shortAddress(row.trader)}
            className="text-muted"
          />
        ) : (
          <MonoText tone="muted" className="truncate">
            {shortAddress(row.trader)}
          </MonoText>
        )}
        {row.isCreator && (
          <MonoLabel tone="green" size="2xs">
            dev
          </MonoLabel>
        )}
        <ConfirmationBadge state={row.displayState} awaitingIndex={row.awaitingIndex} />
      </span>

      {/* AMOUNT (ETH) */}
      <span className="text-right tabular-nums text-text-secondary">
        {formatEthFromWei(row.ethAmount)}
        <span className="ml-1 text-faint">ETH</span>
      </span>

      {/* PRICE (ETH/token) — hidden on the narrowest widths */}
      <span className="hidden text-right tabular-nums text-muted sm:block">
        {row.priceEth === null ? "—" : row.priceEth.toPrecision(2)}
      </span>
    </div>
  );
}

function wsTradeToRow(d: WsTradeData): TradeRow {
  return {
    id: `${d.txHash}-${d.logIndex}`,
    token: d.token,
    trader: d.trader,
    venue: d.venue,
    isBuy: d.isBuy,
    ethAmount: d.ethAmount,
    tokenAmount: d.tokenAmount,
    feeEth: d.feeEth,
    priceEth: d.priceEth,
    blockNumber: d.blockNumber,
    blockTimestamp: d.blockTimestamp,
    txHash: d.txHash,
    logIndex: d.logIndex,
    confirmationState: d.confirmationState,
  };
}
