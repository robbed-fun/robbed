/**
 * Image auto-moderation scoring + hash-keyed cache (§4.3). Runs the vendor
 * interfaces over the RE-ENCODED bytes and records the result keyed by image
 * hash so the launch worker (X-10) can LINK the pre-scanned verdict to the token
 * at `TokenCreated` without re-fetching the image. With real vendors this scoring
 * belongs in the async job queue (OI-A4); the interface is identical.
 */
import { z } from "zod";
import type { ModerationVendors } from "./vendors";

export const imageScoreSchema = z.object({
  csam: z.boolean(),
  csamRef: z.string().optional(),
  nsfw: z.number(),
  violence: z.number(),
});
export type ImageScore = z.infer<typeof imageScoreSchema>;

export function imageModCacheKey(imageHash: string): string {
  return `imgmod:${imageHash.toLowerCase()}`;
}

export async function scoreImage(
  vendors: ModerationVendors,
  bytes: Uint8Array,
): Promise<ImageScore> {
  const [csamRes, classRes] = await Promise.all([
    vendors.csam.check(bytes),
    vendors.classifier.classify(bytes),
  ]);
  return {
    csam: csamRes.match,
    ...(csamRes.vendorRef ? { csamRef: csamRes.vendorRef } : {}),
    nsfw: classRes.nsfw,
    violence: classRes.violence,
  };
}
