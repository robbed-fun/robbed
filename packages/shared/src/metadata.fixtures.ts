/**
 * Golden fixtures for canonical metadata JSON (api.md "metadata.ts …
 * + golden fixtures"; indexer.md "shared fixtures (also used by frontend
 * tests)").
 *
 * These values are FROZEN. `canonical` is the exact canonical JSON text and
 * `hash` the keccak256 of its UTF-8 bytes (cross-checked against
 * @noble/hashes keccak_256 and the keccak256("") known vector at freeze time,
 * 2026-07-09). Frontend (pre-sign verify), API (canonicalize+hash), and
 * indexer (verification) test suites must all reproduce them byte-for-byte.
 *
 * 2026-07-14: fixtures #1/#2 (`minimal`, `full`) had their `input` rebranded
 * hoodpad.example → robbed.example; `canonical`+`hash` were re-derived from the
 * current inputs by running the real `canonicalizeJson`/`metadataHash` (never
 * hand-computed) so the golden stays authoritative. #3/#4 were unchanged.
 */
import type { JsonValue } from "./metadata";

export interface MetadataGoldenFixture {
  name: string;
  /** Input object — key order intentionally varied; canonicalization must not care. */
  input: JsonValue;
  /** Expected canonical JSON text (UTF-8 encode for the canonical bytes). */
  canonical: string;
  /** Expected keccak256 of the canonical bytes — the on-chain commitment. */
  hash: `0x${string}`;
}

export const METADATA_GOLDEN_FIXTURES: MetadataGoldenFixture[] = [
  {
    name: "minimal (required fields only)",
    input: {
      version: 1,
      name: "Cash Cat",
      ticker: "CASHCAT",
      imageUrl: "https://cdn.robbed.example/images/0xabc.webp",
      imageHash: `0x${"ab".repeat(32)}`,
    },
    canonical:
      '{"imageHash":"0xabababababababababababababababababababababababababababababababab","imageUrl":"https://cdn.robbed.example/images/0xabc.webp","name":"Cash Cat","ticker":"CASHCAT","version":1}',
    hash: "0xd57df531ab5d079e27ab3a29ef6d090a8ea8b645fbe27bdef12648ec085856e1",
  },
  {
    name: "full field set, keys deliberately out of order",
    input: {
      imageHash: `0x${"cd".repeat(32)}`,
      ticker: "HOOD",
      links: {
        x: "https://x.com/robbed",
        website: "https://robbed.example",
        telegram: "https://t.me/robbed",
      },
      name: "Hood Token",
      version: 1,
      description: "A token for the hood.",
      imageUrl: "https://cdn.robbed.example/images/0xdef.webp",
    },
    canonical:
      '{"description":"A token for the hood.","imageHash":"0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd","imageUrl":"https://cdn.robbed.example/images/0xdef.webp","links":{"telegram":"https://t.me/robbed","website":"https://robbed.example","x":"https://x.com/robbed"},"name":"Hood Token","ticker":"HOOD","version":1}',
    hash: "0x8da09247187d32bc765e9e63577b23b736edc43957a35db24a69fd56cac46be6",
  },
  {
    name: "unicode: emoji, accents, CJK, escapes",
    input: {
      version: 1,
      name: "Ünïcødé 🚀 猫",
      ticker: "ÜNÏ",
      description:
        'emoji 🎉 + accents éàç + CJK 日本語 + "quotes" \\ backslash \n newline \t tab',
      imageUrl: "https://cdn.hoodpad.example/images/0x123.webp",
      imageHash: `0x${"ef".repeat(32)}`,
    },
    canonical:
      '{"description":"emoji 🎉 + accents éàç + CJK 日本語 + \\"quotes\\" \\\\ backslash \\n newline \\t tab","imageHash":"0xefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef","imageUrl":"https://cdn.hoodpad.example/images/0x123.webp","name":"Ünïcødé 🚀 猫","ticker":"ÜNÏ","version":1}',
    hash: "0x50ab122c83178f1998adfbcc8fe610b170a477613cc7de0cc813871bb54b992e",
  },
  {
    name: "nested links object sorted at depth",
    input: {
      version: 1,
      name: "Nested",
      ticker: "NEST",
      links: { website: "https://a.example", x: "https://b.example" },
      imageUrl: "https://cdn.hoodpad.example/images/0x456.webp",
      imageHash: `0x${"12".repeat(32)}`,
    },
    canonical:
      '{"imageHash":"0x1212121212121212121212121212121212121212121212121212121212121212","imageUrl":"https://cdn.hoodpad.example/images/0x456.webp","links":{"website":"https://a.example","x":"https://b.example"},"name":"Nested","ticker":"NEST","version":1}',
    hash: "0xa4660ab845764f74bb9a45d6194cd06261142becfb02ec6601b35c4a9af94726",
  },
];
