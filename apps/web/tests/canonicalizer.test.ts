import { describe, expect, it } from "vitest";

import {
  METADATA_GOLDEN_FIXTURES,
  canonicalizeMetadata,
  metadataHash,
} from "@robbed/shared";
import { buildMetadataDocument } from "@/features/launch-token";

/**
 * — the Launch flow must produce BYTE-IDENTICAL canonical JSON and
 * keccak256 to the API + indexer. Proven against the SHARED golden fixtures (the
 * same frozen vectors the indexer/API suites use), through the SHARED
 * canonicalizer — the frontend never re-implements it. If this drifts, the
 * client-side re-verify would false-reject or false-accept, so this is
 * the anti-drift anchor for the whole launch flow.
 */
describe("canonicalizer parity vs shared golden fixtures ", () => {
  for (const fixture of METADATA_GOLDEN_FIXTURES) {
    it(`byte-identical canonical JSON + keccak — ${fixture.name}`, () => {
      const canonical = new TextDecoder("utf-8").decode(canonicalizeMetadata(fixture.input));
      expect(canonical).toBe(fixture.canonical);
      expect(metadataHash(fixture.input)).toBe(fixture.hash);
    });
  }

  it("buildMetadataDocument reproduces the frozen minimal-fixture hash", () => {
    // Same field values as the "minimal" golden fixture — the document builder
    // (with the shared version tag) must land on the same on-chain commitment.
    const doc = buildMetadataDocument({
      name: "Cash Cat",
      ticker: "CASHCAT",
      imageUrl: "https://cdn.robbed.example/images/0xabc.webp",
      imageHash: `0x${"ab".repeat(32)}`,
    });
    const minimal = METADATA_GOLDEN_FIXTURES.find((f) => f.name.startsWith("minimal"))!;
    expect(new TextDecoder().decode(canonicalizeMetadata(doc))).toBe(minimal.canonical);
    expect(metadataHash(doc)).toBe(minimal.hash);
  });

  it("key order in the built document does not change the hash", () => {
    const a = buildMetadataDocument({
      name: "Hood Token",
      ticker: "HOOD",
      description: "A token for the hood.",
      links: {
        x: "https://x.com/robbed",
        website: "https://robbed.example",
        telegram: "https://t.me/robbed",
      },
      imageUrl: "https://cdn.robbed.example/images/0xdef.webp",
      imageHash: `0x${"cd".repeat(32)}`,
    });
    const full = METADATA_GOLDEN_FIXTURES.find((f) => f.name.startsWith("full"))!;
    expect(metadataHash(a)).toBe(full.hash);
  });
});
