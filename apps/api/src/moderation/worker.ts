/**
 * Moderation worker — the X-10 `TokenCreated` observation seam (§4.4). The API
 * has NO chain subscription and a read-only DB role on indexer tables, so it
 * cannot watch `TokenCreated` directly. The indexer already publishes `launch`
 * on `global:launches`; this worker subscribes, and per launch: runs the token-
 * time impersonation match on the ON-CHAIN name/ticker, LINKS the pre-scanned
 * image verdict (cached by image hash at upload), evaluates listing visibility,
 * and writes `moderation_status` (API-owned) ONLY — no chain read, no indexer-
 * table write. `processLaunch` is pure over injected deps so it unit-tests
 * without Redis.
 */
import { GLOBAL_LAUNCHES, wsMessageSchema } from "@robbed/shared";
import type { WsLaunchData } from "@robbed/shared";
import type { AppDeps } from "../deps";
import { imageModCacheKey, imageScoreSchema } from "./image";
import { matchImpersonation } from "./impersonation";
import { evaluateVisibility } from "./state-machine";

/** Extract the keccak image hash from a content-addressed CDN image URL. */
export function hashFromImageUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = url.match(/images\/([0-9a-fA-F]{64})\.webp$/);
  return m ? `0x${m[1]!.toLowerCase()}` : null;
}

export async function processLaunch(deps: AppDeps, data: WsLaunchData): Promise<void> {
  const imp = matchImpersonation(data.name, data.ticker, deps.watchlist);

  // Link the pre-scanned image verdict (cached by hash at upload), if any.
  let csam = false;
  let nsfw: number | null = null;
  const hash = hashFromImageUrl(data.imageUrl);
  if (hash) {
    const raw = await deps.redis.get(imageModCacheKey(hash)).catch(() => null);
    if (raw) {
      const parsed = imageScoreSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        csam = parsed.data.csam;
        nsfw = parsed.data.nsfw;
      }
    }
  }

  const verdict = evaluateVisibility(
    { csam, nsfw, impersonation: imp.flagged },
    {
      hide: deps.config.MODERATION_NSFW_HIDE_THRESHOLD,
      review: deps.config.MODERATION_NSFW_REVIEW_THRESHOLD,
    },
  );

  await deps.db.upsertModerationStatus(data.address, {
    visibility: verdict.visibility,
    nsfw_score: nsfw,
    csam_flag: csam,
    impersonation_flag: imp.flagged,
    impersonation_ticker: imp.ticker ?? null,
    reason: verdict.reason,
    reviewed_by: null,
    updated_at: new Date(deps.now()).toISOString(),
  });
}

/** Subscribe to `global:launches` and process each `launch` message. */
export async function startModerationWorker(deps: AppDeps): Promise<void> {
  await deps.redis.subscribe(GLOBAL_LAUNCHES, (raw) => {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = wsMessageSchema.safeParse(msg);
    if (!parsed.success || parsed.data.type !== "launch") return;
    void processLaunch(deps, parsed.data.data).catch((err) =>
      console.error("[moderation-worker] processLaunch failed:", err),
    );
  });
  console.log(`[moderation-worker] subscribed to ${GLOBAL_LAUNCHES}`);
}
