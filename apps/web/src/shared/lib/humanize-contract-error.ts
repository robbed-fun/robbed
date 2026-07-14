import { contractAbis } from "@robbed/shared/abi";
import {
  type Abi,
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  formatEther,
} from "viem";

// viem no longer re-exports abitype's `AbiError`; derive it from `Abi`.
type AbiError = Extract<Abi[number], { type: "error" }>;

/**
 * THE central contract-error humanizer for apps/web — the single place every
 * reverted tx (trade, launch, creator-fee claim) is turned into a clear,
 * user-facing message. Replaces the three duplicated `humanizeError` /
 * `humanizeClaimError` copies (use-launch, use-trade-submit, use-claim-creator-fee).
 *
 * ROOT-CAUSE FIX (the `0xc9c00910` leak): errors are decoded by ABI ERROR NAME,
 * never substring-matched, AND — crucially — decoded against a MERGED error ABI
 * covering EVERY robbed contract, not just the one whose function was called.
 *
 * Why the merge is necessary (viem 2.55.0, verified via source
 * `errors/contract.ts` + docs 2026-07-14): `writeContract`/`estimateContractGas`
 * wrap a revert in `ContractFunctionRevertedError`. Its `.data` (`{ errorName,
 * args }`) is populated ONLY when the thrown selector exists in the ABI passed to
 * THAT call. `Router.createToken` nests a `BondingCurve.buy()` call, so a
 * `BondingCurve` error like `EarlyBuyCapExceeded` (`0xc9c00910`) is NOT in the
 * `curveFactory`/`router` ABI → viem leaves `.data` undefined and only fills
 * `.raw` (the raw revert hex) + `.signature`. The old code read `.data.errorName`
 * and so leaked the bare selector. Here we instead decode `.raw` against
 * {@link ALL_ERRORS_ABI} (every contract's error fragments), which resolves the
 * nested selector to its real name + args.
 *
 * DECISION (robbed-frontend): merge CLIENT-SIDE from the already-aggregated
 * `contractAbis` export rather than adding an `allErrorsAbi` to `@robbed/shared`.
 * `packages/shared` is robbed-shared territory (anti-drift rule) and the codegen
 * ABIs are the single source; deriving the merge here consumes that source without
 * redefining a shared shape or hand-listing selectors. If a first-class
 * `allErrorsAbi` is later wanted for the indexer/keeper too, that belongs in a
 * robbed-shared change.
 */

/**
 * Every `type:"error"` fragment from all seven robbed contract ABIs
 * (`LaunchToken, CurveFactory, BondingCurve, Router, V3Migrator, LPFeeVault,
 * CreatorVault` — incl. the OZ `Ownable*` / ERC20 / ERC2612 errors the codegen
 * folds in), deduped by 4-byte selector. Passed to `decodeErrorResult` so a
 * nested revert from ANY contract resolves to its name + args. (`decodeErrorResult`
 * additionally recognises the Solidity built-in `Error(string)` / `Panic(uint256)`
 * on its own, so plain string reverts still decode.)
 */
export const ALL_ERRORS_ABI: readonly AbiError[] = buildAllErrorsAbi();

function buildAllErrorsAbi(): AbiError[] {
  const bySignature = new Map<string, AbiError>();
  for (const abi of Object.values(contractAbis) as readonly Abi[]) {
    for (const item of abi) {
      if (item.type !== "error") continue;
      const sig = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
      if (!bySignature.has(sig)) bySignature.set(sig, item);
    }
  }
  return [...bySignature.values()];
}

export interface HumanizeOptions {
  /**
   * Copy shown when the user rejects/denies the request in their wallet. Sites
   * override to keep their nuance (e.g. launch: image + metadata are reusable).
   */
  rejectionMessage?: string;
  /**
   * Per-error-name message overrides for site-specific wording (e.g. trade wants
   * "refresh the quote" on a deadline). Takes precedence over the default map.
   */
  overrides?: Partial<Record<string, string>>;
}

const DEFAULT_REJECTION = "Transaction rejected in wallet.";
const MAX_LEN = 180;

