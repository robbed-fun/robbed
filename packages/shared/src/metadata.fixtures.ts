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
 *
 * 2026-07-16: all fixtures were re-derived after adding ERC-1046-compatible
 * metadata fields (`interop.erc1046`, `symbol`, `decimals`, `image`, `icons`,
 * `logoURI`) while preserving ROBBED_'s `ticker`, `imageUrl`, and `imageHash`.
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
      interop: { erc1046: true },
      name: "Cash Cat",
      ticker: "CASHCAT",
      symbol: "CASHCAT",
      decimals: 18,
      imageUrl: "https://cdn.robbed.example/images/0xabc.webp",
      image: "https://cdn.robbed.example/images/0xabc.webp",
      icons: ["https://cdn.robbed.example/images/0xabc.webp"],
      logoURI: "https://cdn.robbed.example/images/0xabc.webp",
      imageHash: `0x${"ab".repeat(32)}`,
    },
    canonical:
      '{"decimals":18,"icons":["https://cdn.robbed.example/images/0xabc.webp"],"image":"https://cdn.robbed.example/images/0xabc.webp","imageHash":"0xabababababababababababababababababababababababababababababababab","imageUrl":"https://cdn.robbed.example/images/0xabc.webp","interop":{"erc1046":true},"logoURI":"https://cdn.robbed.example/images/0xabc.webp","name":"Cash Cat","symbol":"CASHCAT","ticker":"CASHCAT","version":1}',
    hash: "0x52ab301fe59a3a2f75f6f37ba97a71faf4fbb879e4a05b176067ad61a2e057be",
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
      interop: { erc1046: true },
      symbol: "HOOD",
      decimals: 18,
      description: "A token for the hood.",
      imageUrl: "https://cdn.robbed.example/images/0xdef.webp",
      image: "https://cdn.robbed.example/images/0xdef.webp",
      icons: ["https://cdn.robbed.example/images/0xdef.webp"],
      logoURI: "https://cdn.robbed.example/images/0xdef.webp",
    },
    canonical:
      '{"decimals":18,"description":"A token for the hood.","icons":["https://cdn.robbed.example/images/0xdef.webp"],"image":"https://cdn.robbed.example/images/0xdef.webp","imageHash":"0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd","imageUrl":"https://cdn.robbed.example/images/0xdef.webp","interop":{"erc1046":true},"links":{"telegram":"https://t.me/robbed","website":"https://robbed.example","x":"https://x.com/robbed"},"logoURI":"https://cdn.robbed.example/images/0xdef.webp","name":"Hood Token","symbol":"HOOD","ticker":"HOOD","version":1}',
    hash: "0xc34655eab2c3012b3c1b4cdc74a9ee2b7d74c3df029ffdca2c89e246e39d96cf",
  },
  {
    name: "unicode: emoji, accents, CJK, escapes",
    input: {
      version: 1,
      interop: { erc1046: true },
      name: "Ünïcødé 🚀 猫",
      ticker: "ÜNÏ",
      symbol: "ÜNÏ",
      decimals: 18,
      description:
        'emoji 🎉 + accents éàç + CJK 日本語 + "quotes" \\ backslash \n newline \t tab',
      imageUrl: "https://cdn.hoodpad.example/images/0x123.webp",
      image: "https://cdn.hoodpad.example/images/0x123.webp",
      icons: ["https://cdn.hoodpad.example/images/0x123.webp"],
      logoURI: "https://cdn.hoodpad.example/images/0x123.webp",
      imageHash: `0x${"ef".repeat(32)}`,
    },
    canonical:
      '{"decimals":18,"description":"emoji 🎉 + accents éàç + CJK 日本語 + \\"quotes\\" \\\\ backslash \\n newline \\t tab","icons":["https://cdn.hoodpad.example/images/0x123.webp"],"image":"https://cdn.hoodpad.example/images/0x123.webp","imageHash":"0xefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef","imageUrl":"https://cdn.hoodpad.example/images/0x123.webp","interop":{"erc1046":true},"logoURI":"https://cdn.hoodpad.example/images/0x123.webp","name":"Ünïcødé 🚀 猫","symbol":"ÜNÏ","ticker":"ÜNÏ","version":1}',
    hash: "0x06cbe905dbe998fde80f7bdb09529d4ea23c38365de07a482374dd760784e1fa",
  },
  {
    name: "nested links object sorted at depth",
    input: {
      version: 1,
      interop: { erc1046: true },
      name: "Nested",
      ticker: "NEST",
      symbol: "NEST",
      decimals: 18,
      links: { website: "https://a.example", x: "https://b.example" },
      imageUrl: "https://cdn.hoodpad.example/images/0x456.webp",
      image: "https://cdn.hoodpad.example/images/0x456.webp",
      icons: ["https://cdn.hoodpad.example/images/0x456.webp"],
      logoURI: "https://cdn.hoodpad.example/images/0x456.webp",
      imageHash: `0x${"12".repeat(32)}`,
    },
    canonical:
      '{"decimals":18,"icons":["https://cdn.hoodpad.example/images/0x456.webp"],"image":"https://cdn.hoodpad.example/images/0x456.webp","imageHash":"0x1212121212121212121212121212121212121212121212121212121212121212","imageUrl":"https://cdn.hoodpad.example/images/0x456.webp","interop":{"erc1046":true},"links":{"website":"https://a.example","x":"https://b.example"},"logoURI":"https://cdn.hoodpad.example/images/0x456.webp","name":"Nested","symbol":"NEST","ticker":"NEST","version":1}',
    hash: "0x9cb6a7d697b2d8dcb717709d9340083043f27a74684536f946e98d836741e297",
  },
];
