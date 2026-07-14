/**
 * Metadata verification suite (indexer.md, M2-7). Covers the
 * match / mismatch / unfetched verdicts, the backoff + re-verify schedule, the
 * control:reverify seam, and a MUTATION GUARD proving the suite fails if the
 * byte-comparison is stubbed out (never `match` without a real compare).
 *
 * Uses the SHARED golden fixtures — the same bytes/hashes the frontend and API
 * suites reproduce — so the indexer's canonicalizer is proven byte-identical.
 */
import { describe, expect, it } from "bun:test";
import { METADATA_GOLDEN_FIXTURES, canonicalizeMetadata } from "@robbed/shared";
import {
  decideVerification,
  nextAttemptDelayMs,
  resolveMetadataUrl,
  reverifyDelayMs,
  runVerifierPass,
  subscribeReverify,
  verifyOne,
  type DueVerification,
  type FetchResult,
  type MetadataFetcher,
  type MetadataStore,
  type ReverifySubscriber,
  type VerificationWrite,
} from "../src/metadata";
import type { RedisPublisher } from "../src/publish";

const FIX = METADATA_GOLDEN_FIXTURES[0]!; // minimal fixture
const bytesOf = (fixIndex = 0) => canonicalizeMetadata(METADATA_GOLDEN_FIXTURES[fixIndex]!.input);

function capturingPublisher() {
  const messages: Array<{ channel: string; msg: Record<string, unknown> }> = [];
  const publisher: RedisPublisher = {
    async incr() {
      return 1;
    },
    async publish(channel, message) {
      messages.push({ channel, msg: JSON.parse(message) });
    },
  };
  return { publisher, messages };
}

// ── verdict (match / mismatch / unfetched) ──────────────────────────────────

describe("decideVerification — the three verdicts", () => {
  it("match: fetched bytes keccak == on-chain hash (byte-for-byte)", () => {
    const out = decideVerification({ ok: true, bytes: bytesOf(0) }, FIX.hash);
    expect(out.status).toBe("match");
    expect(out.computedHash).toBe(FIX.hash.toLowerCase());
    expect(out.bodySha256).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("mismatch: valid JSON but hash differs from the commitment", () => {
    const wrongHash = `0x${"00".repeat(32)}`;
    const out = decideVerification({ ok: true, bytes: bytesOf(0) }, wrongHash);
    expect(out.status).toBe("mismatch");
    expect(out.computedHash).toBe(FIX.hash.toLowerCase());
  });

  it("mismatch: unparseable body can never equal the commitment", () => {
    const out = decideVerification({ ok: true, bytes: new TextEncoder().encode("{not json") }, FIX.hash);
    expect(out.status).toBe("mismatch");
    expect(out.computedHash).toBeNull();
    expect(out.error).toBe("unparseable_json");
  });

  it("unfetched: fetch failure keeps the row unfetched with the error", () => {
    const out = decideVerification({ ok: false, error: "timeout" }, FIX.hash);
    expect(out.status).toBe("unfetched");
    expect(out.error).toBe("timeout");
    expect(out.computedHash).toBeNull();
  });

  it("MUTATION GUARD: a matching fixture must NOT verdict `match` under a wrong hash", () => {
    // If someone replaced the byte compare with `true`, this would flip to
    // `match` and fail — the guard that proves the compare is load-bearing.
    const out = decideVerification({ ok: true, bytes: bytesOf(1) }, FIX.hash /* wrong for fixture 1 */);
    expect(out.status).toBe("mismatch");
  });
});

// ── display-field extraction (step 5 → offchain sidecar per OI-11) ─

describe("display fields extracted from fetched metadata JSON", () => {
  it("match: display carries imageUrl (+ optional description/links)", () => {
    const out = decideVerification({ ok: true, bytes: bytesOf(0) }, FIX.hash);
    expect(out.display).toEqual({
      imageUrl: "https://cdn.robbed.example/images/0xabc.webp",
      description: null,
      links: null,
    });
  });

  it("full doc: description and links come through", () => {
    const full = METADATA_GOLDEN_FIXTURES[1]!;
    const out = decideVerification({ ok: true, bytes: bytesOf(1) }, full.hash);
    expect(out.status).toBe("match");
    expect(out.display?.imageUrl).toBe("https://cdn.robbed.example/images/0xdef.webp");
    expect(out.display?.description).toBe("A token for the hood.");
    expect(out.display?.links).toEqual({
      x: "https://x.com/robbed",
      website: "https://robbed.example",
      telegram: "https://t.me/robbed",
    });
  });

  it("mismatch STILL extracts display (content shown, badged — step 5)", () => {
    const out = decideVerification({ ok: true, bytes: bytesOf(0) }, `0x${"00".repeat(32)}`);
    expect(out.status).toBe("mismatch");
    expect(out.display?.imageUrl).toBe("https://cdn.robbed.example/images/0xabc.webp");
  });

  it("failed fetch → display null (store must preserve previous values)", () => {
    const out = decideVerification({ ok: false, error: "network" }, FIX.hash);
    expect(out.display).toBeNull();
  });

  it("unparseable body → display null", () => {
    const out = decideVerification({ ok: true, bytes: new TextEncoder().encode("{not json") }, FIX.hash);
    expect(out.display).toBeNull();
  });

  it("valid JSON that is NOT the strict canonical doc → display null (schema gate)", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 99, foo: "bar" }));
    const out = decideVerification({ ok: true, bytes }, FIX.hash);
    expect(out.status).toBe("mismatch"); // verdict is independent of extraction
    expect(out.display).toBeNull();
  });
});

