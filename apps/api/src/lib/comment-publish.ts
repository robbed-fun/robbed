/**
 * API-side WS publish for off-chain `comment` events (spec §12.63b) — the ONLY
 * place the API fans a comment to browsers. Mirrors the indexer's `firePublish`
 * (indexer.md §8.2): one Redis `INCR channel:seq` for the per-channel monotonic
 * `seq`, then one `PUBLISH` of the enveloped wire frame; the Bun WS server
 * (ws.ts) relays it verbatim to `token:{addr}:events` subscribers.
 *
 * Hard rules honored here:
 *  - NO database read. The `WsCommentData` is built entirely from the row the
 *    caller already holds (the freshly-inserted comment) — nothing is fetched.
 *  - Only VISIBLE comments are ever published (the caller gates on the moderation
 *    verdict); the WS `comment` payload therefore carries no `moderationStatus`
 *    (visible by construction — wsCommentDataSchema, ws-messages.ts).
 *  - Errors are swallowed + logged, never thrown into the request path: a lost
 *    publish is self-healing (clients REST-heal on a `seq` gap, §8.4).
 *
 * The envelope shape equals the indexer's `WsEnvelope` and validates against the
 * shared `wsMessageSchema` `comment` variant, so REST and live push are the same
 * wire contract.
 */
import {
  channelSeqKey,
  tokenEvents,
  wsCommentDataSchema,
  type WsCommentData,
} from "@robbed/shared";
import type { Redis } from "./redis";

/** Build → INCR seq → PUBLISH the `comment` frame to `token:{addr}:events`. */
export async function publishComment(
  redis: Redis,
  data: WsCommentData,
  tsMs: number,
): Promise<void> {
  const channel = tokenEvents(data.tokenAddress);
  try {
    // Validate against the single-source wire schema before it leaves the API,
    // so a malformed payload can never reach the fanout (cheap, no DB).
    const payload = wsCommentDataSchema.parse(data);
    const seq = await redis.incr(channelSeqKey(channel));
    const envelope = {
      v: 1 as const,
      type: "comment" as const,
      channel,
      seq,
      ts: Math.floor(tsMs / 1000),
      data: payload,
    };
    await redis.publish(channel, JSON.stringify(envelope));
  } catch (err) {
    console.error(`[api comment-publish] failed on ${channel}:`, err);
  }
}
