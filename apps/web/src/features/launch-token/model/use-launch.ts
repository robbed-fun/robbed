"use client";

import { curveFactoryAbi } from "@robbed/shared/abi";
import type { MetadataRequest } from "@robbed/shared";
import { useCallback, useMemo, useState } from "react";
import { type Abi, type Address, BaseError, parseEventLogs } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";

import { type TrackedTrade, useOptimisticTrades } from "@/entities/trade";
import { computeChainDeadline } from "@/entities/curve";
import {
  ApiError,
  getToken,
  postMetadata as postMetadataApi,
  uploadImage as uploadImageApi,
} from "@/shared/api";
import { ROBBED, requireAddress } from "@/shared/config/addresses";

import {
  type BuildMetadataInput,
  buildMetadataDocument,
  buildMetadataRequest,
} from "./build-metadata";
import { buildCreateTokenRequest } from "./create-token";
import { validateImageFile } from "./schema";
import { type LaunchStep } from "./steps";
import { waitForIndexed } from "./index-grace";
import { verifyFailureMessage, verifyMetadataHash } from "./verify-hash";

/**
 * Launch orchestration (§5.3) — the single flow that turns a filled form into a
 * live token:
 *   image upload (eager, API-mediated §12.19) → metadata pin → CLIENT HASH
 *   RE-VERIFY (§12.19 normative) → one `createToken` tx (deployFee + initialBuy)
 *   → optimistic soft-confirmed → index grace → redirect to /t/[address].
 *
 * All network + navigation dependencies are injectable so the flow is
 * deterministic under test.
 *
 * The stepper badge is driven by the `entities/trade` optimistic reducer: the
 * create tx is tracked (submit → attach-hash → receipt) so the SAME confirmation
 * lifecycle the trade feed uses renders here (pending → soft-confirmed), never a
 * bespoke "confirmed" claim. The per-screen store does not cross the redirect; the
 * initial-buy trade is re-derived from WS by the M3-5 feed on the token page.
 */

export interface LaunchSubmitInput {
  name: string;
  ticker: string;
  description?: string;
  links?: MetadataRequest["links"];
  /** Optional atomic initial creator buy, wei (0 = none). */
  initialBuyWei: bigint;
  /**
   * Non-zero slippage floor for the atomic initial buy (§5.3, M3-6): tokensOut ×
   * (1 − slippage), derived by the form from the shared `previewBuy` seeded by the
   * factory's virtual reserves. 0 only when there is no initial buy or the seed
   * reserves aren't readable yet (safe — atomic in `createToken`, no front-run).
   */
  minTokensOut: bigint;
  /** Live-read deploy fee, wei (from `useLaunchEconomics`). */
  deployFeeWei: bigint;
}

export interface ImageState {
  url: string | null;
  hash: string | null;
  fileName: string | null;
  uploading: boolean;
  error: string | null;
}

export interface UseLaunchOptions {
  uploadImageFn?: typeof uploadImageApi;
  postMetadataFn?: typeof postMetadataApi;
  fetchTokenFn?: (address: string) => Promise<unknown>;
  navigate?: (href: string) => void;
}

export interface UseLaunchApi {
  step: LaunchStep;
  error: string | null;
  tokenAddress: Address | null;
  /** The tracked create tx — the stepper badge reads its display state. */
  optimisticTrade: TrackedTrade | null;
  image: ImageState;
  uploadImage: (file: File) => Promise<void>;
  clearImage: () => void;
  launch: (input: LaunchSubmitInput) => Promise<void>;
  reset: () => void;
}

const IMAGE_INIT: ImageState = {
  url: null,
  hash: null,
  fileName: null,
  uploading: false,
  error: null,
};

/**
 * Upper bound on the API-mediated image upload (§12.19). Without it a hung
 * request (e.g. an unreachable/misrouted upload host — the R2-localhost bug)
 * leaves `image.uploading` wedged `true` forever, so the Launch button stays
 * silently disabled with no way to recover. Aborting after this window settles
 * the promise, clears `uploading`, and surfaces a retryable error.
 */
const IMAGE_UPLOAD_TIMEOUT_MS = 30_000;

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");
}

function imageUploadErrorMessage(e: unknown): string {
  if (isAbortError(e)) return "Logo upload timed out — check your connection and try again.";
  if (e instanceof ApiError) return `Logo upload failed: ${e.message}`;
  return "Logo upload failed — try again.";
}