// ── schedule ────────────────────────────────────────────────────────────────

describe("backoff + re-verify cadence", () => {
  it("backoff ladder then daily", () => {
    expect(nextAttemptDelayMs(0)).toBe(60_000);
    expect(nextAttemptDelayMs(1)).toBe(5 * 60_000);
    expect(nextAttemptDelayMs(2)).toBe(30 * 60_000);
    expect(nextAttemptDelayMs(3)).toBe(6 * 60 * 60_000);
    expect(nextAttemptDelayMs(4)).toBe(24 * 60 * 60_000);
    expect(nextAttemptDelayMs(99)).toBe(24 * 60 * 60_000);
  });

  it("settled rows: match=weekly, mismatch=daily, unfetched=backoff", () => {
    expect(reverifyDelayMs("match", 5)).toBe(7 * 24 * 60 * 60_000);
    expect(reverifyDelayMs("mismatch", 5)).toBe(24 * 60 * 60_000);
    expect(reverifyDelayMs("unfetched", 0)).toBe(60_000);
  });
});

describe("resolveMetadataUrl", () => {
  const base = { tokenAddress: "0xabc", onchainHash: "0xhash", attempts: 0 };
  it("prefers the event metadataUri", () => {
    expect(resolveMetadataUrl({ ...base, metadataUri: "https://cdn/x.json" }, "https://r2")).toBe("https://cdn/x.json");
  });
  it("falls back to {R2_BASE}/{hash-no-0x}.json (OI-1; API layout metadata/{keccak-no-0x}.json)", () => {
    // 0x is stripped to match the API's content-addressed object keys
    // (apps/api/src/media/storage.ts stripHashPrefix).
    expect(resolveMetadataUrl({ ...base, metadataUri: null }, "https://r2/")).toBe("https://r2/hash.json");
  });
  it("null when neither available", () => {
    expect(resolveMetadataUrl({ ...base, metadataUri: null }, undefined)).toBeNull();
  });

  // ── dev-only public→internal prefix rewrite (METADATA_FETCH_REWRITE_*) ──
  // The on-chain metadataUri is the BROWSER-visible object URL (host-mapped
  // minio port); inside the indexer container `localhost` is the container
  // itself, so the verifier rewrites the prefix to the minio service DNS.
  const rewrite = { from: "http://localhost:4900/robbed-assets", to: "http://minio:9000/robbed-assets" };
  it("rewrites a matching metadataUri prefix to the container-internal base", () => {
    expect(
      resolveMetadataUrl(
        { ...base, metadataUri: "http://localhost:4900/robbed-assets/metadata/abc.json" },
        undefined,
        rewrite,
      ),
    ).toBe("http://minio:9000/robbed-assets/metadata/abc.json");
  });
  it("leaves non-matching URIs untouched (external hosts keep working)", () => {
    expect(
      resolveMetadataUrl({ ...base, metadataUri: "https://meta.robbed.example/metadata/0xdead.json" }, undefined, rewrite),
    ).toBe("https://meta.robbed.example/metadata/0xdead.json");
  });
  it("does NOT rewrite on a partial path-segment match (prefix must end at a segment)", () => {
    expect(
      resolveMetadataUrl({ ...base, metadataUri: "http://localhost:4900/robbed-assets-evil/x.json" }, undefined, rewrite),
    ).toBe("http://localhost:4900/robbed-assets-evil/x.json");
  });
  it("also rewrites the R2 base fallback and tolerates trailing slashes", () => {
    expect(
      resolveMetadataUrl(
        { ...base, metadataUri: null },
        "http://localhost:4900/robbed-assets/metadata",
        { from: "http://localhost:4900/robbed-assets/", to: "http://minio:9000/robbed-assets/" },
      ),
    ).toBe("http://minio:9000/robbed-assets/metadata/hash.json");
  });
});

