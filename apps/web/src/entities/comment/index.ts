/**
 * Public API for the `comment` entity (FSD reference/public-api) — per-token,
 * off-chain, SIWE-authored comments (§12.63b). The DOM `Comment` global is why the
 * shared type is always aliased on import (`Comment as CommentModel`).
 */
export { listComments, postComment } from "./api/comments";
export { useComments } from "./model/use-comments";
export { CommentItem } from "./ui/CommentItem";
