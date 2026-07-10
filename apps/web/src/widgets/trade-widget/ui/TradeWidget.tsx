"use client";

import { launchTokenAbi } from "@robbed/shared/abi";
import type { TokenDetail } from "@robbed/shared";
import { useEffect, useMemo, useState } from "react";
import { formatEther, formatUnits, parseEther, parseUnits, type Address } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";

import {
  DEFAULT_SLIPPAGE_BPS,
  SLIPPAGE_WARN_BPS,
  V3_FEE_TIER,
  applySlippageFloor,
  clampSlippageBps,
  isInEarlyWindow,
  isGraduatingLock,
  priceImpactPct,
  useCurveQuote,
  useCurveReads,
  usePauseBuys,
  useV3Quote,
  venueForStatus,
  type TradeSide,
} from "@/entities/curve";
import { WalletConnectButton } from "@/features/connect-wallet";
import { AddressLink, Badge, Button, Card, Input } from "@/shared/ui";
import { explorer } from "@/shared/lib/chain";
import { formatEthFromWei, formatEthNumber, formatTokenFromWei } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

import { useTradeSubmit } from "../model/use-trade-submit";

/**
 * Buy/Sell widget with the INVISIBLE VENUE SWITCH (§5.2). One design, two
 * engines, selected by the indexed `status` — never a user choice:
 *   status=curve/graduating → curve engine (Router.buy/sell, on-chain quote)
 *   status=graduated        → Uniswap V3 engine
 *
 * INVARIANTS enforced here (proven in tests/trade-widget-gating.test.tsx):
 * - SELL TAB IS NEVER GATED by any pause flag (§6.5/§12.25). `usePauseBuys` is
 *   read ONLY for the Buy tab; the Sell tab never imports/consults it. When buys
 *   are paused the Buy inputs disable with the exact "selling remains open" copy
 *   while Sell stays fully live.
 * - The §12.12 "Graduating…" interstitial locks BOTH sides (deterministic
 *   protocol state) — copy never says "paused".
 * - Anti-sniper: inside the early window the per-tx buy cap is surfaced up-front
 *   (§6.5) rather than letting the tx revert.
 * - Slippage default 2%, deadline on every trade (§5.2).
 */
export function TradeWidget({ token }: { token: TokenDetail }) {
  const venue = venueForStatus(token.status);
  const graduatingLock = isGraduatingLock(token.status);

  if (venue === "v3") return <V3Venue token={token} />;

  return <CurveVenue token={token} graduatingLock={graduatingLock} />;
}

