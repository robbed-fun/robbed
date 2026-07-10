"use client";

import {
  type TokenDetail,
  type TradeRow,
  type WsTradeData,
  tokenTrades,
} from "@robbed/shared";
import { useMemo, useState } from "react";

import { ConfirmationBadge, useOptimisticTradesContext } from "@/entities/trade";
import { AddressLink, Badge, Card, RelativeTime } from "@/shared/ui";
import { useWsChannel } from "@/shared/lib/ws";
import { formatEthFromWei, formatTokenFromWei, shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

import { type FeedRow, buildFeedRows, prependTrade } from "../model/merge";

/**
 * Live trade feed (§5.2/§2.1). Seeds from the SSR `GET /trades` page, prepends
 * WS `trade` messages, and MERGES the user's own optimistic trades from the
 * shared store — a buy placed in the widget appears here instantly as
 * soft-confirmed and reconciles in place (§4). Every row shows the
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
    <Card className="flex flex-col p-3">
      <h3 className="mb-2 text-sm font-semibold text-foreground">Live trades</h3>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No trades yet — be the first.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border/60">
          {rows.map((r) => (
            <FeedRowItem key={r.key} row={r} />
          ))}
        </div>
      )}
    </Card>
  );
}

function FeedRowItem({ row }: { row: FeedRow }) {
  const ageUnix =
    row.blockTimestamp ??
    (row.submittedAtMs !== null ? Math.floor(row.submittedAtMs / 1000) : null);
  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1.5 text-xs",
        row.isOptimistic && "opacity-90",
        row.justUpdated && "animate-pulse",
      )}
    >
      <span
        className={cn(
          "w-8 shrink-0 font-medium uppercase",
          row.isBuy ? "text-buy" : "text-sell",
        )}
      >
        {row.isBuy ? "Buy" : "Sell"}
      </span>
      <span className="tabular-nums text-foreground">{formatEthFromWei(row.ethAmount)} ETH</span>
      <span className="tabular-nums text-muted-foreground">
        {formatTokenFromWei(row.tokenAmount)}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        {row.isCreator && (
          <Badge variant="outline" className="px-1 py-0 text-[10px]">
            creator
          </Badge>
        )}
        {row.txHash ? (
          <AddressLink address={row.txHash} kind="tx" label={shortAddress(row.trader)} />
        ) : (
          <span className="font-mono text-muted-foreground">{shortAddress(row.trader)}</span>
        )}
        {ageUnix !== null && (
          <RelativeTime unixSeconds={ageUnix} className="text-muted-foreground" />
        )}
        <ConfirmationBadge state={row.displayState} awaitingIndex={row.awaitingIndex} />
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
