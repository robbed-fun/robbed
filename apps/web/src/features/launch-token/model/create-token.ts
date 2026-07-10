/**
 * Pure builder for the single `Router.createToken` write (§5.3, contracts.md
 * §2.4). Kept side-effect-free so the wiring — argument ORDER and the
 * `value: deployFee + initialBuy` composition — is unit-testable without a wallet
 * (tests/launch-validation.test.ts). The ABI is the shared generated `routerAbi`;
 * no ABI is hand-written (CLAUDE.md anti-drift rule).
 */
import { routerAbi } from "@robbed/shared/abi";
import type { Address } from "viem";

export interface CreateTokenArgs {
  router: Address;
  name: string;
  symbol: string;
  metadataHash: `0x${string}`;
  metadataUri: string;
  /** Slippage floor for the atomic initial buy (see note below). */
  minTokensOut: bigint;
  /** Absolute unix-seconds deadline, recomputed at submit time. */
  deadline: bigint;
  /** Live-read creation fee, wei (never a constant — read from factory config). */
  deployFeeWei: bigint;
  /** Optional atomic initial creator buy, wei (0 = none). */
  initialBuyWei: bigint;
}

export interface CreateTokenRequest {
  address: Address;
  abi: typeof routerAbi;
  functionName: "createToken";
  args: readonly [string, string, `0x${string}`, string, bigint, bigint];
  value: bigint;
}

/**
 * `createToken(name, symbol, metadataHash, metadataUri, minTokensOut, deadline)`
 * payable with `value = deployFee + initialBuy`. The initial buy is ATOMIC with
 * creation — a single user-visible transaction (spec §5.3).
 */
export function buildCreateTokenRequest(a: CreateTokenArgs): CreateTokenRequest {
  return {
    address: a.router,
    abi: routerAbi,
    functionName: "createToken",
    args: [a.name, a.symbol, a.metadataHash, a.metadataUri, a.minTokensOut, a.deadline] as const,
    value: a.deployFeeWei + a.initialBuyWei,
  };
}
