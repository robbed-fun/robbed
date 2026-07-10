/**
 * §12.19 NORMATIVE — client-side metadata-hash re-verification before signing.
 *
 * The API canonicalizes + keccak256-hashes the metadata and returns
 * `{ metadataHash, metadataUri, canonicalJson }`. Before the client puts that
 * `metadataHash` on-chain (it becomes the immutable `TokenCreated` commitment),
 * it MUST recompute the hash itself with the SAME shared canonicalizer the API
 * and indexer use, and refuse to sign on any mismatch — a buggy or malicious
 * server can never commit the user to metadata they didn't author (api.md §3.2).
 *
 * We verify BOTH layers, strongest first:
 *   1. `canonicalizeMetadata(document)` bytes === the server's `canonicalJson`
 *      (byte-identical canonical form — catches any field/encoding divergence);
 *   2. `metadataHash(document)` === the server's `metadataHash` (the on-chain
 *      commitment itself).
 * Either failing blocks signing. Because there is exactly ONE canonicalizer
 * implementation (`@robbed/shared`), a match is byte-identical by construction;
 * a mismatch means the server produced a document the client did not.
 */
import {
  type JsonValue,
  canonicalizeMetadata,
  metadataHash,
} from "@robbed/shared";

export interface MetadataServerResult {
  metadataHash: string;
  canonicalJson: string;
}

export type VerifyFailureReason = "canonical_mismatch" | "hash_mismatch";

export interface VerifyResult {
  ok: boolean;
  /** The hash the client independently computed — what would actually be signed. */
  localHash: `0x${string}`;
  /** The client's canonical JSON text. */
  localCanonical: string;
  reason?: VerifyFailureReason;
}

/**
 * Recompute locally and compare to the server's result. `document` is the full
 * canonical metadata object (with `version`), built by `buildMetadataDocument`.
 */
export function verifyMetadataHash(
  document: JsonValue,
  server: MetadataServerResult,
): VerifyResult {
  const localCanonical = new TextDecoder("utf-8").decode(canonicalizeMetadata(document));
  const localHash = metadataHash(document);

  if (localCanonical !== server.canonicalJson) {
    return { ok: false, localHash, localCanonical, reason: "canonical_mismatch" };
  }
  if (localHash.toLowerCase() !== server.metadataHash.toLowerCase()) {
    return { ok: false, localHash, localCanonical, reason: "hash_mismatch" };
  }
  return { ok: true, localHash, localCanonical };
}

/** Human-readable, non-alarming message for a blocked launch (rendered in the stepper). */
export function verifyFailureMessage(reason: VerifyFailureReason): string {
  return reason === "canonical_mismatch"
    ? "The server's metadata does not byte-match what you entered — launch blocked so nothing you didn't author is committed on-chain."
    : "The server's metadata hash does not match your own — launch blocked so nothing you didn't author is committed on-chain.";
}