export function useLaunch(opts: UseLaunchOptions = {}): UseLaunchApi {
  const uploadImageFn = opts.uploadImageFn ?? uploadImageApi;
  const postMetadataFn = opts.postMetadataFn ?? postMetadataApi;
  const fetchTokenFn = opts.fetchTokenFn ?? getToken;

  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const optimistic = useOptimisticTrades();

  const [step, setStep] = useState<LaunchStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tokenAddress, setTokenAddress] = useState<Address | null>(null);
  const [image, setImage] = useState<ImageState>(IMAGE_INIT);

  const uploadImage = useCallback(
    async (file: File) => {
      const validationError = validateImageFile(file);
      if (validationError) {
        setImage({ ...IMAGE_INIT, fileName: file.name, error: validationError });
        return;
      }
      setImage({ ...IMAGE_INIT, fileName: file.name, uploading: true });
      setStep((s) => (s === "idle" ? "uploading" : s));
      try {
        // Bound the request so a hung upload can't wedge `uploading` true (STUCK
        // button). On timeout the signal aborts → the promise rejects → the
        // catch clears `uploading` and surfaces a retryable error.
        const res = await uploadImageFn(file, undefined, {
          signal: AbortSignal.timeout(IMAGE_UPLOAD_TIMEOUT_MS),
        });
        setImage({
          url: res.imageUrl,
          hash: res.imageHash,
          fileName: file.name,
          uploading: false,
          error: null,
        });
        setStep((s) => (s === "uploading" ? "idle" : s));
      } catch (e) {
        // IMAGE_INIT.uploading is false — the button always recovers on failure.
        setImage({ ...IMAGE_INIT, fileName: file.name, error: imageUploadErrorMessage(e) });
        setStep((s) => (s === "uploading" ? "idle" : s));
      }
    },
    [uploadImageFn],
  );

  const clearImage = useCallback(() => setImage(IMAGE_INIT), []);

  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    setTokenAddress(null);
  }, []);

  const launch = useCallback(
    async (input: LaunchSubmitInput) => {
      setError(null);
      setTokenAddress(null);

      if (!account) {
        setError("Connect your wallet to launch.");
        return;
      }
      if (!image.url || !image.hash) {
        setError("Upload an image before launching.");
        return;
      }
      let router: Address;
      try {
        router = requireAddress(ROBBED.router, "router");
      } catch (e) {
        setError((e as Error).message);
        return;
      }

      const buildInput: BuildMetadataInput = {
        name: input.name,
        ticker: input.ticker,
        description: input.description,
        links: input.links,
        imageUrl: image.url,
        imageHash: image.hash,
      };

      let optimisticId: string | null = null;
      try {
        // 1. Pin canonical metadata (server canonicalizes + hashes + stores to R2).
        setStep("pinning");
        const request = buildMetadataRequest(buildInput);
        const server = await postMetadataFn(request);

        // 2. §12.19 NORMATIVE — re-verify the server's hash locally BEFORE signing.
        setStep("verifying");
        const document = buildMetadataDocument(buildInput);
        const verified = verifyMetadataHash(document, server);
        if (!verified.ok) {
          setStep("verify-failed");
          setError(verifyFailureMessage(verified.reason!));
          return; // refuse to sign — nothing the user didn't author is committed
        }

        // 3. Single createToken tx (deployFee + optional atomic initial buy).
        setStep("signing");
        // DEADLINE from the CHAIN clock (fresh, right before estimate/write), not
        // the browser clock: a machine clock lagging the chain would otherwise
        // ship an already-expired deadline → the createToken estimate/tx reverts
        // "Deadline expired". Falls back to the browser clock if the read fails.
        const deadline = await computeChainDeadline(publicClient);
        const req = buildCreateTokenRequest({
          router,
          name: input.name,
          symbol: input.ticker,
          metadataHash: verified.localHash, // our OWN verified hash, not the server's
          metadataUri: server.metadataUri,
          minTokensOut: input.minTokensOut,
          deadline,
          deployFeeWei: input.deployFeeWei,
          initialBuyWei: input.initialBuyWei,
        });

        // Feed the optimistic reducer so the stepper renders the shared
        // ConfirmationBadge lifecycle (pending → soft-confirmed).
        optimisticId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `launch-${Date.now()}`;
        optimistic.submit({
          id: optimisticId,
          sender: account,
          token: image.hash, // placeholder identity; real token addr known post-receipt
          isBuy: true,
          ethAmount: input.initialBuyWei.toString(),
          tokenAmount: "0",
        });

        // GAS PRE-ESTIMATE (same ArbOS L1-data-fee quirk as trades, §2/§6.5): on
        // the Robinhood Orbit L2 the WALLET's own gas estimation fails on the L1
        // component ("Network fee unavailable" in MetaMask). The node's
        // `eth_estimateGas` DOES include it, so we estimate against publicClient
        // and pass an explicit `gas` — per viem, passing a gas limit also skips
        // the wallet's estimation. A genuine revert THROWS here and propagates to
        // the catch → humanizeError (decoded reason surfaced), never swallowed.
        const gas = await estimateBufferedGas(publicClient, {
          address: req.address,
          abi: req.abi as Abi,
          functionName: req.functionName,
          args: req.args,
          value: req.value, // deployFee + initialBuy (the total the tx sends)
          account,
        });

        const hash = await writeContractAsync({ ...req, gas });
        optimistic.attachHash(optimisticId, hash);
        setStep("pending");

        const receipt = await publicClient?.waitForTransactionReceipt({ hash });
        optimistic.applyReceipt(
          optimisticId,
          receipt?.status === "success" ? "success" : "reverted",
          receipt?.blockNumber,
        );
        if (receipt?.status !== "success") {
          setStep("error");
          setError("Launch transaction reverted. Your image and metadata are reusable — retry.");
          return;
        }

        // 4. Resolve the new token address from the TokenCreated event.
        const created = parseEventLogs({
          abi: curveFactoryAbi,
          eventName: "TokenCreated",
          logs: receipt.logs,
        });
        const addr = created[0]?.args?.token as Address | undefined;
        if (!addr) {
          setStep("error");
          setError("Could not read the new token address from the receipt.");
          return;
        }
        setTokenAddress(addr);
        setStep("soft-confirmed");

        // 5. Not-yet-indexed grace, then redirect (never to a 404 — see index-grace).
        setStep("indexing");
        const indexed = await waitForIndexed({ address: addr, fetchToken: fetchTokenFn });
        if (indexed) {
          setStep("live");
          (opts.navigate ?? defaultNavigate)(`/t/${addr}`);
        } else {
          setStep("live-unindexed");
        }
      } catch (e) {
        if (optimisticId) optimistic.reject(optimisticId);
        setError(humanizeError(e));
        setStep((s) => (s === "verify-failed" ? s : "error"));
      }
    },
    [account, image, postMetadataFn, fetchTokenFn, publicClient, writeContractAsync, optimistic, opts],
  );

  const optimisticTrade = useMemo(
    () => optimistic.trades[optimistic.trades.length - 1] ?? null,
    [optimistic.trades],
  );

  return {
    step,
    error,
    tokenAddress,
    optimisticTrade,
    image,
    uploadImage,
    clearImage,
    launch,
    reset,
  };
}

