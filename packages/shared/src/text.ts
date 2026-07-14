/**
 * Shared text helpers — the SINGLE implementation of UTF-8 byte-length
 * validation so the metadata document schema and the REST request schema can
 * never diverge from each other or from the on-chain `bytes(x).length` gate
 * (/ findings X-1; anti-drift extraction rule 3).
 */
import { z } from "zod";

/**
 * UTF-8 byte length of a string. `TextEncoder` emits UTF-8, so this is
 * byte-identical to Solidity `bytes(str).length` (which measures UTF-8 code
 * units) — i.e. the exact measure `createToken` applies on-chain (contracts.md
 * ). Zod's `.max()` counts UTF-16 code units, NOT bytes, and therefore
 * cannot express this constraint (verified against zod.dev/api, 2026-07-10) —
 * hence the refinement below rather than `.max()`.
 */
export function utf8ByteLen(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * A non-empty string bounded by UTF-8 BYTE length in `[1, maxBytes]`, mirroring
 * the on-chain gate so nothing the API accepts can revert at `createToken`
 *. Making API-vs-chain drift impossible by construction: acceptance
 * here ⇒ acceptance on-chain. `label` names the field in the error message.
 */
export function byteBoundedString(maxBytes: number, label: string) {
  return z
    .string()
    .min(1, { error: `${label} must not be empty` })
    .refine((s) => utf8ByteLen(s) <= maxBytes, {
      error: `${label} must be at most ${maxBytes} UTF-8 bytes (on-chain bytes(x).length gate)`,
    });
}