// ── driver (verifyOne / runVerifierPass) ────────────────────────────────────

function fakeStore(due: DueVerification[]) {
  const writes: VerificationWrite[] = [];
  const requeued: string[] = [];
  const store: MetadataStore = {
    async selectDue() {
      return due;
    },
    async writeVerification(w) {
      writes.push(w);
    },
    async requeue(t) {
      requeued.push(t);
    },
  };
  return { store, writes, requeued };
}

function fetcherFor(result: FetchResult): MetadataFetcher {
  return { async fetch() { return result; } };
}

describe("verifyOne — persist (sole writer) + publish metadata_verified", () => {
  it("writes the verdict and publishes on token:{addr}:events", async () => {
    const { store, writes } = fakeStore([]);
    const { publisher, messages } = capturingPublisher();
    const due: DueVerification = { tokenAddress: "0xtok", onchainHash: FIX.hash, metadataUri: "https://cdn/x.json", attempts: 0 };
    const out = await verifyOne(due, {
      store,
      fetcher: fetcherFor({ ok: true, bytes: bytesOf(0) }),
      publisher,
      now: () => 1_700_000_000_000,
    });
    expect(out.status).toBe("match");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.attempts).toBe(1); // attempts incremented
    const ev = messages.find((m) => m.msg.type === "metadata_verified");
    expect(ev?.channel).toBe("token:0xtok:events");
    expect((ev?.msg.data as { status: string }).status).toBe("match");
  });

  it("no URL → unfetched write (never crashes)", async () => {
    const { store, writes } = fakeStore([]);
    const { publisher } = capturingPublisher();
    const due: DueVerification = { tokenAddress: "0xtok", onchainHash: FIX.hash, metadataUri: null, attempts: 3 };
    const out = await verifyOne(due, { store, fetcher: fetcherFor({ ok: false, error: "unused" }), publisher, r2BaseUrl: undefined });
    expect(out.status).toBe("unfetched");
    expect(writes[0]!.outcome.error).toBe("no_url");
  });

  it("runVerifierPass verifies every due row", async () => {
    const due: DueVerification[] = [
      { tokenAddress: "0xa", onchainHash: FIX.hash, metadataUri: "u", attempts: 0 },
      { tokenAddress: "0xb", onchainHash: FIX.hash, metadataUri: "u", attempts: 0 },
    ];
    const { store, writes } = fakeStore(due);
    const { publisher } = capturingPublisher();
    await runVerifierPass({ store, fetcher: fetcherFor({ ok: true, bytes: bytesOf(0) }), publisher });
    expect(writes.map((w) => w.tokenAddress).sort()).toEqual(["0xa", "0xb"]);
  });
});

describe("control:reverify seam (X-9)", () => {
  it("re-queues the row on a valid control message; drops junk", async () => {
    const { store, requeued } = fakeStore([]);
    let handler: ((m: string) => void) | null = null;
    const subscriber: ReverifySubscriber = {
      async subscribe(_ch, h) {
        handler = h;
      },
    };
    await subscribeReverify("control:reverify", subscriber, { store });
    expect(handler).not.toBeNull();

    handler!(JSON.stringify({ token: "0x" + "ab".repeat(20) }));
    handler!("not json");
    handler!(JSON.stringify({ nope: 1 }));
    await new Promise((r) => setTimeout(r, 5));

    expect(requeued).toEqual(["0x" + "ab".repeat(20)]); // lowercased, junk ignored
  });
});
