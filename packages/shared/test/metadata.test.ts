/**
 * Canonicalization + hash unit tests (indexer.md; api.md).
 * Dual computation (client pre-sign / indexer verify) is normative —
 * these fixtures are the shared golden set.
 */
import { describe, expect, it } from "bun:test";
import { keccak256 } from "viem";
import {
  canonicalizeJson,
  canonicalizeMetadata,
  hashFetchedMetadataBytes,
  metadataHash,
  tokenMetadataSchema,
  type JsonValue,
} from "../src/metadata";
import { METADATA_GOLDEN_FIXTURES } from "../src/metadata.fixtures";

const IMAGE_HASH = `0x${"ab".repeat(32)}`;
const baseMeta = {
  version: 1,
  name: "Cash Cat",
  ticker: "CASHCAT",
  imageUrl: "https://cdn.robbed.example/images/0xabc.webp",
  imageHash: IMAGE_HASH,
} as const;

describe("golden fixtures (frozen; shared with api/indexer/web suites)", () => {
  for (const f of METADATA_GOLDEN_FIXTURES) {
    it(`canonical text + keccak256: ${f.name}`, () => {
      expect(canonicalizeJson(f.input)).toBe(f.canonical);
      expect(new TextDecoder().decode(canonicalizeMetadata(f.input))).toBe(f.canonical);
      expect(metadataHash(f.input)).toBe(f.hash);
      // hash is keccak256 of exactly the canonical UTF-8 bytes
      expect(keccak256(new TextEncoder().encode(f.canonical))).toBe(f.hash);
    });
  }
});

describe("key ordering (RFC 8785-style, UTF-16 code units)", () => {
  it("is independent of input key order", () => {
    const a = { version: 1, name: "X", ticker: "X", imageUrl: "https://a.example/i", imageHash: IMAGE_HASH };
    const b = { imageHash: IMAGE_HASH, imageUrl: "https://a.example/i", ticker: "X", name: "X", version: 1 };
    expect(canonicalizeMetadata(a)).toEqual(canonicalizeMetadata(b));
    expect(metadataHash(a)).toBe(metadataHash(b));
  });

  it("sorts keys at every nesting depth", () => {
    const out = canonicalizeJson({ b: { z: 1, a: 2 }, a: { y: [{ d: 1, c: 2 }] } });
    expect(out).toBe('{"a":{"y":[{"c":2,"d":1}]},"b":{"a":2,"z":1}}');
  });

  it("sorts by UTF-16 code units (surrogates after BMP ASCII/latin)", () => {
    // code units: a(0x61) < z(0x7A) < é(0xE9) < 😀(lead surrogate 0xD83D)
    const out = canonicalizeJson({ "😀": 1, "é": 2, z: 3, a: 4 });
    expect(out).toBe('{"a":4,"z":3,"é":2,"😀":1}');
  });
});

describe("unicode & string escaping", () => {
  it("passes non-ASCII through unescaped, escapes controls/quotes/backslash", () => {
    const out = canonicalizeJson({ s: 'é🎉日本語 "q" \\ \n \t ' });
    expect(out).toBe('{"s":"é🎉日本語 \\"q\\" \\\\ \\n \\t \\u0001"}');
  });

  it("encodes to UTF-8 bytes", () => {
    const bytes = canonicalizeMetadata({ s: "é" });
    // {"s":"é"} — é is 0xC3 0xA9 in UTF-8
    expect(Array.from(bytes)).toEqual([
      0x7b, 0x22, 0x73, 0x22, 0x3a, 0x22, 0xc3, 0xa9, 0x22, 0x7d,
    ]);
  });
});