function CurveVenue({
  token,
  graduatingLock,
}: {
  token: TokenDetail;
  graduatingLock: boolean;
}) {
  const [side, setSide] = useState<TradeSide>("buy");
  const [raw, setRaw] = useState("");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const debounced = useDebounced(raw, 250);

  const { isConnected } = useAccount();
  const reads = useCurveReads(token.address as Address, token.curveAddress as Address);
  const { submit, isSubmitting, error } = useTradeSubmit(token);

  // Pause state gates the BUY tab ONLY. `buyPaused` is defined with a `side ===
  // "buy"` guard, so the Sell path can never be disabled by it (§6.5/§12.25):
  // when the Sell tab is active this is always false regardless of pauseBuys.
  const { pauseBuys } = usePauseBuys();
  const buyPaused = side === "buy" && pauseBuys === true;

  const amountWei = useMemo(() => parseAmount(side, debounced), [side, debounced]);
  const { quote, isFetching } = useCurveQuote({
    curve: token.curveAddress as Address,
    side,
    amountWei,
    enabled: !graduatingLock,
  });

  const inEarlyWindow = isInEarlyWindow(reads.earlyWindowEnd);
  const overCap =
    side === "buy" &&
    inEarlyWindow &&
    reads.maxEarlyBuyWei !== null &&
    amountWei !== null &&
    amountWei > reads.maxEarlyBuyWei;

  const minOut = quote ? applySlippageFloor(quote.amountOut, slippageBps) : null;
  const impact = useMemo(
    () => computeImpact(side, amountWei, quote, reads),
    [side, amountWei, quote, reads],
  );

  const canSubmit =
    isConnected &&
    !graduatingLock &&
    !buyPaused &&
    amountWei !== null &&
    amountWei > 0n &&
    quote !== null &&
    !overCap;

  const onSubmit = () => {
    if (!canSubmit || quote === null || amountWei === null) return;
    void submit({ side, amountWei, expectedOut: quote.amountOut, slippageBps });
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <SideTabs side={side} onChange={setSide} disabled={graduatingLock} />

      {graduatingLock && <GraduatingInterstitial />}

      <div className="relative flex flex-col gap-3" aria-disabled={graduatingLock}>
        <AmountField
          token={token}
          side={side}
          raw={raw}
          onRaw={setRaw}
          disabled={graduatingLock || buyPaused}
        />

        {/* Buy-only pause gate. The Sell tab never renders this and its enable/
            submit logic never reads pauseBuys (§6.5/§12.25). */}
        {buyPaused && (
          <p className="rounded-md bg-soft-confirmed/10 px-2 py-1.5 text-xs text-soft-confirmed">
            Buying is temporarily paused — selling remains open.
          </p>
        )}

        {overCap && reads.maxEarlyBuyWei !== null && (
          <p className="text-xs text-soft-confirmed">
            Early-launch buy cap: max {formatEthFromWei(reads.maxEarlyBuyWei)} ETH per
            transaction.
          </p>
        )}
        {!overCap && side === "buy" && inEarlyWindow && reads.maxEarlyBuyWei !== null && (
          <p className="text-xs text-muted-foreground">
            Early-launch window active — max {formatEthFromWei(reads.maxEarlyBuyWei)} ETH
            per buy.
          </p>
        )}

        <QuoteLine
          side={side}
          quote={quote}
          minOut={minOut}
          isFetching={isFetching}
          impact={impact}
        />

        <SlippageControl bps={slippageBps} onChange={setSlippageBps} />

        {error && <p className="text-xs text-sell">{error}</p>}

        {!isConnected ? (
          <WalletConnectButton />
        ) : (
          <Button
            onClick={onSubmit}
            disabled={!canSubmit || isSubmitting}
            variant={side === "buy" ? "default" : "outline"}
            className={cn(
              "w-full",
              side === "buy" ? "bg-buy text-white hover:bg-buy/90" : "border-sell text-sell",
            )}
          >
            {isSubmitting
              ? "Confirming…"
              : side === "buy"
                ? "Buy"
                : "Sell"}
          </Button>
        )}
      </div>
    </Card>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SideTabs({
  side,
  onChange,
  disabled,
}: {
  side: TradeSide;
  onChange: (s: TradeSide) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
      {(["buy", "sell"] as const).map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={side === s}
          disabled={disabled}
          onClick={() => onChange(s)}
          className={cn(
            "rounded-md py-1.5 text-sm font-medium capitalize transition-colors disabled:opacity-50",
            side === s
              ? s === "buy"
                ? "bg-buy/15 text-buy"
                : "bg-sell/15 text-sell"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function AmountField({
  token,
  side,
  raw,
  onRaw,
  disabled,
}: {
  token: TokenDetail;
  side: TradeSide;
  raw: string;
  onRaw: (v: string) => void;
  disabled: boolean;
}) {
  const { address } = useAccount();
  const unit = side === "buy" ? "ETH" : token.ticker;

  const nativeBalance = useBalance({
    address,
    query: { enabled: side === "buy" && !!address },
  });
  const tokenBalance = useReadContract({
    address: token.address as Address,
    abi: launchTokenAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: side === "sell" && !!address },
  });

  const onMax = () => {
    if (side === "buy") {
      const bal = nativeBalance.data?.value;
      if (bal === undefined) return;
      // Leave ~1% headroom for gas (no ETH literal — proportional buffer).
      onRaw(formatEther((bal * 99n) / 100n));
    } else {
      const bal = tokenBalance.data as bigint | undefined;
      if (bal === undefined) return;
      onRaw(formatUnits(bal, 18));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>You {side === "buy" ? "pay" : "sell"}</span>
        {address && (
          <button
            type="button"
            onClick={onMax}
            disabled={disabled}
            className="uppercase tracking-wide hover:text-foreground disabled:opacity-50"
          >
            Max
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2">
        <Input
          inputMode="decimal"
          placeholder="0.0"
          value={raw}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d*$/.test(v)) onRaw(v);
          }}
          className="border-0 bg-transparent px-0 text-lg tabular-nums focus-visible:ring-0"
        />
        <span className="shrink-0 text-sm font-medium text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

function QuoteLine({
  side,
  quote,
  minOut,
  isFetching,
  impact,
}: {
  side: TradeSide;
  quote: ReturnType<typeof useCurveQuote>["quote"];
  minOut: bigint | null;
  isFetching: boolean;
  impact: number | null;
}) {
  const outUnit = side === "buy" ? "tokens" : "ETH";
  const fmtOut = (v: bigint) =>
    side === "buy" ? `${formatTokenFromWei(v)} tokens` : `${formatEthFromWei(v)} ETH`;

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/60 p-2 text-xs">
      <Line label="Expected out">
        {quote ? (
          <span className="tabular-nums text-foreground">{fmtOut(quote.amountOut)}</span>
        ) : (
          <span className="text-muted-foreground">{isFetching ? "quoting…" : "—"}</span>
        )}
      </Line>
      <Line label="Min received (after slippage)">
        {minOut !== null ? (
          <span className="tabular-nums text-foreground">{fmtOut(minOut)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Line>
      <Line label="Fee">
        {quote ? (
          <span className="tabular-nums text-muted-foreground">
            {formatEthFromWei(quote.feeEth)} ETH → treasury
          </span>
        ) : (
          <span className="text-muted-foreground">curve fee → treasury</span>
        )}
      </Line>
      <Line label="Price impact">
        <span
          className={cn(
            "tabular-nums",
            impact !== null && impact > 5 ? "text-soft-confirmed" : "text-muted-foreground",
          )}
        >
          {impact === null ? "—" : `${impact.toFixed(2)}%`}
        </span>
      </Line>
      {quote?.refund !== undefined && quote.refund > 0n && (
        <Line label="Graduation refund">
          <span className="tabular-nums text-muted-foreground">
            {formatEthFromWei(quote.refund)} ETH
          </span>
        </Line>
      )}
      <span className="sr-only">{outUnit}</span>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function SlippageControl({
  bps,
  onChange,
}: {
  bps: number;
  onChange: (bps: number) => void;
}) {
  const pct = bps / 100;
  const warn = bps > SLIPPAGE_WARN_BPS;
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">Slippage · deadline 10m</span>
      <div className="flex items-center gap-1">
        {[50, 100, 200].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className={cn(
              "rounded px-1.5 py-0.5",
              bps === preset ? "bg-secondary text-foreground" : "text-muted-foreground",
            )}
          >
            {preset / 100}%
          </button>
        ))}
        <div className="flex items-center gap-0.5">
          <Input
            inputMode="decimal"
            value={String(pct)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange(clampSlippageBps(v * 100));
            }}
            className={cn(
              "h-6 w-12 px-1 text-right text-xs tabular-nums",
              warn && "text-soft-confirmed",
            )}
          />
          <span className="text-muted-foreground">%</span>
        </div>
      </div>
    </div>
  );
}

function GraduatingInterstitial() {
  return (
    <div className="rounded-md border border-soft-confirmed/40 bg-soft-confirmed/10 p-3 text-center">
      <Badge variant="soft-confirmed" className="mb-1">
        Graduating to Uniswap V3…
      </Badge>
      <p className="text-xs text-muted-foreground">
        The curve has reached its threshold and is locked while it migrates. Both
        buying and selling resume on Uniswap V3 in a moment — this is an automatic
        protocol step, not a pause.
      </p>
    </div>
  );
}

/**
 * Post-graduation venue (§5.2 invisible switch). The engine is selected purely by
 * the indexed `status` — the user never chose it — and the widget UX is the SAME
 * Buy/Sell design as the curve; only the engine underneath differs (M3-5).
 *
 * Quotes come from the Uniswap QuoterV2 REVERT-QUOTER via `useV3Quote`
 * (`useSimulateContract`, never `readContract` — §12.28); execution routes through
 * SwapRouter02 in `useTradeSubmit` (exactInputSingle + multicall/unwrapWETH9 for
 * the native-ETH leg). Slippage default 2% + deadline apply on every trade.
 *
 * SELL IS NEVER GATED: post-graduation has NO pause authority (§6.5), so this
 * venue consults no pause flag at all — both Buy and Sell are always live.
 */
function V3Venue({ token }: { token: TokenDetail }) {
  const [side, setSide] = useState<TradeSide>("buy");
  const [raw, setRaw] = useState("");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const debounced = useDebounced(raw, 250);

  const { isConnected } = useAccount();
  const { submit, isSubmitting, error } = useTradeSubmit(token);

  const amountWei = useMemo(() => parseAmount(side, debounced), [side, debounced]);
  const { amountOut, isFetching } = useV3Quote({
    token: token.address as Address,
    side,
    amountWei,
  });

  const minOut = amountOut !== null ? applySlippageFloor(amountOut, slippageBps) : null;
  const canSubmit =
    isConnected && amountWei !== null && amountWei > 0n && amountOut !== null && amountOut > 0n;

  const onSubmit = () => {
    if (!canSubmit || amountOut === null || amountWei === null) return;
    void submit({ side, amountWei, expectedOut: amountOut, slippageBps });
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <Badge variant="finalized">Graduated</Badge>
        <span className="text-xs text-muted-foreground">Trading on Uniswap V3</span>
      </div>

      <SideTabs side={side} onChange={setSide} disabled={false} />

      <AmountField token={token} side={side} raw={raw} onRaw={setRaw} disabled={false} />

      <V3QuoteLine side={side} amountOut={amountOut} minOut={minOut} isFetching={isFetching} />

      <SlippageControl bps={slippageBps} onChange={setSlippageBps} />

      {error && <p className="text-xs text-sell">{error}</p>}

      {!isConnected ? (
        <WalletConnectButton />
      ) : (
        <Button
          onClick={onSubmit}
          disabled={!canSubmit || isSubmitting}
          variant={side === "buy" ? "default" : "outline"}
          className={cn(
            "w-full",
            side === "buy" ? "bg-buy text-white hover:bg-buy/90" : "border-sell text-sell",
          )}
        >
          {isSubmitting ? "Confirming…" : side === "buy" ? "Buy" : "Sell"}
        </Button>
      )}

      {token.v3PoolAddress ? (
        <a
          href={explorer.address(token.v3PoolAddress)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-center text-[11px] text-muted-foreground hover:text-foreground"
        >
          View the Uniswap V3 pool ↗
        </a>
      ) : null}
    </Card>
  );
}

function V3QuoteLine({
  side,
  amountOut,
  minOut,
  isFetching,
}: {
  side: TradeSide;
  amountOut: bigint | null;
  minOut: bigint | null;
  isFetching: boolean;
}) {
  const fmtOut = (v: bigint) =>
    side === "buy" ? `${formatTokenFromWei(v)} tokens` : `${formatEthFromWei(v)} ETH`;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/60 p-2 text-xs">
      <Line label="Expected out">
        {amountOut !== null ? (
          <span className="tabular-nums text-foreground">{fmtOut(amountOut)}</span>
        ) : (
          <span className="text-muted-foreground">{isFetching ? "quoting…" : "—"}</span>
        )}
      </Line>
      <Line label="Min received (after slippage)">
        {minOut !== null ? (
          <span className="tabular-nums text-foreground">{fmtOut(minOut)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Line>
      <Line label="Venue">
        <span className="tabular-nums text-muted-foreground">
          Uniswap V3 · {V3_FEE_TIER / 10000}% pool
        </span>
      </Line>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function parseAmount(side: TradeSide, raw: string): bigint | null {
  if (!raw || raw === "." || Number(raw) <= 0) return null;
  try {
    return side === "buy" ? parseEther(raw) : parseUnits(raw, 18);
  } catch {
    return null;
  }
}

function computeImpact(
  side: TradeSide,
  amountWei: bigint | null,
  quote: ReturnType<typeof useCurveQuote>["quote"],
  reads: ReturnType<typeof useCurveReads>,
): number | null {
  if (!quote || amountWei === null || !reads.reserves) return null;
  const eth =
    side === "buy"
      ? Number(formatEther(quote.acceptedEthGross ?? amountWei))
      : Number(formatEther(quote.amountOut));
  const tokens =
    side === "buy"
      ? Number(formatUnits(quote.amountOut, 18))
      : Number(formatUnits(amountWei, 18));
  return priceImpactPct({
    side,
    eth,
    tokens,
    virtualEth: Number(formatEther(reads.reserves.virtualEth)),
    virtualToken: Number(formatUnits(reads.reserves.virtualToken, 18)),
  });
}

/** Debounce a string value (quote-input debounce, web.md decide-yourself). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}
