"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";

import {
  METADATA_DESCRIPTION_MAX,
  METADATA_NAME_MAX,
  METADATA_TICKER_MAX,
} from "@robbed/shared";
import { AmountInput, Button, Input, MonoLabel, MonoText, TextArea, toast } from "@/shared/ui";
import { formatTokenFromWei } from "@/shared/lib/format";

import { launchBlockReason } from "../model/block-reason";
import { launchTextSchema, parseInitialBuyEth } from "../model/schema";
import { initialBuyMinTokensOut, previewInitialBuy } from "../model/initial-buy-preview";
import { type LaunchStep, isLaunchInFlight } from "../model/steps";
import { useLaunch, type UseLaunchOptions } from "../model/use-launch";
import { useLaunchEconomics } from "../model/use-launch-economics";
import { EconomicsPanel } from "./EconomicsPanel";
import { ImageUpload } from "./ImageUpload";
import { LaunchProgress } from "./LaunchProgress";

/**
 * Launch form — ROBBED_ terminal skin (redesign mockup, — panel "Create"),
 * mobile-first single column: dashed 512×512 logo slot beside NAME / TICKER,
 * DESCRIPTION, INITIAL BUY, the live economics summary, and the green LAUNCH
 * TOKEN action.
 *
 * Re-skin only — the data layer is untouched: field state validates with the
 * SHARED zod schemas (byte limits, never redeclared), the image is
 * eagerly API-uploaded on select (, re-encode + content-address server
 * side), the client re-verifies the metadata hash before signing (
 * normative, inside `useLaunch`), and the single atomic `createToken`
 * ({deployFee + initialBuy}) submit + optimistic stepper run unchanged.
 *
 * The submit button never hides WHY it won't launch: a single prioritized
 * `blockReason` (not-connected → image uploading/errored → invalid field →
 * `pauseCreates` → in-flight) renders as a persistent helper line and fires an
 * error toast on click, instead of a bare `disabled`. The button is only truly
 * disabled while a launch is mid-flight (double-submit guard). `pauseCreates`
 * (live factory read) blocks the launch but is a granular flag — sells elsewhere
 * are never affected.
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
  // "Uploading an image" is part of `isLaunchInFlight`, but it is NOT a launch
  // in progress — it happens on file-select, before submit. The submit button
  // stays clickable through it (so it can explain "waiting for the image"); only
  // an actual mid-flight launch keeps the button disabled (double-submit guard).
  const launchInFlight = inFlight && launcher.step !== "uploading";
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

  // First field-validation message (derived, does NOT set inline `errors` — that
  // stays a submit-time concern). Feeds `blockReason`.
  const fieldError = useMemo<string | null>(() => {
    const parsed = launchTextSchema.safeParse({
      name: name.trim(),
      ticker: ticker.trim(),
      description: description.trim() ? description.trim() : undefined,
    });
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "Check the form fields.";
    if (!launcher.image.url || !launcher.image.hash) return "A logo image is required.";
    if (!initialBuyParse.ok) return initialBuyParse.error;
    return null;
  }, [name, ticker, description, launcher.image.url, launcher.image.hash, initialBuyParse]);

  const createsPaused = econ.pauseCreates === true;

  // Single, prioritized reason the LAUNCH action is blocked. `null` ⇒ the
  // click proceeds to validate() + launch(). Surfaced as a toast on click AND as
  // a persistent helper line under the button.
  const blockReason = useMemo(
    () =>
      launchBlockReason({
        isConnected,
        imageUploading: launcher.image.uploading,
        imageError: launcher.image.error,
        fieldError,
        createsPaused,
        step: launcher.step,
      }),
    [isConnected, launcher.image.uploading, launcher.image.error, fieldError, createsPaused, launcher.step],
  );

  // Launch outcome → toast (confirmation tiers, never an unqualified
  // "confirmed"). Fires once per terminal transition; `toast` is a stable module
  // singleton so it needs no dependency entry.
  const toastedStepRef = useRef<LaunchStep | null>(null);
  useEffect(() => {
    const step = launcher.step;
    if (toastedStepRef.current === step) return;
    if (step === "soft-confirmed") {
      toast.success("Token launched — it's tradeable now.");
    } else if (step === "live-unindexed") {
      toast.info("Tradeable now — still indexing. Your token page opens shortly.");
    } else if ((step === "error" || step === "verify-failed") && launcher.error) {
      toast.error(launcher.error);
    }
    toastedStepRef.current = step;
  }, [launcher.step, launcher.error]);

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
    // Blocked: explain WHY (toast + inline field errors), never submit silently.
    if (blockReason) {
      validate(); // surface per-field inline errors alongside the toast
      toast.error(blockReason);
      return;
    }
    if (!validate()) return; // safety net (blockReason null ⇒ this passes)
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

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {/* Logo slot beside NAME / TICKER (mockup top block, template 451-453:
          96px slot, 18px row gap, 14px field gap in the right column). */}
      <div className="flex gap-[18px]">
        <ImageUpload
          image={launcher.image}
          onSelect={launcher.uploadImage}
          onClear={launcher.clearImage}
          disabled={disabledForm}
          className="w-24 shrink-0"
        />

        <div className="flex flex-1 flex-col gap-3.5">
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
              {/* Counter is n/10, not the mockup's /8 — fixes the ticker
                  limit at 10 BYTES; the spec wins over the mockup. */}
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
          // Mockup 2b (template 466): 56px min-height, muted-token placeholder
          // — per-instance override, the kit default stays faint.
          className="min-h-[56px] placeholder:text-muted"
        />
      </Field>

      <div className="flex flex-col gap-2">
        <AmountInput
          label={
            <>
              {/* Optional suffix in the border-strong token (template 469). */}
              Initial buy <span className="text-border-strong">— optional, be first in</span>
            </>
          }
          value={initialBuy}
          onValueChange={(v) => {
            if (v === "" || /^\d*\.?\d*$/.test(v)) setInitialBuy(v);
          }}
          unit="ETH"
          disabled={disabledForm}
          // Mockup 2b (template 470): the INITIAL BUY value is ~13px like the
          // other create-form inputs — per-instance override; the atom's 17px
          // default is the trade-widget size and must not change.
          inputClassName="text-base"
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

      {/* Deploy cost / starting price / supply + economics + LP sentence. */}
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
        // Mockup 2b (template 477): 13px/600 label, 13px vertical padding, NO
        // letter-spacing (size="lg" already renders text-base = 13px).
        // Clickable through every block reason (so the click can EXPLAIN why it
        // won't launch); only a launch already in-flight disables it (double-submit).
        disabled={launchInFlight}
        aria-disabled={blockReason ? true : undefined}
        className="h-auto w-full py-[13px] uppercase"
      >
        {submitLabel(launcher.step)}
      </Button>

      {/* Persistent, muted reason the button won't launch — visible without a
          click. Hidden during an actual in-flight launch (the stepper shows it). */}
      {blockReason && !launchInFlight && (
        <MonoText tone="faint" size="xs" className="text-center">
          {blockReason}
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
        {/* Mockup 2b: faint-token micro-labels; the optional suffix sits a
            step darker in the border-strong token (template 465/469). */}
        <MonoLabel tone="faint" size="2xs">
          {label}
          {optional && <span className="text-border-strong"> — {optional}</span>}
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

/** UTF-8 byte counter (matches the byte limit the shared schema enforces). */
function byteCounter(value: string, max: number): string {
  const bytes = new TextEncoder().encode(value).length;
  return `${bytes}/${max}`;
}

function submitLabel(step: LaunchStep): string {
  if (step === "verify-failed") return "Launch blocked — hash mismatch";
  // "uploading" is a pre-submit image step, not a launch in progress.
  if (isLaunchInFlight(step) && step !== "uploading") return "Launching…";
  return "Launch token";
}
