/**
 * Canonical metadata JSON — THE shared implementation (,
 * api.md; indexer.md).
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
import { byteBoundedString } from "./text";

// ── Schema (api.md metadata.ts row: ERC-1046 metadata + ROBBED_ fields) ──

/** Optional links, URL-validated (api.md : `links: {website?,x?,telegram?}`). */
export const tokenMetadataLinksSchema = z.strictObject({
  website: z.url().optional(),
  x: z.url().optional(),
  telegram: z.url().optional(),
});
export type TokenMetadataLinks = z.infer<typeof tokenMetadataLinksSchema>;

export const tokenMetadataInteropSchema = z.strictObject({
  erc1046: z.literal(true),
});
export type TokenMetadataInterop = z.infer<typeof tokenMetadataInteropSchema>;

const tokenMetadataBaseShape = {
  version: z.literal(METADATA_VERSION),
  // Byte-length limits — mirror the on-chain gate exactly (text.ts).
  name: byteBoundedString(METADATA_NAME_MAX, "name"),
  ticker: byteBoundedString(METADATA_TICKER_MAX, "ticker"),
  description: z.string().max(METADATA_DESCRIPTION_MAX).optional(),
  links: tokenMetadataLinksSchema.optional(),
  imageUrl: z.url(),
  imageHash: z.string().regex(/^0x[0-9a-f]{64}$/),
} as const;

/**
 * Legacy launchpad metadata shape. Kept accepted so already-launched tokens keep
 * passing indexer display parsing and metadata verification after the ERC-1046
 * extension ships.
 */
export const legacyTokenMetadataSchema = z.strictObject(tokenMetadataBaseShape);

/**
 * The canonical metadata JSON document written for new launches. Strict:
 * unknown keys are rejected — the field set is part of the hash commitment.
 *
 * `imageHash` = keccak256 of the RE-ENCODED image bytes (api.md step 3);
 * image integrity rides inside this JSON, lowercase hex. `imageUrl` remains the
 * ROBBED_ app field. `image`/`icons`/`logoURI` and `interop.erc1046` make the
 * same document suitable for ERC-1046-style explorer/wallet discovery.
 */
export const erc1046TokenMetadataSchema = z.strictObject({
  ...tokenMetadataBaseShape,
  interop: tokenMetadataInteropSchema,
  symbol: byteBoundedString(METADATA_TICKER_MAX, "symbol"),
  decimals: z.literal(18),
  image: z.url(),
  icons: z.array(z.url()).min(1),
  logoURI: z.url(),
});

export const tokenMetadataSchema = z.union([erc1046TokenMetadataSchema, legacyTokenMetadataSchema]);
export type TokenMetadata = z.infer<typeof tokenMetadataSchema>;

export interface BuildTokenMetadataInput {
  name: string;
  ticker: string;
  description?: string;
  links?: TokenMetadataLinks;
  imageUrl: string;
  imageHash: string;
}

export function buildTokenMetadataDocument(input: BuildTokenMetadataInput): TokenMetadata {
  const doc: Record<string, unknown> = {
    version: METADATA_VERSION,
    interop: { erc1046: true },
    name: input.name,
    ticker: input.ticker,
    symbol: input.ticker,
    decimals: 18,
    imageUrl: input.imageUrl,
    image: input.imageUrl,
    icons: [input.imageUrl],
    logoURI: input.imageUrl,
    imageHash: input.imageHash,
  };
  if (input.description !== undefined && input.description !== "") {
    doc.description = input.description;
  }
  if (input.links && Object.values(input.links).some((v) => v)) {
    doc.links = input.links;
  }
  return tokenMetadataSchema.parse(doc);
}

// ── Canonicalization (RFC 8785-style; single implementation) ───

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
      // ECMAScript Number::toString — exactly what JCS (RFC 8785) mandates.
      return JSON.stringify(value);
    case "string":
      // JSON.stringify string escaping matches JCS (RFC 8785):
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
      // Plain object: sort keys by UTF-16 code units (RFC 8785 —
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
 * emitted in `TokenCreated` and stored immutably in LaunchToken.
 */
export function metadataHash(obj: JsonValue): `0x${string}` {
  return keccak256(canonicalizeMetadata(obj));
}

/**
 * Hash raw fetched bytes AS-IS after re-canonicalization (indexer verify path,
 * indexer.md steps 2-3) parse → canonicalize → keccak256. Returns null
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
