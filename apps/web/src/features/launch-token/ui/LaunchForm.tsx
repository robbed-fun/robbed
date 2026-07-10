"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";

import {
  METADATA_DESCRIPTION_MAX,
  METADATA_NAME_MAX,
  METADATA_TICKER_MAX,
} from "@robbed/shared";
import { Button, Card, Input } from "@/shared/ui";
import { cn } from "@/shared/lib/utils";
import { formatEthFromWei, formatTokenFromWei } from "@/shared/lib/format";

import { launchTextSchema, parseInitialBuyEth } from "../model/schema";
import { initialBuyMinTokensOut, previewInitialBuy } from "../model/initial-buy-preview";
import { type LaunchStep, isLaunchInFlight } from "../model/steps";
import { useLaunch, type UseLaunchOptions } from "../model/use-launch";
import { useLaunchEconomics } from "../model/use-launch-economics";
import { EconomicsPanel } from "./EconomicsPanel";
import { ImageUpload } from "./ImageUpload";
import { LaunchProgress } from "./LaunchProgress";

/**
 * Launch form (§5.3). Client orchestrator: holds field state, validates with the
 * SHARED zod schemas (byte limits §12.30, never redeclared), eagerly API-uploads
 * the image on select (§12.19), and drives the single `createToken` submit via
 * `useLaunch`. `pauseCreates` (live factory read) disables submit; sells elsewhere
 * are unaffected (granular flag, §6.5).
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
  const [website, setWebsite] = useState("");
  const [x, setX] = useState("");
  const [telegram, setTelegram] = useState("");
  const [initialBuy, setInitialBuy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const inFlight = isLaunchInFlight(launcher.step);
  const disabledForm = inFlight;

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
    const links: Record<string, string> = {};
    if (website.trim()) links.website = website.trim();
    if (x.trim()) links.x = x.trim();
    if (telegram.trim()) links.telegram = telegram.trim();
    return {
      name: name.trim(),
      ticker: ticker.trim(),
      description: description.trim() ? description.trim() : undefined,
      links: Object.keys(links).length > 0 ? links : undefined,
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
      next.image = launcher.image.error ?? "An image is required.";
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
      links: values.links,
      initialBuyWei: initialBuyParse.wei,
      minTokensOut,
      deployFeeWei: econ.deployFeeWei ?? 0n,
    });
  }

  const createsPaused = econ.pauseCreates === true;
  const submitDisabled = disabledForm || createsPaused || launcher.image.uploading;

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_20rem]">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Card className="flex flex-col gap-4 p-4">
          <Field
            label="Name"
            required
            error={errors.name}
            counter={byteCounter(name, METADATA_NAME_MAX)}
          >
            <Input
              value={name}
              disabled={disabledForm}
              placeholder="Cash Cat"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field
            label="Ticker"
            required
            error={errors.ticker}
            counter={byteCounter(ticker, METADATA_TICKER_MAX)}
          >
            <Input
              value={ticker}
              disabled={disabledForm}
              placeholder="CASHCAT"
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
            />
          </Field>

          <Field
            label="Description"
            error={errors.description}
            counter={`${description.length}/${METADATA_DESCRIPTION_MAX}`}
          >
            <textarea
              value={description}
              disabled={disabledForm}
              maxLength={METADATA_DESCRIPTION_MAX}
              placeholder="What is this token about?"
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
          </Field>

          <ImageUpload
            image={launcher.image}
            onSelect={launcher.uploadImage}
            onClear={launcher.clearImage}
            disabled={disabledForm}
          />
          {errors.image && !launcher.image.error && (
            <p className="-mt-2 text-xs text-sell">{errors.image}</p>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <p className="text-xs font-medium text-muted-foreground">
            Links <span className="font-normal">(optional, https only)</span>
          </p>
          <Field label="Website" error={errors["links.website"]} compact>
            <Input
              value={website}
              disabled={disabledForm}
              placeholder="https://…"
              onChange={(e) => setWebsite(e.target.value)}
            />
          </Field>
          <Field label="X (Twitter)" error={errors["links.x"]} compact>
            <Input
              value={x}
              disabled={disabledForm}
              placeholder="https://x.com/…"
              onChange={(e) => setX(e.target.value)}
            />
          </Field>
          <Field label="Telegram" error={errors["links.telegram"]} compact>
            <Input
              value={telegram}
              disabled={disabledForm}
              placeholder="https://t.me/…"
              onChange={(e) => setTelegram(e.target.value)}
            />
          </Field>
        </Card>

        <Card className="flex flex-col gap-2 p-4">
          <Field
            label="Initial buy (optional)"
            error={errors.initialBuy}
            hint="Buy your own token atomically in the same transaction — anti-self-snipe."
          >
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2">
              <Input
                inputMode="decimal"
                value={initialBuy}
                disabled={disabledForm}
                placeholder="0.0"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d*\.?\d*$/.test(v)) setInitialBuy(v);
                }}
                className="border-0 bg-transparent px-0 tabular-nums focus-visible:ring-0"
              />
              <span className="shrink-0 text-sm text-muted-foreground">ETH</span>
            </div>
          </Field>

          {/* M3-6: tokens-received preview (no on-chain call — shared curve math). */}
          {initialBuyWei > 0n && (
            <div className="flex flex-col gap-1 rounded-md border border-border/60 p-2 text-xs">
              {preview ? (
                <>
                  <PreviewRow label="You receive">
                    ≈ {formatTokenFromWei(preview.tokensOut)}{" "}
                    {ticker.trim() ? ticker.trim() : "tokens"}
                  </PreviewRow>
                  <PreviewRow label="Min received (2% slippage)">
                    {formatTokenFromWei(minTokensOut)}{" "}
                    {ticker.trim() ? ticker.trim() : "tokens"}
                  </PreviewRow>
                </>
              ) : (
                <span className="text-muted-foreground">
                  Token preview appears once economics load from chain.
                </span>
              )}
            </div>
          )}
        </Card>

        {createsPaused && (
          <p className="rounded-md border border-soft-confirmed/40 bg-soft-confirmed/10 p-2 text-xs text-soft-confirmed">
            New launches are temporarily paused.
          </p>
        )}

        {!isConnected && (
          <p className="text-xs text-muted-foreground">
            Connect your wallet (top right) to launch.
          </p>
        )}

        {launcher.error && launcher.step !== "verify-failed" && launcher.step !== "error" && (
          <p className="text-xs text-sell">{launcher.error}</p>
        )}

        <Button
          type="submit"
          disabled={submitDisabled || !isConnected}
          className={cn("w-full bg-buy text-white hover:bg-buy/90")}
        >
          {submitLabel(launcher.step, econ.deployFeeWei, initialBuyParse.ok ? initialBuyParse.wei : 0n)}
        </Button>

        <LaunchProgress
          step={launcher.step}
          error={launcher.error}
          tokenAddress={launcher.tokenAddress}
          optimisticTrade={launcher.optimisticTrade}
        />
      </form>

      <aside className="flex flex-col gap-4">
        <EconomicsPanel />
      </aside>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  error,
  counter,
  hint,
  compact,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  counter?: string;
  hint?: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1", compact && "gap-0.5")}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">
          {label} {required && <span className="text-sell">*</span>}
        </label>
        {counter && <span className="text-[11px] tabular-nums text-muted-foreground">{counter}</span>}
      </div>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-sell">{error}</p>}
    </div>
  );
}

function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{children}</span>
    </div>
  );
}

/** UTF-8 byte counter (matches the §12.30 byte limit the shared schema enforces). */
function byteCounter(value: string, max: number): string {
  const bytes = new TextEncoder().encode(value).length;
  return `${bytes}/${max} B`;
}

function submitLabel(step: LaunchStep, deployFeeWei: bigint | null, initialBuyWei: bigint): string {
  if (step === "verify-failed") return "Launch blocked — hash mismatch";
  if (isLaunchInFlight(step)) return "Launching…";
  const total = (deployFeeWei ?? 0n) + initialBuyWei;
  if (deployFeeWei === null) return "Launch";
  return `Launch — ${formatEthFromWei(total)} ETH`;
}
