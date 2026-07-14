/**
 * Plain-viem `latest` ContractReader — the pruned-state degradation TARGET that
 * the shared `resilientRead` helper (src/reads.ts) re-reads through when an
 * event-block read hits pruned state on a non-archive node. Reached ONLY via
 * that helper (curveReader routes every read through it, so no read path is
 * missed — including the recently-added `CREATOR_FEE_BPS`).
 *
 * Deliberately OUTSIDE Ponder's cached client: Ponder's `context.client` reads
 * at the event block and rejects `blockTag` overrides (ponder.sh docs), and this
 * path is only taken when that deterministic event-block read already failed on a
 * non-archive node. Only ever used for Solidity immutables, where a `latest` read
 * is value-identical (see the decision note in src/reads.ts).
 *
 * Memoized per process; RPC endpoint from the registry-validated config.
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