/**
 * Turn ANY thrown value from a contract interaction into a clear user message.
 *
 * Order: (1) wallet-layer user-rejection — matched ONLY against the concise
 * shortMessage, never the verbose dump; (2) a decoded custom error (viem's own
 * `.data` when it decoded, else our merged-ABI decode of `.raw`) → mapped message
 * (with decoded args where they help); (3) reason-string fallbacks that are NOT
 * custom errors (Uniswap V3's `Too little received` / `Too much requested`
 * require-strings → slippage; the Orbit node's `transaction too old` → deadline);
 * (4) the truncated shortMessage/reason for a non-decodable failure
 * (network / out-of-gas).
 */
export function humanizeContractError(e: unknown, opts: HumanizeOptions = {}): string {
  const short = e instanceof BaseError ? e.shortMessage : undefined;
  const full = e instanceof Error ? e.message : String(e);

  // (1) User rejection is a wallet message, not a decodable revert — match the
  // CONCISE shortMessage only, never the full dump.
  if (/user rejected|denied|rejected the request/i.test(short ?? full)) {
    return opts.rejectionMessage ?? DEFAULT_REJECTION;
  }

  const revert =
    e instanceof BaseError
      ? (e.walk((err) => err instanceof ContractFunctionRevertedError) as
          | ContractFunctionRevertedError
          | null)
      : null;

  // (2) A genuine decoded custom error → mapped message.
  const decoded = revert ? decodeRevert(revert) : null;
  if (decoded) return resolve(decoded.errorName, decoded.args, opts);

  // (3) Reason-string fallbacks for non-custom reverts. `reason` is the decoded
  // Error(string)/Panic reason viem already extracted; short is the concise
  // message. NEVER match the verbose full message (it embeds the fn signature).
  const reason = revert?.reason ?? short ?? "";
  if (/transaction too old/i.test(reason)) return resolve("DeadlineExpired", [], opts);
  if (/too little received|too much requested/i.test(reason)) {
    return resolve("SlippageExceeded", [], opts);
  }

  // (4) Non-decodable failure (network / out-of-gas): surface the concise reason.
  const surfaced = revert?.reason ?? short ?? full;
  return truncate(surfaced);
}

/**
 * The decoded `{ errorName, args }` of a reverted call, or null. Prefers viem's
 * own `.data` (populated when the selector was in the call ABI), else decodes the
 * raw revert hex against the MERGED error ABI — the step that recovers nested
 * errors thrown by a contract other than the one directly called. `Error`/`Panic`
 * are handled as reason strings by the caller, not here.
 */
function decodeRevert(
  revert: ContractFunctionRevertedError,
): { errorName: string; args: readonly unknown[] } | null {
  const name = revert.data?.errorName;
  if (name && name !== "Error" && name !== "Panic") {
    return { errorName: name, args: revert.data?.args ?? [] };
  }
  const raw = revert.raw;
  if (!raw || raw === "0x") return null;
  try {
    const { errorName, args } = decodeErrorResult({ abi: ALL_ERRORS_ABI, data: raw });
    if (!errorName || errorName === "Error" || errorName === "Panic") return null;
    return { errorName, args: (args as readonly unknown[]) ?? [] };
  } catch {
    // Selector not in the merged ABI (unknown/proxy revert) — let the caller fall
    // back to the concise reason string.
    return null;
  }
}

/** override → specific mapped message → generic-but-named internal message. */
function resolve(errorName: string, args: readonly unknown[], opts: HumanizeOptions): string {
  const override = opts.overrides?.[errorName];
  if (override) return override;
  const mapped = MESSAGES[errorName];
  if (mapped) return mapped(args);
  return internalNamed(errorName);
}

/** Short, named message for access-control / internal errors a user shouldn't hit. */
function internalNamed(errorName: string): string {
  return `Unexpected contract error (${errorName}) — please retry or report.`;
}

