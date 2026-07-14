/**
 * Launch form validation. ALL field constraints come from the
 * FROZEN `@robbed/shared` schemas — the byte-length limits (name ≤32 B, ticker
 * ≤10 B, description ≤500), which are the drift-sensitive part that must match
 * the API + the on-chain gate, are NEVER redeclared here. We `.pick()` them off
 * `metadataRequestSchema` so the exact same `byteBoundedString` refinements run
 * client-side; the API re-validates and is the authority (web.md).
 *
 * The only additive rules are UX guards that do not touch the hash commitment:
 * - links must be `https:` (the API also enforces this — api.md);
 *   - the image is a `File` (not part of the metadata JSON — it is uploaded first
 *     and only its content-addressed hash enters the document), size ≤4 MB;
 *   - the optional initial buy is a non-negative ETH decimal.
 */
import {
  MAX_IMAGE_BYTES,
  metadataRequestSchema,
} from "@robbed/shared";
import { parseEther } from "viem";
import { z } from "zod";

/**
 * Text fields, reusing the shared byte-bounded field schemas verbatim. `.pick`
 * keeps each field's exact validator (no parallel cap); `.superRefine` layers the
 * https-only UX check onto the (optional) links without redeclaring their shape.
 */
export const launchTextSchema = metadataRequestSchema
  .pick({ name: true, ticker: true, description: true, links: true })
  .superRefine((val, ctx) => {
    for (const key of ["website", "x", "telegram"] as const) {
      const url = val.links?.[key];
      if (url && !/^https:\/\//i.test(url)) {
        ctx.addIssue({
          code: "custom",
          path: ["links", key],
          message: "Links must start with https://",
        });
      }
    }
  });

export type LaunchTextValues = z.infer<typeof launchTextSchema>;

/** Allowed upload MIME types (jpg/png/webp/gif; the API re-encodes). */
export const ACCEPTED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/**
 * Pre-upload client image gate (UX only — the API MIME-sniffs + re-encodes, spec
 * ). Returns an error string or `null`. Size limit is the shared
 * `MAX_IMAGE_BYTES`, never an inline number.
 */
export function validateImageFile(file: File | null): string | null {
  if (!file) return "An image is required.";
  if (file.size > MAX_IMAGE_BYTES) {
    return `Image is too large — max ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB.`;
  }
  if (!ACCEPTED_IMAGE_MIME.includes(file.type as (typeof ACCEPTED_IMAGE_MIME)[number])) {
    return "Unsupported image type — use JPG, PNG, WEBP, or GIF.";
  }
  return null;
}

export type InitialBuyParse =
  | { ok: true; wei: bigint }
  | { ok: false; error: string };

/**
 * Parse the optional initial-buy ETH amount. Empty ⇒ 0 (no initial buy). The
 * value is ETH the creator will spend inside the same `createToken` tx — never a
 * market metric, so no constant is involved.
 */
export function parseInitialBuyEth(raw: string): InitialBuyParse {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === ".") return { ok: true, wei: 0n };
  if (!/^\d*\.?\d*$/.test(trimmed)) return { ok: false, error: "Enter a valid ETH amount." };
  try {
    const wei = parseEther(trimmed);
    if (wei < 0n) return { ok: false, error: "Amount must be positive." };
    return { ok: true, wei };
  } catch {
    return { ok: false, error: "Enter a valid ETH amount." };
  }
}
