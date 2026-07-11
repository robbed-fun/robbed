/**
 * Metadata integrity verification (indexer.md §6, spec §8.3; M2-7).
 *
 * R2 URLs are mutable; the on-chain `metadataHash` is not. On `TokenCreated`
 * the row is seeded `unfetched` (by the verifier's discovery pass — the verifier
 * is the SOLE writer of `metadata_verifications`, X-9). The verifier then:
 *   1. fetches the canonical JSON (timeout + 64KB cap + content-type sanity);
 *   2. canonicalizes with the SHARED `canonicalizeMetadata` (byte-identical to
 *      the frontend's pre-sign hash and the API's write-time hash — one impl);
 *   3. keccak256s and compares BYTE-FOR-BYTE against the on-chain hash;
 *   4. persists `match` / `mismatch` / `unfetched` (+ both hashes, raw-body
 *      sha256) — NEVER `match` without an actual byte comparison (§6.1 step 4);
 *   5. publishes `metadata_verified` (§6.1 step 7);
 *   6. re-verifies on a schedule (unfetched→backoff, mismatch→daily, match→
 *      weekly — R2 is mutable, the verdict must not be assumed stable, §6.2);
 *   7. subscribes `control:reverify` (X-9) so the admin re-verify seam re-queues
 *      a row WITHOUT the API ever writing this indexer-owned table.
 *
 * The hash rule is imported from `@robbed/shared` (`hashFetchedMetadataBytes`)
 * so there is exactly one canonicalizer across all three services.
 */
import { sha256 } from "viem";
import {
  MAX_METADATA_JSON_BYTES,
  controlReverifySchema,
  hashFetchedMetadataBytes,
  tokenMetadataSchema,
  type MetadataVerificationStatus,
} from "@robbed/shared";
import { publishMetadataVerified, type RedisPublisher } from "./publish";

/** Fetch timeout (§6.1 step 1). */
export const METADATA_FETCH_TIMEOUT_MS = 10_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Exponential backoff for `unfetched`/errored rows (§6.1 step 6): 1m, 5m, 30m,
 * 6h, then daily forever (the attempts counter never STOPS the daily retry).
 */
const BACKOFF_LADDER_MS = [1 * MINUTE, 5 * MINUTE, 30 * MINUTE, 6 * HOUR] as const;

/** Delay before the next attempt given how many have already been made. */
export function nextAttemptDelayMs(attempts: number): number {
  if (attempts < 0) attempts = 0;
  return attempts < BACKOFF_LADDER_MS.length ? BACKOFF_LADDER_MS[attempts]! : DAY;
}

/**
 * Re-verify cadence for a SETTLED row (§6.2): a `mismatch` re-checks daily (the
 * R2 object may be corrected to match the immutable hash), a `match` re-checks
 * weekly (detects R2 mutation after the fact), `unfetched` falls back to the
 * attempt backoff (handled by `nextAttemptDelayMs`).
 */
export function reverifyDelayMs(status: MetadataVerificationStatus, attempts: number): number {
  switch (status) {
    case "match":
      return WEEK;
    case "mismatch":
      return DAY;
    case "unfetched":
      return nextAttemptDelayMs(attempts);
  }
}

// ── Fetch boundary (injectable — fake in tests) ─────────────────────────────

export type FetchResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string };

export interface MetadataFetcher {
  fetch(url: string): Promise<FetchResult>;
}

/**
 * Real HTTP fetcher: timeout via `AbortController`, hard 64KB size cap
 * (content-length pre-check + post-read guard), content-type sanity. Any failure
 * → `{ ok:false }` so the row stays `unfetched` and backs off (§6.1 step 6).
 */
