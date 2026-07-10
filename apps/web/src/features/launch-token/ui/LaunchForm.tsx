"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";

import {
  METADATA_DESCRIPTION_MAX,
  METADATA_NAME_MAX,
  METADATA_TICKER_MAX,
} from "@robbed/shared";
import { AmountInput, Button, Input, MonoLabel, MonoText, TextArea } from "@/shared/ui";
import { formatTokenFromWei } from "@/shared/lib/format";

import { launchTextSchema, parseInitialBuyEth } from "../model/schema";
import { initialBuyMinTokensOut, previewInitialBuy } from "../model/initial-buy-preview";
import { type LaunchStep, isLaunchInFlight } from "../model/steps";
import { useLaunch, type UseLaunchOptions } from "../model/use-launch";
import { useLaunchEconomics } from "../model/use-launch-economics";
import { EconomicsPanel } from "./EconomicsPanel";
import { ImageUpload } from "./ImageUpload";
import { LaunchProgress } from "./LaunchProgress";

/**
 * Launch form (§5.3) — ROBBED_ terminal skin (docs/Robbed.html "Create"),
 * mobile-first single column: dashed 512×512 logo slot beside NAME / TICKER,
 * DESCRIPTION, INITIAL BUY, the live economics summary, and the green LAUNCH
 * TOKEN action.
 *
 * Re-skin only — the data layer is untouched: field state validates with the
 * SHARED zod schemas (byte limits §12.30, never redeclared), the image is
 * eagerly API-uploaded on select (§12.19, re-encode + content-address server
 * side), the client re-verifies the metadata hash before signing (§12.19
 * normative, inside `useLaunch`), and the single atomic `createToken`
 * ({deployFee + initialBuy}) submit + optimistic stepper run unchanged.
 * `pauseCreates` (live factory read) disables submit only; sells elsewhere are
 * never affected (granular flag, §6.5).
 *
 * `launchOptions` lets a test inject the network/navigation deps (deterministic).
 */
