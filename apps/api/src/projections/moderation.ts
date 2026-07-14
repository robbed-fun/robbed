/**
 * Moderation queue item projection (api.md) join of `tokens` + the
 * API-owned `moderation_status`. Uses the frozen `moderationQueueItemSchema`.
 */
import type {
  ModerationStatusRow,
  TokenRow,
  moderationQueueItemSchema,
} from "@robbed/shared";
import type { z } from "zod";

// Derived from the frozen shared schema (single source of truth) — not a
// redeclared shape. Shared exports the schema but no inferred alias for it;
// flagged to robbed-shared to add `export type ModerationQueueItem` alongside
// the other api-types aliases for consistency.
type ModerationQueueItem = z.infer<typeof moderationQueueItemSchema>;

export function buildQueueItem(
  tokenAddress: string,
  token: Pick<TokenRow, "name" | "ticker" | "image_url" | "metadata_uri"> | null,
  m: ModerationStatusRow | null,
): ModerationQueueItem {
  return {
    tokenAddress,
    name: token?.name ?? "",
    ticker: token?.ticker ?? "",
    imageUrl: token?.image_url ?? null,
    metadataUri: token?.metadata_uri ?? null,
    nsfwScore: m?.nsfw_score ?? null,
    csamFlag: m?.csam_flag ?? false,
    impersonationFlag: m?.impersonation_flag ?? false,
    impersonationTicker: m?.impersonation_ticker ?? null,
    visibility: m?.visibility ?? "visible",
    updatedAt: m?.updated_at ?? new Date(0).toISOString(),
  };
}