function defaultNavigate(href: string): void {
  if (typeof window !== "undefined") window.location.assign(href);
}

type PublicClientT = ReturnType<typeof usePublicClient>;

/** 2× the node estimate — mirrors the deploy's `--skip-simulation` 2× posture. */
const GAS_BUFFER_MULTIPLIER = 2n;
/**
 * Absolute ceiling so a pathological estimate can't set an absurd limit. Higher
 * than the trade path's 5M: `createToken` is heavy (~7.4M gas incl. the one-time
 * V3 pool init), so the buffered estimate legitimately runs to several million.
 */
const GAS_LIMIT_CEILING = 8_000_000n;

interface EstimateGasParams {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  account: Address;
}

/**
 * Node-side gas estimate + buffered explicit limit (mirrors the trade path's
 * helper — kept local because `widgets/*` is ABOVE `features/*` in the FSD layer
 * graph and cannot be imported here). `estimateContractGas` runs the node's
 * `eth_estimateGas` (which DOES include the ArbOS L1-data-fee component the wallet
 * can't estimate), then we return `estimate * 2` capped so the caller passes an
 * explicit `gas` and the wallet skips its own (failing) estimation. A REVERTING
 * call throws here — the caller must let it propagate to `humanizeError`, never
 * swallow it. `undefined` (no publicClient) falls back to wallet estimation.
 */
async function estimateBufferedGas(
  publicClient: PublicClientT,
  params: EstimateGasParams,
): Promise<bigint | undefined> {
  if (!publicClient) return undefined;
  const estimate = await publicClient.estimateContractGas(
    params as Parameters<typeof publicClient.estimateContractGas>[0],
  );
  const buffered = estimate * GAS_BUFFER_MULTIPLIER;
  return buffered > GAS_LIMIT_CEILING ? GAS_LIMIT_CEILING : buffered;
}

function humanizeError(e: unknown): string {
  // A pre-estimate revert surfaces as a viem BaseError; prefer its decoded
  // `shortMessage` (the revert reason) over the verbose full message — the whole
  // point vs MetaMask's opaque "Network fee unavailable".
  const short = e instanceof BaseError ? e.shortMessage : undefined;
  const full = e instanceof Error ? e.message : String(e);
  const probe = `${short ?? ""} ${full}`;
  if (/user rejected|denied|rejected the request/i.test(probe)) {
    return "Transaction rejected in wallet. Your image and metadata are reusable — retry.";
  }
  if (/deadline|expired|transaction too old/i.test(probe)) return "Deadline expired — retry.";
  if (/CreatesPaused/i.test(probe)) return "New launches are temporarily paused.";
  const surfaced = short || full;
  return surfaced.length > 180 ? `${surfaced.slice(0, 177)}…` : surfaced;
}
