/**
 * Canonical metadata JSON — THE shared implementation (spec §8.3, §12.19;
 * api.md §3.2/§5; indexer.md §6).
 *
 * Dual computation is normative:
 * - the API canonicalizes + hashes before writing `metadata/{hash}.json` to R2;
 * - the client re-verifies the hash with THIS function before signing the tx;
 * - the indexer canonicalizes fetched bytes with THIS function at verify time.
 * Byte-identical by construction because there is exactly one implementation.
 *
 * Canonicalization is RFC 8785 (JCS)-style:
 * - UTF-8 output;
 * - object keys sorted lexicographically by UTF-16 code units at every depth;
 * - no insignificant whitespace;
 * - string/number serialization per ECMAScript JSON.stringify (JCS-compatible:
 *   non-ASCII characters are NOT escaped; numbers use Number::toString);
 * - object properties with `undefined` values are dropped (JSON.stringify
 *   parity); `undefined`/functions/symbols inside arrays, non-finite numbers,
 *   and bigints throw (never silently coerced — determinism over leniency).
 */
import { keccak256 } from "viem";
import { z } from "zod";
import {
  METADATA_DESCRIPTION_MAX,
  METADATA_NAME_MAX,
  METADATA_TICKER_MAX,
  METADATA_VERSION,
} from "./constants";

// ── Schema (api.md §5 metadata.ts row: name/ticker/description/links/imageUrl/imageHash/version) ──

/** Optional links, URL-validated (api.md §3.2: `links: {website?,x?,telegram?}`). */
export const tokenMetadataLinksSchema = z.strictObject({
  website: z.url().optional(),
  x: z.url().optional(),
  telegram: z.url().optional(),
});
export type TokenMetadataLinks = z.infer<typeof tokenMetadataLinksSchema>;

/**
 * The canonical metadata JSON document ("fixed field set + version tag",
 * api.md §3.2 step 1). Strict: unknown keys are rejected — the field set is
 * part of the hash commitment.
 *
 * `imageHash` = keccak256 of the RE-ENCODED image bytes (api.md §3.1 step 3);
 * image integrity rides inside this JSON (spec §8.3), lowercase hex.
 */
export const tokenMetadataSchema = z.strictObject({
  version: z.literal(METADATA_VERSION),
  name: z.string().min(1).max(METADATA_NAME_MAX),
  ticker: z.string().min(1).max(METADATA_TICKER_MAX),
  description: z.string().max(METADATA_DESCRIPTION_MAX).optional(),
  links: tokenMetadataLinksSchema.optional(),
  imageUrl: z.url(),
  imageHash: z.string().regex(/^0x[0-9a-f]{64}$/),
});
export type TokenMetadata = z.infer<typeof tokenMetadataSchema>;

// ── Canonicalization (RFC 8785-style; single implementation, spec §12.19) ───

/** JSON value domain accepted by the canonicalizer. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

function canonicalizeValue(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`Non-finite number at ${path} cannot be canonicalized`);
      }
      // ECMAScript Number::toString — exactly what JCS (RFC 8785 §3.2.2.3) mandates.
      return JSON.stringify(value);
    case "string":
      // JSON.stringify string escaping matches JCS (RFC 8785 §3.2.2.2):
      // two-char escapes where defined, \u00xx for other control chars,
      // non-ASCII passed through unescaped.
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value
          .map((item, i) => {
            if (item === undefined || typeof item === "function" || typeof item === "symbol") {
              throw new TypeError(`Invalid array element at ${path}[${i}]`);
            }
            return canonicalizeValue(item, `${path}[${i}]`);
          })
          .join(",")}]`;
      }
      // Plain object: sort keys by UTF-16 code units (RFC 8785 §3.2.3 —
      // default JS string comparison), drop undefined-valued properties.
      const entries = Object.keys(value as Record<string, unknown>)
        .sort()
        .flatMap((key) => {
          const v = (value as Record<string, unknown>)[key];
          if (v === undefined || typeof v === "function" || typeof v === "symbol") return [];
          return [`${JSON.stringify(key)}:${canonicalizeValue(v, `${path}.${key}`)}`];
        });
      return `{${entries.join(",")}}`;
    }
    default:
      // bigint, undefined, function, symbol at the root/object position
      throw new TypeError(`Value of type ${typeof value} at ${path} cannot be canonicalized`);
  }
}

/** Canonical JSON text (stable key order, no whitespace). */
export function canonicalizeJson(value: JsonValue): string {
  return canonicalizeValue(value, "$");
}

/**
 * Canonical UTF-8 bytes of a metadata object — the exact bytes written to R2
 * by the API and the exact bytes hashed by client + indexer.
 */
export function canonicalizeMetadata(obj: JsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalizeJson(obj));
}

/**
 * keccak256 of the canonical bytes — the on-chain `metadataHash` commitment
 * emitted in `TokenCreated` and stored immutably in LaunchToken (§8.3).
 */
export function metadataHash(obj: JsonValue): `0x${string}` {
  return keccak256(canonicalizeMetadata(obj));
}

/**
 * Hash raw fetched bytes AS-IS after re-canonicalization (indexer verify path,
 * indexer.md §6.1 steps 2-3): parse → canonicalize → keccak256. Returns null
 * if the bytes are not valid JSON (verifier records the error, stays
 * `unfetched`/errored — never `match` without a byte-level comparison).
 */
export function hashFetchedMetadataBytes(bytes: Uint8Array): `0x${string}` | null {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as JsonValue;
  } catch {
    return null;
  }
  return metadataHash(parsed);
}
