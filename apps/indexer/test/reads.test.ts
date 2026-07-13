/**
 * Prune-resilient read helper (src/reads.ts) — the single degradation path every
 * historical (event-block) contract read routes through. Verifies:
 *   • `isPrunedStateError` classifies the non-archive "missing trie node" error
 *     class (plain Error, nested cause chain, and a viem BaseError via `.walk`)
 *     and does NOT misclassify a genuine revert.
 *   • `resilientRead` degrades a pruned-state read to `latest`, then to a default,
 *     never throwing — so a single failed read cannot wedge Ponder's backfill.
 *   • On an archive RPC the event-block read succeeds and NO degradation happens.
 */
import { describe, expect, it } from "bun:test";
import { BaseError } from "viem";
import { isPrunedStateError, resilientRead } from "../src/reads";

describe("isPrunedStateError — non-archive pruned-state classification", () => {
  it("matches the geth/erigon 'missing trie node … is not available' text", () => {
    expect(isPrunedStateError(new Error("missing trie node ef2c (path ) state is not available, not found"))).toBe(true);
  });

  it("matches viem InvalidInputRpcError shortMessage / name", () => {
    // viem surfaces the RPC -32000 as InvalidInputRpcError("Missing or invalid parameters").
    expect(isPrunedStateError({ name: "InvalidInputRpcError", shortMessage: "Missing or invalid parameters." })).toBe(true);
    expect(isPrunedStateError(new Error("InvalidInputRpcError: Missing or invalid parameters"))).toBe(true);
  });

  it("finds the marker deep in a nested cause chain", () => {
    // Attach a raw RPC cause the way viem nests transport errors under `.cause`.
    const root = new Error("eth_call failed", {
      cause: { code: -32000, message: "missing trie node 0xabc… is not available" },
    });
    expect(isPrunedStateError(root)).toBe(true);
  });

  it("finds the marker through a viem BaseError .walk() cause chain", () => {
    const inner = new BaseError("underlying RPC error", { details: "missing trie node … is not available" });
    const outer = new BaseError("Contract read reverted", { cause: inner });
    expect(isPrunedStateError(outer)).toBe(true);
  });

  it("does NOT misclassify a genuine revert (v1 curve lacking a fn)", () => {
    // A normal contract revert must stay unclassified so it degrades to the
    // caller's default (0) rather than triggering a needless latest re-read.
    expect(isPrunedStateError(new Error(`The contract function "CREATOR_FEE_BPS" returned no data ("0x").`))).toBe(false);
    expect(isPrunedStateError(new BaseError("execution reverted: insufficient balance"))).toBe(false);
  });

  it("is safe on non-error inputs", () => {
    expect(isPrunedStateError(undefined)).toBe(false);
    expect(isPrunedStateError(null)).toBe(false);
    expect(isPrunedStateError("missing trie node")).toBe(true);
    expect(isPrunedStateError("just a string")).toBe(false);
  });
});

describe("resilientRead — degrade, never throw", () => {
  const PRUNED = () => new Error("missing trie node 0x7cd37 is not available");

  it("archive RPC: returns the event-block value and NEVER touches latest", async () => {
    let latestCalls = 0;
    const v = await resilientRead<bigint>({
      label: "test archive",
      atBlock: async () => 42n,
      atLatest: async () => {
        latestCalls++;
        return 999n;
      },
      fallbackValue: 0n,
    });
    expect(v).toBe(42n);
    expect(latestCalls).toBe(0); // no degradation on an archive node
  });

  it("pruned event block → degrades to the latest read (value-identical)", async () => {
    const modes: string[] = [];
    const v = await resilientRead<bigint>({
      label: "test pruned→latest",
      atBlock: async () => {
        throw PRUNED();
      },
      atLatest: async () => 85n,
      fallbackValue: 0n,
      onDegrade: (mode) => modes.push(mode),
    });
    expect(v).toBe(85n);
    expect(modes).toEqual(["latest"]);
  });

  it("pruned event block AND pruned latest → degrades to the default (no throw)", async () => {
    const modes: string[] = [];
    const v = await resilientRead<number>({
      label: "test pruned→pruned→default",
      atBlock: async () => {
        throw PRUNED();
      },
      atLatest: async () => {
        throw PRUNED();
      },
      fallbackValue: 0,
      onDegrade: (mode) => modes.push(mode),
    });
    expect(v).toBe(0);
    expect(modes).toEqual(["default"]);
  });

  it("non-pruned error (genuine revert) → default, without a latest re-read", async () => {
    let latestCalls = 0;
    const modes: string[] = [];
    const v = await resilientRead<number>({
      label: "test revert→default",
      atBlock: async () => {
        throw new Error(`The contract function "CREATOR_FEE_BPS" returned no data ("0x").`);
      },
      atLatest: async () => {
        latestCalls++;
        return 50;
      },
      fallbackValue: 0,
      onDegrade: (mode) => modes.push(mode),
    });
    expect(v).toBe(0); // v1 curve → 0 is correct; no needless latest read
    expect(latestCalls).toBe(0);
    expect(modes).toEqual(["default"]);
  });

  it("pruned error with NO latest reader → default (no throw)", async () => {
    const v = await resilientRead<bigint>({
      label: "test pruned, no latest",
      atBlock: async () => {
        throw PRUNED();
      },
      fallbackValue: 7n,
    });
    expect(v).toBe(7n);
  });
});
