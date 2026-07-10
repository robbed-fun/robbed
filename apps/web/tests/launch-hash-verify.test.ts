import { describe, expect, it } from "vitest";

import { canonicalizeMetadata, metadataHash } from "@robbed/shared";
import {
  buildMetadataDocument,
  verifyFailureMessage,
  verifyMetadataHash,
} from "@/features/launch-token";

/**
 * §12.19 NORMATIVE — the client re-verifies the API's metadata hash with the
 * SHARED canonicalizer BEFORE signing, and REFUSES to sign on any mismatch. These
 * prove the guard both accepts a correct server result and BLOCKS a tampered one
 * (hash OR canonical bytes) — a buggy/malicious server can never commit the user
 * to metadata they didn't author.
 */

const input = {
  name: "Cash Cat",
  ticker: "CASHCAT",
  description: "meow",
  imageUrl: "https://cdn.hoodpad.example/images/0xabc.webp",
  imageHash: `0x${"ab".repeat(32)}`,
} as const;

function honestServerResult(document: Parameters<typeof metadataHash>[0]) {
  return {
    metadataHash: metadataHash(document),
    canonicalJson: new TextDecoder().decode(canonicalizeMetadata(document)),
  };
}

describe("client hash re-verification (§12.19)", () => {
  it("accepts a correct server result → ok, localHash present", () => {
    const doc = buildMetadataDocument(input);
    const result = verifyMetadataHash(doc, honestServerResult(doc));
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.localHash).toBe(metadataHash(doc));
  });

  it("BLOCKS a tampered metadataHash → not ok, hash_mismatch", () => {
    const doc = buildMetadataDocument(input);
    const server = honestServerResult(doc);
    const result = verifyMetadataHash(doc, {
      ...server,
      metadataHash: `0x${"00".repeat(32)}`,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("hash_mismatch");
    expect(verifyFailureMessage(result.reason!)).toMatch(/blocked/i);
  });

  it("BLOCKS tampered canonical bytes → not ok, canonical_mismatch (checked first)", () => {
    const doc = buildMetadataDocument(input);
    const server = honestServerResult(doc);
    const result = verifyMetadataHash(doc, {
      ...server,
      canonicalJson: server.canonicalJson.replace("Cash Cat", "Evil Cat"),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("canonical_mismatch");
  });

  it("the hash the client would sign is its OWN, not the server's", () => {
    // Even when the server lies about the hash, the guard blocks — but if it were
    // to proceed, the localHash (derived from the client's own document) is what
    // matters. Confirm it is independent of the server field.
    const doc = buildMetadataDocument(input);
    const result = verifyMetadataHash(doc, {
      metadataHash: `0x${"ff".repeat(32)}`,
      canonicalJson: "not even json",
    });
    expect(result.ok).toBe(false);
    expect(result.localHash).toBe(metadataHash(doc));
  });
});