export function createHttpMetadataFetcher(
  timeoutMs: number = METADATA_FETCH_TIMEOUT_MS,
  maxBytes: number = MAX_METADATA_JSON_BYTES,
): MetadataFetcher {
  return {
    async fetch(url: string): Promise<FetchResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
        if (!res.ok) return { ok: false, error: `http_${res.status}` };
        const ctype = res.headers.get("content-type") ?? "";
        if (ctype && !/json|text\/plain/i.test(ctype)) {
          return { ok: false, error: `content_type_${ctype.split(";")[0]}` };
        }
        const len = res.headers.get("content-length");
        if (len && Number(len) > maxBytes) return { ok: false, error: "oversized" };
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > maxBytes) return { ok: false, error: "oversized" };
        return { ok: true, bytes: buf };
      } catch (err) {
        const aborted = (err as { name?: string })?.name === "AbortError";
        return { ok: false, error: aborted ? "timeout" : "network" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ── Pure verdict ────────────────────────────────────────────────────────────

/**
 * Display fields extracted from the fetched metadata JSON (indexer.md §6.1
 * step 5, §3.1). Persisted on the OFFCHAIN `metadata_verifications` sidecar —
 * NOT on the Ponder-managed `tokens` table, whose `image_url`/`description`/
 * `links` columns cannot be legally written outside handlers (§7.3 OI-11
 * verdict: external UPDATEs are silently reverted by ponder 0.16.8 cache
 * flushes and forbidden by Ponder's docs). The API projections COALESCE these
 * over the tokens columns at read time (same pattern as the §12.48c
 * confirmation-state read-derivation).
 */
export interface DisplayFields {
  imageUrl: string | null;
  description: string | null;
  links: Record<string, string> | null;
}

export interface VerificationOutcome {
  status: MetadataVerificationStatus;
  computedHash: string | null;
  bodySha256: string | null;
  error: string | null;
  /**
   * Non-null ONLY when the fetch succeeded and the bytes strict-parsed as the
   * shared canonical doc (`tokenMetadataSchema`). Populated on match AND
   * mismatch (content is still shown, badged by the Trust panel — §3.1/§6.1
   * step 5); the store must never let a later FAILED fetch null out previously
   * extracted fields.
   */
  display: DisplayFields | null;
}

/**
 * Extract display fields from fetched bytes. Strict-schema gate: a doc that is
 * valid JSON but not the canonical shape yields no display fields (defensive —
 * we only surface strings the shared schema vetted, e.g. `imageUrl` must be a
 * URL). Pure; returns null on any parse/validation failure.
 */
export function extractDisplayFields(bytes: Uint8Array): DisplayFields | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  const doc = tokenMetadataSchema.safeParse(parsed);
  if (!doc.success) return null;
  const links = doc.data.links
    ? Object.fromEntries(Object.entries(doc.data.links).filter(([, v]) => v != null) as [string, string][])
    : null;
  return {
    imageUrl: doc.data.imageUrl,
    description: doc.data.description ?? null,
    links: links && Object.keys(links).length > 0 ? links : null,
  };
}

/**
 * Decide the verdict from a fetch result + the on-chain commitment. The ONLY
 * path to `match` is the explicit byte-for-byte hash equality on line marked
 * below — a fetch/parse success is NEVER a match (§6.1 step 4; the mutation-
 * guard test replaces this compare and asserts the suite fails).
 */
export function decideVerification(fetchResult: FetchResult, onchainHash: string): VerificationOutcome {
  if (!fetchResult.ok) {
    return { status: "unfetched", computedHash: null, bodySha256: null, error: fetchResult.error, display: null };
  }
  const bodySha256 = sha256(fetchResult.bytes);
  const display = extractDisplayFields(fetchResult.bytes);
  const computed = hashFetchedMetadataBytes(fetchResult.bytes); // canonicalize + keccak256 (shared)
  if (computed === null) {
    // Fetched bytes are not valid canonical JSON → they cannot equal the
    // commitment (which is keccak256 of canonical JSON). Genuine mismatch.
    return { status: "mismatch", computedHash: null, bodySha256, error: "unparseable_json", display };
  }
  // ── THE byte-level comparison — the sole gate to `match` (§6.1 step 4). ──
  const matches = computed.toLowerCase() === onchainHash.toLowerCase();
  return {
    status: matches ? "match" : "mismatch",
    computedHash: computed.toLowerCase(),
    bodySha256,
    error: null,
    display,
  };
}

// ── Runtime driver (injectable — the match/mismatch/unfetched suite) ─────────

/** A row the verifier must (re)check. */
export interface DueVerification {
  tokenAddress: string;
  onchainHash: string;
  metadataUri: string | null;
  attempts: number;
}

/** The write the verifier persists (sole writer of `metadata_verifications`). */
export interface VerificationWrite {
  tokenAddress: string;
  onchainHash: string;
  outcome: VerificationOutcome;
  attempts: number;
  nowIso: string;
}

/** Persistence boundary (Pg impl elsewhere; fake in tests). */
export interface MetadataStore {
  /** Rows due for (re)verification — includes UNSEEDED tokens (LEFT JOIN). */
  selectDue(nowMs: number, limit: number): Promise<DueVerification[]>;
  /** Upsert the verdict — the ONE writer of this table (X-9). */
  writeVerification(write: VerificationWrite): Promise<void>;
  /** Re-queue a row for immediate re-verify (control:reverify seam, X-9). */
  requeue(tokenAddress: string): Promise<void>;
}

/**
 * Dev-only fetch-URL rewrite (METADATA_FETCH_REWRITE_FROM/_TO). The on-chain
 * `metadataUri` is the BROWSER-visible object URL (dev: the host-mapped minio
 * port, `http://localhost:4900/...`) which is unreachable from inside the
 * indexer container — `localhost` there is the container itself. The standard
 * S3/minio split (public base URL for stored links, internal service-DNS
 * endpoint for in-cluster fetches) is applied here as a prefix rewrite:
 * `from` = the public base, `to` = the container-reachable base
 * (`http://minio:9000/...`). Both unset in production (the CDN base is
 * reachable from everywhere) → no-op. Never changes what is STORED or
 * published — only where the verifier fetches from.
 */
export interface FetchUrlRewrite {
  from: string;
  to: string;
}

/**
 * Build the canonical fetch URL: prefer the event's `metadataUri`; fall back to
 * `{R2_METADATA_BASE_URL}/{hash-without-0x}.json` when the event carried none
 * (OI-1) — the `0x` prefix is stripped to match the API's content-addressed
 * object layout (`metadata/{keccak-no-0x}.json`, apps/api/src/media/storage.ts).
 * Returns `null` when neither is available (row stays unfetched).
 */
export function resolveMetadataUrl(
  due: DueVerification,
  r2BaseUrl: string | undefined,
  rewrite?: FetchUrlRewrite,
): string | null {
  let url: string | null = null;
  if (due.metadataUri && due.metadataUri.length > 0) {
    url = due.metadataUri;
  } else if (r2BaseUrl) {
    const key = due.onchainHash.startsWith("0x") ? due.onchainHash.slice(2) : due.onchainHash;
    url = `${r2BaseUrl.replace(/\/$/, "")}/${key}.json`;
  }
  if (url && rewrite) {
    const from = rewrite.from.replace(/\/$/, "");
    const to = rewrite.to.replace(/\/$/, "");
    if (url === from || url.startsWith(`${from}/`)) url = `${to}${url.slice(from.length)}`;
  }
  return url;
}

export interface VerifierDeps {
  store: MetadataStore;
  fetcher: MetadataFetcher;
  publisher: RedisPublisher;
  r2BaseUrl?: string;
  /** Dev-only public→internal fetch-URL prefix rewrite (see FetchUrlRewrite). */
  urlRewrite?: FetchUrlRewrite;
  now?: () => number;
  logger?: Pick<Console, "error" | "warn">;
}

/** Verify one due row: fetch → decide → persist → publish. Never throws up. */
export async function verifyOne(due: DueVerification, deps: VerifierDeps): Promise<VerificationOutcome> {
  const now = deps.now ?? (() => Date.now());
  const url = resolveMetadataUrl(due, deps.r2BaseUrl, deps.urlRewrite);
  const fetchResult: FetchResult = url
    ? await deps.fetcher.fetch(url)
    : { ok: false, error: "no_url" };
  const outcome = decideVerification(fetchResult, due.onchainHash);
  await deps.store.writeVerification({
    tokenAddress: due.tokenAddress,
    onchainHash: due.onchainHash,
    outcome,
    attempts: due.attempts + 1,
    nowIso: new Date(now()).toISOString(),
  });
  publishMetadataVerified(deps.publisher, due.tokenAddress, outcome.status, Math.floor(now() / 1000));
  return outcome;
}

/** One verifier pass over all currently-due rows. */
export async function runVerifierPass(deps: VerifierDeps, limit = 50): Promise<void> {
  const now = deps.now ?? (() => Date.now());
  const log = deps.logger ?? console;
  try {
    const due = await deps.store.selectDue(now(), limit);
    for (const row of due) {
      try {
        await verifyOne(row, deps);
      } catch (err) {
        log.error(`[metadata verifier] token ${row.tokenAddress} failed:`, err);
      }
    }
  } catch (err) {
    log.error("[metadata verifier] pass failed:", err);
  }
}

/** Subscriber boundary for the `control:reverify` channel (X-9). */
export interface ReverifySubscriber {
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
}

/**
 * Subscribe to `control:reverify` (channel constant + Zod schema from shared).
 * On a valid `{ token }` message, re-queue the row — the indexer stays the sole
 * writer; the API only requests (X-9). Malformed messages are logged + dropped.
 */
export async function subscribeReverify(
  channel: string,
  subscriber: ReverifySubscriber,
  deps: Pick<VerifierDeps, "store" | "logger">,
): Promise<void> {
  const log = deps.logger ?? console;
  await subscriber.subscribe(channel, (message) => {
    void (async () => {
      try {
        const parsed = controlReverifySchema.safeParse(JSON.parse(message));
        if (!parsed.success) {
          log.warn?.("[metadata verifier] bad control:reverify payload:", message);
          return;
        }
        await deps.store.requeue(parsed.data.token.toLowerCase());
      } catch (err) {
        log.error("[metadata verifier] reverify handler failed:", err);
      }
    })();
  });
}

export interface VerifierHandle {
  stop(): void;
}

/** Poll cadence for the verifier pass (independent of the fetch/backoff sched). */
export const VERIFIER_POLL_MS = 30_000;

/** Start the verifier loop + the control:reverify subscription. */
export async function startMetadataVerifier(
  deps: VerifierDeps,
  reverify: { channel: string; subscriber: ReverifySubscriber },
  intervalMs: number = VERIFIER_POLL_MS,
): Promise<VerifierHandle> {
  await subscribeReverify(reverify.channel, reverify.subscriber, deps);
  let running = true;
  const timer = setInterval(() => {
    if (!running) return;
    void runVerifierPass(deps);
  }, intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  return {
    stop() {
      running = false;
      clearInterval(timer);
    },
  };
}
