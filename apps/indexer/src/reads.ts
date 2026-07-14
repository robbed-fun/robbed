/**
 * Prune-resilient contract-read helper — the SINGLE degradation path that every
 * HISTORICAL (event-block) `readContract` in the indexer routes through, so no
 * read path can silently bypass the fallback (curveReader.ts + latestReader.ts
 * both use it). Decision recorded 2026-07-13 per the decide-it-yourself loop.
 *
 * ── The problem it fixes ──────────────────────────────────────────────────────
 * On a NON-ARCHIVE RPC (e.g. the public `rpc.testnet.chain.robinhood.com`) the
 * node prunes historical state after ~40 min. Ponder's `context.client` reads at
 * the EVENT block, so an `eth_call` that reads a curve's immutables at a
 * >40-min-old `TokenCreated` block fails with `missing trie node … is not
 * available` (surfaced by viem as `InvalidInputRpcError` / `RpcRequestError`,
 * shortMessage "Missing or invalid parameters"). When a handler read throws,
 * Ponder retries the handler 9× with backoff and then WEDGES the whole backfill
 * (progress stuck at 0.0%). Observed live during the reindex: selectors
 * `CURVE_SUPPLY()` (0x1e4c7292), `GRADUATION_ETH()` (0xa6f5302b), and
 * `TRADE_FEE_BPS()` (0x9185f598) all returned "missing trie node".
 *
 * ── The degradation ──────────────────────────────────────────────────────────
 * A pruned-state read DEGRADES instead of propagating:
 *   1. retry the SAME call at block tag `latest` — value-identical for Solidity
 *      immutables (constructor-set, embedded in bytecode; `BondingCurve` has no
 *      selfdestruct), and an acceptable non-archive degradation for live reserves;
 *   2. if `latest` also fails — or the original error is NOT a pruned-state error
 *      (e.g. a genuine revert: a v1 curve lacking `CREATOR_FEE_BPS`) — return the
 *      caller's safe default (0 / null) with a WARN log.
 * The helper NEVER throws, so a single failed read can't wedge the backfill
 * (requirement: proceed with the degraded value).
 *
 * ── Archive-RPC correctness ──────────────────────────────────────────────────
 * When an ARCHIVE RPC is configured, the event-block read SUCCEEDS, so the catch
 * is never entered and NO degradation happens — the fallback only triggers on the
 * pruned-state error. The real fix for a production indexer is a real archive RPC;
 * this is the graceful degradation that keeps the non-archive testnet unstuck.
 * Derived tables (candles &c.) are rebuildable from raw events; a later reindex on
 * an archive RPC restores any value that fell all the way through to the default.
 *
 * Verified against viem@2.55.0: `BaseError` exposes `.name` / `.shortMessage` /
 * `.details` / `.message` and a `.walk()` cause-chain traversal (ponder.sh docs
 * confirm `context.client` reads at the event block and rejects `blockTag`
 * overrides, which is why the `latest` reader lives outside Ponder's client).
 */

/**
 * Lowercased substrings that identify a pruned-state / non-archive historical
 * read failure across the error's name, shortMessage, details, message and code.
 * Kept broad on purpose — a false positive only costs one extra `latest` read
 * (which is correct anyway on an archive node), whereas a false negative wedges
 * the backfill. New markers can be appended without touching the traversal.
 */
const PRUNED_STATE_MARKERS = [
  "missing trie node", // geth/erigon pruned-state revert text
  "is not available", // "… state … is not available"
  "invalidinputrpcerror", // viem error class name for -32000 bad-params
  "missing or invalid parameters", // viem InvalidInputRpcError shortMessage
  "header not found", // some clients for a pruned/unknown block
  "state not available",
  "no state available for block",
  "required historical state unavailable",
] as const;

/** Minimal structural view of a thrown error (viem BaseError, plain Error, or a
 *  raw RPC object) — every field is optional and read defensively. */
interface ErrorLike {
  name?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  code?: unknown;
  cause?: unknown;
  walk?: unknown;
}

/** Flatten one error node's identifying text (name/shortMessage/details/message/code). */
function nodeText(e: ErrorLike): string {
  return [e.name, e.shortMessage, e.details, e.message, e.code]
    .filter((x) => x !== undefined && x !== null)
    .map((x) => String(x))
    .join(" ")
    .toLowerCase();
}

