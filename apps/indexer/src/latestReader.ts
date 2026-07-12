/**
 * Plain-viem `latest` ContractReader — the pruned-state fallback for
 * `readCurveImmutablesWithFallback` (see the decision note in curveReader.ts).
 * Deliberately OUTSIDE Ponder's cached client: Ponder's `context.client`
 * rejects `blockTag` overrides, and this path is only taken when the
 * deterministic event-block read already failed on a non-archive node. Only
 * ever used for Solidity immutables, where a `latest` read is value-identical.
 *
 * Memoized per process; RPC endpoint from the §12.55 registry-validated config.
 */
import { createPublicClient, http } from "viem";
import { config } from "./runtime";
import type { ContractReader } from "./curveReader";

let cached: ContractReader | null = null;

export function getLatestReader(): ContractReader {
  if (cached) return cached;
  const client = createPublicClient({ transport: http(config.rpcHttp) });
  cached = {
    readContract: ({ abi, address, functionName }) =>
      client.readContract({ abi, address, functionName }),
  };
  return cached;
}