export function LaunchForm({ launchOptions }: { launchOptions?: UseLaunchOptions }) {
  const { isConnected } = useAccount();
  const econ = useLaunchEconomics();
  const launcher = useLaunch(launchOptions);

  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [initialBuy, setInitialBuy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const inFlight = isLaunchInFlight(launcher.step);
  const disabledForm = inFlight;
  const unit = ticker.trim() ? ticker.trim() : "tokens";

  const initialBuyParse = useMemo(() => parseInitialBuyEth(initialBuy), [initialBuy]);

  // M3-6: live tokens-received preview of the atomic initial buy via the SHARED
  // `previewBuy` curve math, seeded by the factory's virtual reserves — no
  // on-chain call (the token doesn't exist yet), no re-implemented math. The
  // non-zero `minTokensOut` slippage floor (2%) is derived from the same preview.
  const initialBuyWei = initialBuyParse.ok ? initialBuyParse.wei : 0n;
  const preview = useMemo(
    () =>
      previewInitialBuy({
        virtualEth0: econ.virtualEth0,
        virtualToken0: econ.virtualToken0,
        tradeFeeBps: econ.tradeFeeBps,
        ethInGrossWei: initialBuyWei,
      }),
    [econ.virtualEth0, econ.virtualToken0, econ.tradeFeeBps, initialBuyWei],
  );
  const minTokensOut = useMemo(() => initialBuyMinTokensOut(preview), [preview]);

  function collectValues() {
    return {
      name: name.trim(),
      ticker: ticker.trim(),
      description: description.trim() ? description.trim() : undefined,
    };
  }

  function validate(): boolean {
    const next: Record<string, string> = {};

    const parsed = launchTextSchema.safeParse(collectValues());
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "form";
        if (!next[key]) next[key] = issue.message;
      }
    }
    if (!launcher.image.url || !launcher.image.hash) {
      next.image = launcher.image.error ?? "A logo image is required.";
    }
    if (!initialBuyParse.ok) next.initialBuy = initialBuyParse.error;

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    if (!initialBuyParse.ok) return;
    const values = collectValues();
    await launcher.launch({
      name: values.name,
      ticker: values.ticker,
      description: values.description,
      initialBuyWei: initialBuyParse.wei,
      minTokensOut,
      deployFeeWei: econ.deployFeeWei ?? 0n,
    });
  }

  const createsPaused = econ.pauseCreates === true;
  const submitDisabled = disabledForm || createsPaused || launcher.image.uploading;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {/* Logo slot beside NAME / TICKER (mockup top block). */}
      <div className="flex gap-4">
        <ImageUpload
          image={launcher.image}
          onSelect={launcher.uploadImage}
          onClear={launcher.clearImage}
          disabled={disabledForm}
          className="w-28 shrink-0 sm:w-36"
        />

        <div className="flex flex-1 flex-col gap-4">
          <Field label="Name" error={errors.name}>
            <Input
              value={name}
              disabled={disabledForm}
              placeholder="Moonmilk"
              onChange={(e) => setName(e.target.value)}
              className="h-11"
            />
          </Field>

          <Field label="Ticker" error={errors.ticker}>
            <div className="relative">
              <Input
                value={ticker}
                disabled={disabledForm}
                placeholder="MILK"
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                className="h-11 pr-14"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-2xs tabular-nums text-faint">
                {byteCounter(ticker, METADATA_TICKER_MAX)}
              </span>
            </div>
          </Field>
        </div>
      </div>

      <Field label="Description" optional="OPTIONAL" error={errors.description}>
        <TextArea
          value={description}
          disabled={disabledForm}
          maxLength={METADATA_DESCRIPTION_MAX}
          placeholder="what is this token about"
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-24"
        />
      </Field>

      <div className="flex flex-col gap-2">
        <AmountInput
          label={
            <>
              Initial buy <span className="text-faint">— optional, be first in</span>
            </>
          }
          value={initialBuy}
          onValueChange={(v) => {
            if (v === "" || /^\d*\.?\d*$/.test(v)) setInitialBuy(v);
          }}
          unit="ETH"
          disabled={disabledForm}
        />
        {errors.initialBuy && (
          <MonoText tone="red" size="xs">
            {errors.initialBuy}
          </MonoText>
        )}

        {/* M3-6: tokens-received preview (no on-chain call — shared curve math). */}
        {initialBuyWei > 0n && preview && (
          <div className="flex flex-col gap-1 pt-1">
            <PreviewRow label="You receive">
              ≈ {formatTokenFromWei(preview.tokensOut)} {unit}
            </PreviewRow>
            <PreviewRow label="Min received (2% slippage)">
              {formatTokenFromWei(minTokensOut)} {unit}
            </PreviewRow>
          </div>
        )}
      </div>

      {/* Deploy cost / starting price / supply + §5.3 economics + LP sentence. */}
      <EconomicsPanel ticker={ticker} />

      {createsPaused && (
        <MonoText size="xs" className="text-soft-confirmed">
          New launches are temporarily paused.
        </MonoText>
      )}

      {launcher.error && launcher.step !== "verify-failed" && launcher.step !== "error" && (
        <MonoText tone="red" size="xs">
          {launcher.error}
        </MonoText>
      )}

      <Button
        type="submit"
        variant="buy"
        size="lg"
        disabled={submitDisabled || !isConnected}
        className="w-full uppercase tracking-label"
      >
        {submitLabel(launcher.step)}
      </Button>

      {!isConnected && (
        <MonoText tone="faint" size="xs" className="text-center">
          Connect your wallet (top right) to launch.
        </MonoText>
      )}

      <LaunchProgress
        step={launcher.step}
        error={launcher.error}
        tokenAddress={launcher.tokenAddress}
        optimisticTrade={launcher.optimisticTrade}
      />
    </form>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function Field({
  label,
  optional,
  error,
  counter,
  children,
}: {
  label: string;
  /** Faint " — {optional}" suffix on the micro-label (mockup DESCRIPTION). */
  optional?: string;
  error?: string;
  counter?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <MonoLabel tone="muted" size="2xs">
          {label}
          {optional && <span className="text-faint"> — {optional}</span>}
        </MonoLabel>
        {counter && (
          <span className="text-2xs tabular-nums text-faint">{counter}</span>
        )}
      </div>
      {children}
      {error && (
        <MonoText tone="red" size="xs">
          {error}
        </MonoText>
      )}
    </div>
  );
}

function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <MonoText tone="muted" size="xs">
        {label}
      </MonoText>
      <MonoText tone="secondary" size="xs" numeric className="text-right">
        {children}
      </MonoText>
    </div>
  );
}

/** UTF-8 byte counter (matches the §12.30 byte limit the shared schema enforces). */
function byteCounter(value: string, max: number): string {
  const bytes = new TextEncoder().encode(value).length;
  return `${bytes}/${max}`;
}

function submitLabel(step: LaunchStep): string {
  if (step === "verify-failed") return "Launch blocked — hash mismatch";
  if (isLaunchInFlight(step)) return "Launching…";
  return "Launch token";
}