/** True when a single error node's text matches any pruned-state marker. */
function nodeMatches(e: unknown): boolean {
  if (typeof e === "string") return PRUNED_STATE_MARKERS.some((m) => e.toLowerCase().includes(m));
  if (!e || typeof e !== "object") return false;
  const hay = nodeText(e as ErrorLike);
  return PRUNED_STATE_MARKERS.some((m) => hay.includes(m));
}

/**
 * Detect the pruned-state / non-archive read error class anywhere in the error's
 * cause chain. Uses viem's `BaseError.walk` when present, then a manual cause
 * walk (covers plain `Error`s and raw RPC objects viem may nest under `.cause`).
 */
export function isPrunedStateError(err: unknown): boolean {
  // viem BaseError: walk() returns the first cause matching the predicate.
  const maybe = err as ErrorLike | null | undefined;
  if (maybe && typeof maybe.walk === "function") {
    const found = (maybe.walk as (fn: (e: unknown) => boolean) => unknown)((e) => nodeMatches(e));
    if (found) return true;
  }
  // Manual cause-chain scan (cycle-guarded) for non-BaseError shapes.
  let cur: unknown = err;
  const seen = new Set<unknown>();
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    if (nodeMatches(cur)) return true;
    cur = (cur as ErrorLike).cause;
  }
  return typeof err === "string" ? nodeMatches(err) : false;
}

/** How a resilient read resolved — surfaced to `onDegrade` for tests/metrics. */
export type ReadDegradation = "latest" | "default";

/** One short line describing an error for a WARN log (no stack spam). */
function short(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as ErrorLike;
    const s = e.shortMessage ?? e.message ?? e.details ?? e.name;
    if (s !== undefined && s !== null) return String(s);
  }
  return String(err);
}

/**
 * Run an event-block contract read, degrading (never throwing) on a pruned-state
 * failure. This is the single helper both readers route through.
 *
 * @param label        human label for the WARN log (e.g. `curve 0x… CURVE_SUPPLY`)
 * @param atBlock      the primary read at the event block (Ponder's cached client)
 * @param atLatest     optional re-read at `latest` (a plain viem client) — the
 *                     value-identical degradation for immutables; omit to skip
 *                     straight to `fallbackValue`
 * @param fallbackValue safe default returned when the read cannot be satisfied
 * @param onDegrade    optional hook (mode, error) for tests/metrics
 */
export async function resilientRead<T>(opts: {
  label: string;
  atBlock: () => Promise<T>;
  atLatest?: () => Promise<T>;
  fallbackValue: T;
  onDegrade?: (mode: ReadDegradation, err: unknown) => void;
}): Promise<T> {
  try {
    // Fast path: on an archive RPC this succeeds and nothing below runs.
    return await opts.atBlock();
  } catch (primaryErr) {
    const pruned = isPrunedStateError(primaryErr);

    // Pruned historical state on a non-archive node → re-read at `latest`.
    if (pruned && opts.atLatest) {
      try {
        const v = await opts.atLatest();
        opts.onDegrade?.("latest", primaryErr);
        console.warn(
          `[reads] ${opts.label}: event-block state pruned (non-archive RPC) — degraded to latest ` +
            `(value-identical for immutables). ${short(primaryErr)}`,
        );
        return v;
      } catch (latestErr) {
        // `latest` also failed → last-resort default. Loud: a reindex on an
        // archive RPC restores the true value (derived data is rebuildable).
        opts.onDegrade?.("default", latestErr);
        console.warn(
          `[reads] ${opts.label}: latest degradation ALSO failed — using default ` +
            `(${String(opts.fallbackValue)}); reindex on an archive RPC to correct. ${short(latestErr)}`,
        );
        return opts.fallbackValue;
      }
    }

    // Non-pruned error (e.g. a genuine revert — a v1 curve lacking the fn) OR a
    // pruned error with no `latest` reader → safe default. NEVER propagate: a
    // single failed read must not wedge Ponder's backfill (retries-and-wedges).
    opts.onDegrade?.("default", primaryErr);
    console.warn(
      `[reads] ${opts.label}: read failed (${pruned ? "pruned, no latest reader" : "non-pruned error"}) — ` +
        `using default (${String(opts.fallbackValue)}). ${short(primaryErr)}`,
    );
    return opts.fallbackValue;
  }
}