describe("numbers & invalid values", () => {
  it("uses ECMAScript number serialization", () => {
    expect(canonicalizeJson({ n: 1 })).toBe('{"n":1}');
    expect(canonicalizeJson({ n: 1.5 })).toBe('{"n":1.5}');
    expect(canonicalizeJson({ n: -0 })).toBe('{"n":0}');
    expect(canonicalizeJson({ n: 1e21 })).toBe('{"n":1e+21}');
  });

  it("throws on non-finite numbers and bigints", () => {
    expect(() => canonicalizeJson({ n: NaN })).toThrow(TypeError);
    expect(() => canonicalizeJson({ n: Infinity })).toThrow(TypeError);
    expect(() => canonicalizeJson({ n: 1n } as unknown as JsonValue)).toThrow(TypeError);
  });

  it("drops undefined object properties (JSON.stringify parity), throws in arrays", () => {
    expect(canonicalizeJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalizeJson({ a: 1, b: undefined })).toBe(canonicalizeJson({ a: 1 }));
    expect(() => canonicalizeJson({ a: [1, undefined] } as unknown as JsonValue)).toThrow(TypeError);
  });

  it("preserves array order (arrays are not sorted)", () => {
    expect(canonicalizeJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });
});

describe("image-hash field (image integrity rides inside the JSON)", () => {
  it("imageHash participates in the commitment — changing it changes the hash", () => {
    const h1 = metadataHash({ ...baseMeta });
    const h2 = metadataHash({ ...baseMeta, imageHash: `0x${"cd".repeat(32)}` });
    expect(h1).not.toBe(h2);
  });
});

describe("re-verification path (indexer.md : fetch → parse → canonicalize → keccak)", () => {
  it("round-trips: parse(canonical) re-canonicalizes to identical bytes and hash", () => {
    for (const f of METADATA_GOLDEN_FIXTURES) {
      const refetched = JSON.parse(f.canonical) as JsonValue;
      expect(canonicalizeJson(refetched)).toBe(f.canonical);
      expect(metadataHash(refetched)).toBe(f.hash);
    }
  });

  it("hashFetchedMetadataBytes: pretty-printed / reordered bytes still hash to the commitment", () => {
    const f = METADATA_GOLDEN_FIXTURES[0]!;
    const pretty = new TextEncoder().encode(JSON.stringify(JSON.parse(f.canonical), null, 2));
    expect(hashFetchedMetadataBytes(pretty)).toBe(f.hash);
  });

  it("hashFetchedMetadataBytes: tampered content produces a DIFFERENT hash (mismatch, never match)", () => {
    const f = METADATA_GOLDEN_FIXTURES[0]!;
    const tampered = { ...(JSON.parse(f.canonical) as Record<string, JsonValue>), name: "Evil Cat" };
    expect(hashFetchedMetadataBytes(new TextEncoder().encode(JSON.stringify(tampered)))).not.toBe(f.hash);
  });

  it("hashFetchedMetadataBytes: invalid JSON / invalid UTF-8 → null (stays unfetched/errored)", () => {
    expect(hashFetchedMetadataBytes(new TextEncoder().encode("{not json"))).toBeNull();
    expect(hashFetchedMetadataBytes(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull();
  });
});

describe("tokenMetadataSchema (fixed field set + version tag, api.md)", () => {
  it("accepts every golden fixture input", () => {
    for (const f of METADATA_GOLDEN_FIXTURES) {
      expect(tokenMetadataSchema.safeParse(f.input).success).toBe(true);
    }
  });

  it("rejects unknown keys (field set is part of the commitment)", () => {
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, extra: "nope" }).success).toBe(false);
  });

  it("enforces name ≤32 BYTES / ticker ≤10 BYTES at the boundary", () => {
    // ASCII boundary: 32 bytes ok, 33 bytes rejected (name)
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, name: "x".repeat(32) }).success).toBe(true);
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, name: "x".repeat(33) }).success).toBe(false);
    // ASCII boundary: 10 bytes ok, 11 bytes rejected (ticker)
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, ticker: "y".repeat(10) }).success).toBe(true);
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, ticker: "y".repeat(11) }).success).toBe(false);
    // Non-empty floor
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, name: "" }).success).toBe(false);
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, ticker: "" }).success).toBe(false);
  });

  it("counts BYTES not chars: multibyte under char-limit but over byte-limit rejects", () => {
    // ticker "ÜÜÜÜÜ" = 5 chars / 10 bytes → ok; "ÜÜÜÜÜÜ" = 6 chars / 12 bytes → reject
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, ticker: "Ü".repeat(5) }).success).toBe(true);
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, ticker: "Ü".repeat(6) }).success).toBe(false);
    // name "🚀"×8 = 16 code units / 32 bytes → ok; "🚀"×9 = 18 code units / 36 bytes → reject.
    // A char/code-unit .max(32) would WRONGLY accept both — the byte refinement rejects the 36-byte one.
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, name: "🚀".repeat(8) }).success).toBe(true);
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, name: "🚀".repeat(9) }).success).toBe(false);
  });

  it("enforces description ≤500 (char cap; not on-chain)", () => {
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, description: "x".repeat(501) }).success).toBe(false);
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, description: "x".repeat(500) }).success).toBe(true);
  });

  it("rejects malformed imageHash / imageUrl / links", () => {
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, imageHash: "0x1234" }).success).toBe(false);
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, imageHash: IMAGE_HASH.toUpperCase() }).success).toBe(false);
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, imageUrl: "not-a-url" }).success).toBe(false);
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, links: { website: "nope" } }).success).toBe(false);
  });
});

describe("metadata version frozen at 1 (/ X-13 close-out — negative path)", () => {
  it("rejects version omitted, version:0, version:2 — the literal is a real gate", () => {
    const { version: _v, ...noVersion } = baseMeta;
    expect(tokenMetadataSchema.safeParse(noVersion).success).toBe(false);
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, version: 0 }).success).toBe(false);
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, version: 2 }).success).toBe(false);
  });

  it("accepts version:1 and it still hashes to the frozen golden value (preimage unchanged)", () => {
    expect(tokenMetadataSchema.safeParse({ ...baseMeta, version: 1 }).success).toBe(true);
    const f = METADATA_GOLDEN_FIXTURES[0]!;
    expect(metadataHash(f.input)).toBe(f.hash); // byte-length change did NOT perturb canonicalization
  });
});