function truncate(s: string): string {
  return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN - 1)}…` : s;
}

/** First arg as ETH (from wei), via viem `formatEther`; "the current" if absent. */
function ethArg(args: readonly unknown[], index: number): string {
  const v = args[index];
  return typeof v === "bigint" ? `${formatEther(v)} ETH` : "the current";
}

/**
 * errorName → user-facing message. Covers all 36 robbed custom errors + the OZ
 * `OwnableUnauthorizedAccount`, plus a few common ERC20/ERC2612 errors that can
 * surface on a trade. Obeys the lp-copy.md copy rules (no exchange framing, the
 * canonical LP verb, confirmation-tier names untouched). Access-control / internal
 * errors ("should never happen for a normal user") route through
 * {@link internalNamed} for a short named message.
 */
const MESSAGES: Record<string, (args: readonly unknown[]) => string> = {
  // ── actionable trade / launch errors ──────────────────────────────────────
  EarlyBuyCapExceeded: (a) =>
    `Initial buy too large — the anti-snipe cap is ${ethArg(a, 1)} for the first few seconds after launch. Lower your first buy, or buy again shortly after.`,
  SlippageExceeded: () => "Price moved past your slippage — retry, or raise your slippage tolerance.",
  DeadlineExpired: () => "Deadline expired — retry.",
  BuysPaused: () => "Buys are temporarily paused. Selling stays available.",
  CreatesPaused: () => "New launches are temporarily paused.",
  CapExceeded: () => "This buy would push the curve past its current trading cap — try a smaller amount.",
  PerTokenCapExceeded: () => "This buy would exceed this token's current cap — try a smaller amount.",
  ZeroAmount: () => "Enter an amount greater than zero.",
  InvalidMsgValue: () => "The ETH amount doesn't match this transaction — refresh and try again.",
  UnknownToken: () => "This token isn't recognized by the launchpad.",
  NotTrading: () => "This token isn't trading on the curve right now — it may have graduated.",
  NotReady: () => "This token hasn't reached the graduation threshold yet.",
  InvalidName: () => "Token name is invalid — check it and try again.",
  InvalidSymbol: () => "Ticker is invalid — use up to 10 characters.",
  InvalidMetadataUri: () => "Metadata link is invalid — re-upload and try again.",
  ZeroMetadataHash: () => "Metadata is missing — re-upload and try again.",
  GraduationUnfundable: () =>
    "This token can't graduate right now — please retry shortly or report.",
  OwnableUnauthorizedAccount: () => "You're not authorized to perform this action.",

  // ── common ERC20 / ERC2612 (token-side) ───────────────────────────────────
  ERC20InsufficientBalance: () => "Insufficient token balance for this trade.",
  ERC20InsufficientAllowance: () => "Token approval needed — approve the spender, then retry.",
  ERC2612ExpiredSignature: () => "Approval signature expired — retry.",

  // ── admin/config-time guards (a normal user won't hit these) ──────────────
  CapBelowGraduation: () => internalNamed("CapBelowGraduation"),
  FeeAboveCap: () => internalNamed("FeeAboveCap"),
  EarlyWindowTooLong: () => internalNamed("EarlyWindowTooLong"),
  CreatorAlreadyRegistered: () => internalNamed("CreatorAlreadyRegistered"),
  CreatorVaultUnset: () => internalNamed("CreatorVaultUnset"),

  // ── internal / access-control (named, generic) ────────────────────────────
  AlreadyInitialized: () => internalNamed("AlreadyInitialized"),
  ArbBudgetExceeded: () => internalNamed("ArbBudgetExceeded"),
  CurveMathZeroReserve: () => internalNamed("CurveMathZeroReserve"),
  EthTransferFailed: () => internalNamed("EthTransferFailed"),
  InsufficientLiquidityMinted: () => internalNamed("InsufficientLiquidityMinted"),
  PoolPriceUnrecoverable: () => internalNamed("PoolPriceUnrecoverable"),
  NotCurve: () => internalNamed("NotCurve"),
  NotFactory: () => internalNamed("NotFactory"),
  NotLpFeeVault: () => internalNamed("NotLpFeeVault"),
  NotMigrator: () => internalNamed("NotMigrator"),
  NotPool: () => internalNamed("NotPool"),
  NotPositionManager: () => internalNamed("NotPositionManager"),
  NotRouter: () => internalNamed("NotRouter"),
  ZeroAddress: () => internalNamed("ZeroAddress"),
};
