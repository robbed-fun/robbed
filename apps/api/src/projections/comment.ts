/**
 * `CommentRowDb` → frozen shared DTOs. The persisted row maps 1:1 to the shared
 * `Comment` (REST) and its `WsCommentData` subset (live fanout); the wire shapes
 * stay single-sourced in @robbed/shared (`commentSchema` / `wsCommentDataSchema`)
 * — this only transcribes column → field. Addresses are lowercased (stored
 * lowercase throughout).
 */
import type { Comment, WsCommentData } from "@robbed/shared";
import type { CommentRowDb } from "../lib/db";

/** REST comment (carries `moderationStatus`). */
export function toComment(row: CommentRowDb): Comment {
  return {
    id: row.id,
    tokenAddress: row.token_address.toLowerCase(),
    author: row.author.toLowerCase(),
    body: row.body,
    createdAt: row.created_at,
    moderationStatus: row.moderation_status,
  };
}

/** WS `comment` payload — the shared base, NO `moderationStatus` (visible-only). */
export function toWsCommentData(row: CommentRowDb): WsCommentData {
  return {
    id: row.id,
    tokenAddress: row.token_address.toLowerCase(),
    author: row.author.toLowerCase(),
    body: row.body,
    createdAt: row.created_at,
  };
}
