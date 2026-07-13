import {
  type Comment as CommentModel,
  type CommentsResponse,
  commentResponseSchema,
  commentsResponseSchema,
} from "@robbed/shared";

import { sameOriginGet, sameOriginPost } from "@/shared/api";

/**
 * Per-token comments transport (§12.63b). Both routes go through the SAME-ORIGIN
 * proxy (next.config rewrite) with `credentials: "include"` — the POST needs the
 * SIWE cookie, and routing the GET the same way keeps one base. Response shapes
 * are the FROZEN shared `commentsResponseSchema` / `commentResponseSchema` (never
 * redeclared). The DOM `Comment` global is aliased to `CommentModel` on import.
 */

/** GET /v1/tokens/:address/comments — keyset-paginated `{ items, nextCursor }`, newest-first. */
export function listComments(
  address: string,
  cursor?: string,
): Promise<CommentsResponse> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return sameOriginGet(
    `/v1/tokens/${address.toLowerCase()}/comments${qs}`,
    commentsResponseSchema,
  );
}

/** POST /v1/tokens/:address/comments — body ONLY (author from the session). */
export async function postComment(
  address: string,
  body: string,
): Promise<CommentModel> {
  const res = await sameOriginPost(
    `/v1/tokens/${address.toLowerCase()}/comments`,
    { body },
    commentResponseSchema,
  );
  return res.comment;
}
