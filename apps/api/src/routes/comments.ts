/**
 * Per-token comments (spec §12.63b — off-chain, SIWE-authored, §8.4-moderation-
 * gated, flat). Two routes under `/v1/tokens/:address/comments`:
 *
 *   POST — SIWE-authenticated (requireUser). `author` comes from the session and
 *     `tokenAddress` from the path — NEVER the client body (which carries only
 *     `body`, bounded by `postCommentRequestSchema` / `COMMENT_BODY_MAX`). The
 *     comment runs through the swappable moderation hook (deps.commentModerator);
 *     a VISIBLE result is fanned out on `token:{addr}:events`. Per-author rate
 *     limit (anti-spam) reuses the shared sliding-window store.
 *
 *   GET — public, keyset-paginated newest-first (`{ items, nextCursor }` via the
 *     shared `commentsResponseSchema`). HIDDEN comments are excluded (visible +
 *     pending_review only, §12.21).
 *
 * §8.4 invariant: this path never reads or mutates chain state — it only writes
 * the API-owned `comments` table and publishes to Redis.
 */
import { Hono } from "hono";
import {
  addressSchema,
  commentListQuerySchema,
  commentResponseSchema,
  commentsResponseSchema,
  postCommentRequestSchema,
} from "@robbed/shared";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { ok } from "../lib/envelope";
import { publishComment } from "../lib/comment-publish";
import { decodeCursor, encodeCursor } from "../lib/pagination";
import { ROUTE_LIMITS } from "../mw/ratelimit";
import { parse, parseJson, parseQuery } from "../lib/validate";
import { toComment, toWsCommentData } from "../projections/comment";
import { type UserVars, requireUser } from "../auth/middleware";

export function commentRoutes(deps: AppDeps) {
  const app = new Hono<{ Variables: UserVars }>();
  const auth = requireUser(deps);

  // ── POST — authenticated create ───────────────────────────────────────────
  app.post("/v1/tokens/:address/comments", auth, async (c) => {
    const address = parse(addressSchema, c.req.param("address").toLowerCase());
    if (!(await deps.db.tokenExists(address))) throw errors.notFound("token not found");

    // Per-author anti-spam window (task: basic rate-limit per author). Keyed by
    // the SIWE address (post-auth), reusing the shared sliding-window store — not
    // the IP limiter (that runs in app.ts on /v1/tokens/*). Simple default window
    // flagged to the architect for tuning.
    const author = c.get("userAddress")!;
    const rl = ROUTE_LIMITS.commentsPerAuthor;
    const decision = await deps.rateLimit.hit(`rl:${rl.name}:addr:${author}`, rl.windowMs, rl.limit, deps.now());
    if (!decision.allowed) {
      c.header("Retry-After", String(decision.retryAfterSec));
      throw errors.rateLimited("comment rate limit exceeded");
    }

    // Body ONLY from the client (author from session, tokenAddress from path);
    // unknown keys are stripped by the shared z.object, so an injected
    // author/tokenAddress is dropped, not trusted. COMMENT_BODY_MAX enforced.
    const { body } = await parseJson(postCommentRequestSchema, c);

    // §8.4 moderation — swappable hook (stub → visible; vendor is §13 OPEN).
    const verdict = await deps.commentModerator.moderate({ tokenAddress: address, author, body });

    const createdAt = Math.floor(deps.now() / 1000);
    const row = await deps.db.insertComment({
      tokenAddress: address,
      author,
      body,
      moderationStatus: verdict.visibility,
      createdAt,
    });

    // Broadcast ONLY visible comments (moderation-gated fanout). Awaited but
    // error-swallowing — a Redis hiccup logs, never fails the create (§8.4 heal).
    if (row.moderation_status === "visible") {
      await publishComment(deps.redis, toWsCommentData(row), deps.now());
    }

    return ok(c, commentResponseSchema.parse({ comment: toComment(row) }), 201);
  });

  // ── GET — public paginated list (newest-first, hidden excluded) ───────────
  app.get("/v1/tokens/:address/comments", async (c) => {
    const address = parse(addressSchema, c.req.param("address").toLowerCase());
    if (!(await deps.db.tokenExists(address))) throw errors.notFound("token not found");

    const q = parseQuery(commentListQuerySchema, c);
    const cursor = decodeCursor(deps.config.SESSION_SECRET, q.cursor);
    const rows = await deps.db.listComments({
      token: address,
      cursorKey: cursor?.k ?? null,
      cursorId: cursor?.i ?? null,
      limit: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const items = page.map(toComment);
    const last = page[page.length - 1];
    // Keyset cursor = (created_at, id) of the last row — the shared
    // KeysetCursorPayload {k,i}, HMAC-signed (opaque to clients).
    const nextCursor =
      hasMore && last
        ? encodeCursor(deps.config.SESSION_SECRET, { k: String(last.created_at), i: last.id })
        : null;
    return ok(c, commentsResponseSchema.parse({ items, nextCursor }));
  });

  return app;
}
