/**
 * viem-backed ChainPort + the on-chain GraduationReady watch.
 *
 * DETECTION DECISION (recorded — this is the plan's "primary detection", resolved
 * as an implementation-approach choice I own):
 *   The plan's first choice was "subscribe to the indexer's Redis pub/sub for the
 *   GraduationReady signal". Inspection of apps/indexer/src/publish.ts +
 *   packages/shared/src/{channels,ws-messages}.ts shows NO channel or WS-message
 *   type carries a curve-locked / GraduationReady signal (the taxonomy is trade /
 *   candle / launch / graduated / confirmations / metadata_verified /
 *   fee_collected). Publishing one would need a NEW `graduation_ready` variant in
 *   the robbed-shared WS discriminated union + channel taxonomy AND a new
 *   `BondingCurve:GraduationReady` handler in the indexer — a cross-service
 *   interface change owned by robbed-shared/architect, not the keeper, and the
 *   plan explicitly says "do NOT invent a new channel".
 *
 *   So the keeper subscribes to the AUTHORITATIVE source — the on-chain
 *   `GraduationReady` event itself — over the same Alchemy WS RPC the spec
 * mandates. This is strictly fewer hops than chain→ponder→redis→keeper,
 *   lower latency, and has zero cross-service coupling. viem
 *   `watchContractEvent({ eventName:'GraduationReady', poll:false })` opens ONE
 *   `eth_subscribe('logs', …)` filtered to the event topic across ALL curves
 *   (no address filter — every BondingCurve emits it); `log.address` is the curve
 *   to graduate. If KEEPER_RPC_URL is http(s) it falls back to `poll:true`
 *   (eth_getLogs polling) and the DB sweep remains the safety net.
 *
 *   REDIS_URL stays a reserved env (compose wires redis for the stack) but
 *   detection does not depend on it. If decoupling the keeper from the RPC via a
 *   Redis readiness fanout is later wanted, it needs the robbed-shared WS-union
 *   addition + indexer handler above — flagged to the architect.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  webSocket,
  type Log,
  type PublicClient,
  type WalletClient,
  type WebSocketTransport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bondingCurveAbi } from "@robbed/shared/abi";
import { isWebSocketUrl } from "./config";
import type { Address, ChainPort, ErrorClass, Hash, Hex, Phase } from "./types";

/** IBondingCurve.Phase (uint8): Trading=0, ReadyToGraduate=1, Graduated=2. */
function decodePhase(raw: number | bigint): Phase {
  switch (Number(raw)) {
    case 0:
      return "trading";
    case 1:
      return "ready";
    case 2:
      return "graduated";
    default:
      return "unknown";
  }
}

export interface ChainClientOptions {
  rpcUrl: string;
  privateKey: Hex;
  chainId: number;
}

export class ChainClient implements ChainPort {
  /** Loose-typed client for reads/estimates/receipts (both ws + http). */
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  /**
   * Subscription-capable client, present ONLY on a WebSocket RPC. Typed with
   * `WebSocketTransport` so viem's `GetPollOptions<transport>` offers the
   * `poll: false` variant (`eth_subscribe`) — the generic `PublicClient`
   * (transport = base `Transport`) collapses `poll` to `true`-only, which is the
   * real cause of TS2322 on the loose client. viem pools the WS socket by URL,
   * so this shares publicClient's underlying connection (no extra socket).
   */
  private readonly subClient: PublicClient<WebSocketTransport> | undefined;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly useWs: boolean;
  readonly chainId: number;

  constructor(opts: ChainClientOptions) {
    this.chainId = opts.chainId;
    this.useWs = isWebSocketUrl(opts.rpcUrl);
    const transport = this.useWs ? webSocket(opts.rpcUrl) : http(opts.rpcUrl);
    const chain = defineChain({
      id: opts.chainId,
      name: `robbed-${opts.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [opts.rpcUrl] } },
    });
    this.account = privateKeyToAccount(opts.privateKey);
    this.publicClient = createPublicClient({ chain, transport });
    this.walletClient = createWalletClient({ account: this.account, chain, transport });
    this.subClient = this.useWs ? createPublicClient({ chain, transport: webSocket(opts.rpcUrl) }) : undefined;
  }

  get walletAddress(): Address {
    return this.account.address.toLowerCase() as Address;
  }

  /** Startup chain-identity assertion (mirrors the indexer fail-closed gate). */
  async getChainId(): Promise<number> {
    return this.publicClient.getChainId();
  }

  async getGasPriceWei(): Promise<bigint> {
    return this.publicClient.getGasPrice();
  }

  async readPhase(curve: Address): Promise<Phase> {
    try {
      const raw = await this.publicClient.readContract({
        address: curve,
        abi: bondingCurveAbi,
        functionName: "phase",
      });
      return decodePhase(raw as number | bigint);
    } catch {
      return "unknown"; // RPC hiccup — keeper treats as retry-later, never terminal
    }
  }

  async estimateGraduateGas(curve: Address): Promise<bigint> {
    return this.publicClient.estimateContractGas({
      address: curve,
      abi: bondingCurveAbi,
      functionName: "graduate",
      account: this.account,
    });
  }

  async sendGraduate(curve: Address, gas: bigint): Promise<Hash> {
    return this.walletClient.writeContract({
      address: curve,
      abi: bondingCurveAbi,
      functionName: "graduate",
      account: this.account,
      chain: this.walletClient.chain,
      gas,
    });
  }

  async waitForReceipt(hash: Hash): Promise<{ status: "success" | "reverted" }> {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return { status: receipt.status };
  }

  async getBalanceWei(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.account.address });
  }

  classifyError(err: unknown): ErrorClass {
    if (err instanceof BaseError) {
      const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) return "contract_revert";
      // A plain execution revert with no decoded custom error still means the
      // node executed and rejected the call deterministically.
      if (/revert|execution reverted/i.test(err.shortMessage ?? err.message)) return "contract_revert";
    }
    return "transient";
  }

  /**
   * Watch `GraduationReady` across all curves. `onCurve` receives the emitting
   * curve address (lowercased). Returns an unwatch fn. `onError` surfaces
   * transport drops (the DB sweep is the backstop while it reconnects).
   */
  watchGraduationReady(onCurve: (curve: Address) => void, onError: (err: unknown) => void): () => void {
    const onLogs = (logs: Log[]) => {
      for (const log of logs) {
        if (log.address) onCurve(log.address.toLowerCase() as Address);
      }
    };
    // ws → eth_subscribe (`poll:false`, valid only on the WebSocketTransport-typed
    // subClient — see the field comment); http → getLogs polling (`poll:true`).
    if (this.subClient) {
      return this.subClient.watchContractEvent({
        abi: bondingCurveAbi,
        eventName: "GraduationReady",
        poll: false,
        onLogs,
        onError,
      });
    }
    return this.publicClient.watchContractEvent({
      abi: bondingCurveAbi,
      eventName: "GraduationReady",
      poll: true,
      onLogs,
      onError,
    });
  }
}
