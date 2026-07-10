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
import {
  AddressLink,
  AmountInput,
  Card,
  Chip,
  CursorTag,
  MonoLabel,
  MonoText,
  SideBadge,
} from "@/shared/ui";
import { TAGLINE_TRADE } from "@/shared/config/copy";
import { formatEthFromWei, formatTokenFromWei } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

import { useTradeSubmit } from "../model/use-trade-submit";
import { isLargeValueWei, largeValueThresholdWei } from "../model/large-value";

/**
 * Buy/Sell widget with the INVISIBLE VENUE SWITCH (§5.2) — ROBBED_ terminal skin
 * (docs/Robbed.html "2a" trade panel). One design, two engines, selected by the
 * indexed `status` — never a user choice:
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
 *
 * FOLDED-IN (§12.47, task B): when a trade's ETH notional ≥
 * `NEXT_PUBLIC_LARGE_VALUE_ETH_THRESHOLD` (default 1.0 ETH) the widget surfaces
 * the extra confirmation-tier disclosure (§2.1) — large-value displays must
 * disclose the posted/finalized tiers, not just soft-confirmed.
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

  // §12.47: ETH notional = the ETH leg — the input for a buy, the expected ETH
  // out for a sell.
  const ethNotionalWei = side === "buy" ? amountWei : (quote?.amountOut ?? null);

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
    <Card className="flex flex-col gap-3.5 p-4">
      <SideTabs side={side} onChange={setSide} disabled={graduatingLock} />

      {graduatingLock && <GraduatingInterstitial />}

      <div className="relative flex flex-col gap-3.5" aria-disabled={graduatingLock}>
        <PayField
          token={token}
          side={side}
          raw={raw}
          onRaw={setRaw}
          disabled={graduatingLock || buyPaused}
        />

        {/* Buy-only pause gate. The Sell tab never renders this and its enable/
            submit logic never reads pauseBuys (§6.5/§12.25). */}
        {buyPaused && (
          <p className="border-l-2 border-soft-confirmed bg-soft-confirmed/10 px-2 py-1.5 text-xs text-soft-confirmed">
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
          <p className="text-xs text-muted">
            Early-launch window active — max {formatEthFromWei(reads.maxEarlyBuyWei)} ETH
            per buy.
          </p>
        )}

        <ReceiveBox
          side={side}
          token={token}
          out={quote?.amountOut ?? null}
          isFetching={isFetching}
        />

        <InfoRows
          side={side}
          feeLabel={feeLabelFromBps(reads.tradeFeeBps)}
          minOut={minOut}
          impact={impact}
          refund={quote?.refund}
        />

        <SlippageControl bps={slippageBps} onChange={setSlippageBps} />

        <LargeValueDisclosure ethWei={ethNotionalWei} side={side} />

        {error && <p className="text-xs text-red">{error}</p>}

        <ActionButton
          isConnected={isConnected}
          side={side}
          disabled={!canSubmit || isSubmitting}
          isSubmitting={isSubmitting}
          onSubmit={onSubmit}
        />

        <Tagline />
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
    // Mockup: 2-col bordered toggle; active BUY = green-dim fill/green text,
    // active SELL = red-dim fill/red text. role="tab" preserved for a11y + tests.
    <div role="tablist" className="grid grid-cols-2 border border-border">
      {(["buy", "sell"] as const).map((s) => {
        const active = side === s;
        return (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(s)}
            className={cn(
              "py-2.5 text-center text-xs font-semibold capitalize transition-colors disabled:opacity-50",
              active
                ? s === "buy"
                  ? "bg-green-dim text-green"
                  : "bg-red-dim text-red"
                : "text-muted hover:text-text",
            )}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

function PayField({
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

  const setFromWei = (bal: bigint | undefined, num: bigint, den: bigint, buy: boolean) => {
    if (bal === undefined) return;
    const v = (bal * num) / den;
    onRaw(buy ? formatEther(v) : formatUnits(v, 18));
  };

  const maxBuy = () => {
    // Leave ~1% headroom for gas (no ETH literal — proportional buffer).
    setFromWei(nativeBalance.data?.value, 99n, 100n, true);
  };
  const maxSell = () => setFromWei(tokenBalance.data as bigint | undefined, 1n, 1n, false);

  const quick =
    side === "buy"
      ? [
          { label: "0.1", onSelect: () => onRaw("0.1"), active: raw === "0.1" },
          { label: "0.5", onSelect: () => onRaw("0.5"), active: raw === "0.5" },
          { label: "1", onSelect: () => onRaw("1"), active: raw === "1" },
          { label: "MAX", onSelect: maxBuy },
        ]
      : [
          {
            label: "25%",
            onSelect: () => setFromWei(tokenBalance.data as bigint | undefined, 1n, 4n, false),
          },
          {
            label: "50%",
            onSelect: () => setFromWei(tokenBalance.data as bigint | undefined, 1n, 2n, false),
          },
          { label: "MAX", onSelect: maxSell },
        ];

  return (
    <AmountInput
      label="You pay"
      value={raw}
      onValueChange={(v) => {
        if (v === "" || /^\d*\.?\d*$/.test(v)) onRaw(v);
      }}
      unit={unit}
      quick={address ? quick : undefined}
      disabled={disabled}
    />
  );
}

function ReceiveBox({
  side,
  token,
  out,
  isFetching,
}: {
  side: TradeSide;
  token: TokenDetail;
  out: bigint | null;
  isFetching: boolean;
}) {
  const unit = side === "buy" ? token.ticker : "ETH";
  const text =
    out !== null
      ? side === "buy"
        ? formatTokenFromWei(out)
        : formatEthFromWei(out)
      : isFetching
        ? "quoting…"
        : "0.0";
  return (
    <div className="flex w-full flex-col gap-1.5">
      <MonoLabel size="2xs">You receive</MonoLabel>
      <div className="flex items-center gap-2 border border-border px-3 py-2.5">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xl tabular-nums",
            out !== null ? "text-text" : "text-faint",
          )}
        >
          {text}
        </span>
        <span className="shrink-0 text-xs text-faint">{unit}</span>
      </div>
    </div>
  );
}

function InfoRows({
  side,
  feeLabel,
  minOut,
  impact,
  refund,
}: {
  side: TradeSide;
  feeLabel: string;
  minOut: bigint | null;
  impact: number | null;
  refund?: bigint;
}) {
  const fmtOut = (v: bigint) =>
    side === "buy" ? `${formatTokenFromWei(v)}` : `${formatEthFromWei(v)} ETH`;
  return (
    <div className="flex flex-col gap-2 border-t border-border-soft pt-3 text-xs text-muted">
      <Row label="Price impact">
        <span className={cn("tabular-nums", impact !== null && impact > 5 && "text-soft-confirmed")}>
          {impact === null ? "—" : `${impact.toFixed(2)}%`}
        </span>
      </Row>
      <Row label="Fee">
        <span className="tabular-nums">{feeLabel} → treasury</span>
      </Row>
      <Row label="Min received">
        <span className="tabular-nums text-text-secondary">
          {minOut !== null ? fmtOut(minOut) : "—"}
        </span>
      </Row>
      {refund !== undefined && refund > 0n && (
        <Row label="Graduation refund">
          <span className="tabular-nums">{formatEthFromWei(refund)} ETH</span>
        </Row>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
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
    <div className="flex items-center justify-between text-xs text-muted">
      <span>Max slippage · deadline 10m</span>
      <div className="flex items-center gap-1.5">
        {[50, 100, 200].map((preset) => (
          <Chip
            key={preset}
            variant="outline"
            active={bps === preset}
            onClick={() => onChange(preset)}
          >
            {preset / 100}%
          </Chip>
        ))}
        <span className={cn("tabular-nums", warn && "text-soft-confirmed")}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

/**
 * §12.47 large-value disclosure (task B). Above the ETH threshold, a trade's
 * confirmation tiers matter: it renders soft-confirmed NOW, then posts to L1,
 * then finalizes — settlement finality follows L1 posting on this single-
 * sequencer L2. We surface that here rather than implying instant settlement.
 */
function LargeValueDisclosure({
  ethWei,
  side,
}: {
  ethWei: bigint | null;
  side: TradeSide;
}) {
  const thresholdWei = largeValueThresholdWei();
  if (ethWei === null || !isLargeValueWei(ethWei, thresholdWei)) return null;
  const noun = side === "buy" ? "buy" : "sale";
  return (
    <div className="flex flex-col gap-1.5 border border-soft-confirmed/40 bg-soft-confirmed/5 p-2.5 text-xs">
      <div className="flex items-center gap-2">
        <SideBadge side="buy" label="LARGE" className="text-soft-confirmed" />
        <MonoText tone="default" numeric>
          {formatEthFromWei(ethWei)} ETH
        </MonoText>
      </div>
      <p className="text-muted">
        This {noun} is <span className="text-soft-confirmed">soft-confirmed</span> the
        instant the sequencer includes it, then upgrades to{" "}
        <span className="text-posted">posted to L1</span> and{" "}
        <span className="text-finalized">finalized</span>. At this size, wait for the
        posted/finalized tier in the trades feed before treating it as settled.
      </p>
    </div>
  );
}

function ActionButton({
  isConnected,
  side,
  disabled,
  isSubmitting,
  onSubmit,
}: {
  isConnected: boolean;
  side: TradeSide;
  disabled: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
}) {
  if (!isConnected) return <WalletConnectButton />;
  return (
    <button
      type="button"
      onClick={onSubmit}
      disabled={disabled}
      className={cn(
        "w-full py-3 text-center text-sm font-semibold text-accent-foreground transition-colors disabled:opacity-40",
        side === "buy" ? "bg-green hover:bg-green/90" : "bg-red hover:bg-red/90",
      )}
    >
      {/* Accessible name stays exactly "Buy"/"Sell" (test contract). */}
      {isSubmitting ? "Confirming…" : side === "buy" ? "Buy" : "Sell"}
    </button>
  );
}

function Tagline() {
  return (
    <div className="pt-0.5 text-center">
      <CursorTag>{TAGLINE_TRADE}</CursorTag>
    </div>
  );
}

function GraduatingInterstitial() {
  return (
    <div className="border border-soft-confirmed/40 bg-soft-confirmed/10 p-3 text-center">
      <div className="mb-1 flex justify-center">
        {/* Mixed-case textContent (CSS uppercases visually) — the §12.12 copy
            contract asserts on the literal "Graduating to Uniswap V3". */}
        <SideBadge side="graduate" label="Graduating to Uniswap V3…" />
      </div>
      <p className="text-xs text-muted">
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
  const ethNotionalWei = side === "buy" ? amountWei : amountOut;
  const canSubmit =
    isConnected && amountWei !== null && amountWei > 0n && amountOut !== null && amountOut > 0n;

  const onSubmit = () => {
    if (!canSubmit || amountOut === null || amountWei === null) return;
    void submit({ side, amountWei, expectedOut: amountOut, slippageBps });
  };

  return (
    <Card className="flex flex-col gap-3.5 p-4">
      <div className="flex items-center justify-between">
        <SideBadge side="graduate" label="GRADUATED" />
        <MonoText tone="muted" size="xs">
          Trading on Uniswap V3
        </MonoText>
      </div>

      <SideTabs side={side} onChange={setSide} disabled={false} />

      <PayField token={token} side={side} raw={raw} onRaw={setRaw} disabled={false} />

      <ReceiveBox side={side} token={token} out={amountOut} isFetching={isFetching} />

      <InfoRows
        side={side}
        feeLabel={`Uniswap V3 pool ${V3_FEE_TIER / 10000}%`}
        minOut={minOut}
        impact={null}
      />

      <SlippageControl bps={slippageBps} onChange={setSlippageBps} />

      <LargeValueDisclosure ethWei={ethNotionalWei} side={side} />

      {error && <p className="text-xs text-red">{error}</p>}

      <ActionButton
        isConnected={isConnected}
        side={side}
        disabled={!canSubmit || isSubmitting}
        isSubmitting={isSubmitting}
        onSubmit={onSubmit}
      />

      {token.v3PoolAddress ? (
        <div className="text-center">
          <AddressLink
            address={token.v3PoolAddress}
            kind="address"
            label="View the Uniswap V3 pool ↗"
            className="text-[11px] text-muted"
          />
        </div>
      ) : null}

      <Tagline />
    </Card>
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

/** bps → "1%" / "1.5%" fee label, rendered from the on-chain value (never a copy
 *  literal, §2). `null` (read pending) degrades to "curve fee". */
function feeLabelFromBps(bps: number | null): string {
  if (bps === null) return "curve fee";
  const pct = bps / 100;
  const s = Number.isInteger(pct) ? pct.toString() : pct.toFixed(2).replace(/0+$/, "");
  return `${s}% curve fee`;
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
